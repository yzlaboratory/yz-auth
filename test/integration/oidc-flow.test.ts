import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
} from 'jose'
import { createIntegrationContext, deliverNextEmail, extractSecurityToken, type IntegrationContext } from './setup.js'

let context: IntegrationContext | undefined

beforeEach(async () => {
  context = await createIntegrationContext()
})

afterEach(async () => {
  await context?.application.server.close()
  context = undefined
})

test('a public client completes PKCE, receives a signed API token, and rotates refresh tokens', async () => {
  const { application, tenants, accounts } = context!
  const tenant = await tenants.createTenant({ slug: 'acme', name: 'Acme' })
  const registration = await tenants.createClient({
    tenantSlug: tenant.slug,
    name: 'Acme Web',
    redirectUris: ['http://localhost/callback'],
    resourceUris: ['http://localhost/api'],
    isPublic: true,
  })
  assert.ok(registration)

  await accounts.signUp({
    tenant,
    email: 'person@example.com',
    password: 'initial-password',
    interactionUid: null,
    ipAddress: null,
  })
  await deliverNextEmail(context!)
  const verificationToken = extractSecurityToken(context!.mailSender.messages[0]!.textBody, 'verify')
  await accounts.verifyEmail({ tenant, token: verificationToken, ipAddress: null })

  const discovery = await application.server.inject({
    method: 'GET',
    url: '/t/acme/.well-known/openid-configuration',
  })
  assert.equal(discovery.statusCode, 200)
  assert.equal(discovery.json().issuer, 'http://localhost/t/acme')

  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorization = new URLSearchParams({
    client_id: registration.client.clientId,
    redirect_uri: 'http://localhost/callback',
    response_type: 'code',
    scope: 'openid email offline_access api',
    prompt: 'consent',
    state: 'client-state',
    nonce: 'client-nonce',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'http://localhost/api',
  })
  const initial = await application.server.inject({
    method: 'GET',
    url: `/t/acme/auth?${authorization}`,
  })
  assert.equal(initial.statusCode, 303)

  const cookies = new Map<string, string>()
  captureCookies(initial.headers['set-cookie'], cookies)
  const callback = await completeInteraction(application.server, initial, cookies, {
    email: 'person@example.com',
    password: 'initial-password',
  })
  const callbackUrl = new URL(callback)
  assert.equal(callbackUrl.searchParams.get('state'), 'client-state')
  const code = callbackUrl.searchParams.get('code')
  assert.ok(code)

  const token = await application.server.inject({
    method: 'POST',
    url: '/t/acme/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: registration.client.clientId,
      redirect_uri: 'http://localhost/callback',
      code,
      code_verifier: verifier,
    }).toString(),
  })
  assert.equal(token.statusCode, 200, token.body)
  const tokens = token.json<{
    access_token: string
    id_token: string
    refresh_token: string
    expires_in: number
  }>()
  assert.equal(tokens.expires_in, 300)
  assert.equal(decodeProtectedHeader(tokens.access_token).typ, 'at+jwt')
  assert.equal(decodeJwt(tokens.id_token).nonce, 'client-nonce')

  const jwksResponse = await application.server.inject({ method: 'GET', url: '/t/acme/jwks' })
  const jwks = createLocalJWKSet(jwksResponse.json() as JSONWebKeySet)
  const verified = await jwtVerify(tokens.access_token, jwks, {
    issuer: 'http://localhost/t/acme',
    audience: 'http://localhost/api',
  })
  assert.equal(verified.payload.tenant, 'acme')

  const refreshed = await application.server.inject({
    method: 'POST',
    url: '/t/acme/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: registration.client.clientId,
      refresh_token: tokens.refresh_token,
    }).toString(),
  })
  assert.equal(refreshed.statusCode, 200, refreshed.body)
  const rotatedRefreshToken = refreshed.json().refresh_token
  assert.ok(rotatedRefreshToken)
  assert.notEqual(rotatedRefreshToken, tokens.refresh_token)

  const replay = await application.server.inject({
    method: 'POST',
    url: '/t/acme/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: registration.client.clientId,
      refresh_token: tokens.refresh_token,
    }).toString(),
  })
  assert.equal(replay.statusCode, 400)
  assert.equal(replay.json().error, 'invalid_grant')
})

async function completeInteraction(
  server: FastifyInstance,
  initial: Awaited<ReturnType<FastifyInstance['inject']>>,
  cookies: Map<string, string>,
  credentials: { email: string; password: string },
): Promise<string> {
  let response = initial

  for (let step = 0; step < 8; step += 1) {
    const location = response.headers.location
    assert.ok(location, response.body)
    if (location.startsWith('http://localhost/callback')) {
      return location
    }

    const page = await server.inject({
      method: 'GET',
      url: location,
      headers: { cookie: cookieHeader(cookies) },
    })
    captureCookies(page.headers['set-cookie'], cookies)
    if (page.statusCode === 303) {
      response = page
      continue
    }
    assert.equal(page.statusCode, 200, page.body)

    const isLogin = page.body.includes('name="password"')
    const action = isLogin ? 'login' : 'consent'
    const csrfToken = extractCsrf(page.body)
    const uid = location.match(/\/interaction\/([^/?]+)/)?.[1]
    assert.ok(uid)
    const slug = location.match(/\/t\/([^/]+)\//)?.[1]
    assert.ok(slug)

    const form = new URLSearchParams({ _csrf: csrfToken })
    if (isLogin) {
      form.set('email', credentials.email)
      form.set('password', credentials.password)
    }

    response = await server.inject({
      method: 'POST',
      url: `/t/${slug}/interaction/${uid}/${action}`,
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form.toString(),
    })
    captureCookies(response.headers['set-cookie'], cookies)
    assert.equal(response.statusCode, 303, response.body)
  }

  throw new Error('OIDC interaction did not complete')
}

function extractCsrf(body: string): string {
  const token = body.match(/name="_csrf" value="([^"]+)"/)?.[1]
  if (!token) {
    throw new Error('No CSRF token found')
  }

  return token
}

function captureCookies(
  values: string | string[] | undefined,
  cookies: Map<string, string>,
): void {
  for (const value of values ? Array.isArray(values) ? values : [values] : []) {
    const [pair] = value.split(';')
    const separator = pair?.indexOf('=') ?? -1
    if (pair && separator > 0) {
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

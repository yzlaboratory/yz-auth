import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { PostgresOidcAdapter } from '../../src/oidc/postgres-adapter.js'
import { createIntegrationContext, deliverNextEmail, extractSecurityToken, type IntegrationContext } from './setup.js'

let context: IntegrationContext | undefined

beforeEach(async () => {
  context = await createIntegrationContext()
})

afterEach(async () => {
  await context?.application.server.close()
  context = undefined
})

test('signup, verification, recovery, and revocation enforce the account lifecycle', async () => {
  const { tenants, accounts, database } = context!
  const tenant = await tenants.createTenant({ slug: 'acme', name: 'Acme' })

  assert.equal(await accounts.signUp({
    tenant,
    email: 'Person@Example.com',
    password: 'initial-password',
    interactionUid: null,
    ipAddress: '127.0.0.1',
  }), true)
  assert.equal(await accounts.signUp({
    tenant,
    email: 'person@example.com',
    password: 'initial-password',
    interactionUid: null,
    ipAddress: '127.0.0.1',
  }), false)

  const unverified = await accounts.authenticate({
    tenant,
    email: 'person@example.com',
    password: 'initial-password',
    ipAddress: '127.0.0.1',
  })
  assert.equal(unverified.status, 'unverified')

  await deliverNextEmail(context!)
  const verificationToken = extractSecurityToken(context!.mailSender.messages[0]!.textBody, 'verify')
  assert.equal(await accounts.verifyEmail({ tenant, token: verificationToken, ipAddress: '127.0.0.1' }), true)
  assert.equal(await accounts.verifyEmail({ tenant, token: verificationToken, ipAddress: '127.0.0.1' }), false)

  const authenticated = await accounts.authenticate({
    tenant,
    email: 'person@example.com',
    password: 'initial-password',
    ipAddress: '127.0.0.1',
  })
  assert.equal(authenticated.status, 'success')
  const accountId = authenticated.status === 'success' ? authenticated.account.id : ''

  const sessions = new PostgresOidcAdapter(database, tenant.id, 'Session')
  await sessions.upsert('session-id', {
    accountId,
    grantId: 'grant-id',
  }, 3600)
  const grants = new PostgresOidcAdapter(database, tenant.id, 'Grant')
  await grants.upsert('grant-id', { accountId }, 3600)
  const interactions = new PostgresOidcAdapter(database, tenant.id, 'Interaction')
  await interactions.upsert('interaction-id', {
    result: { login: { accountId, remember: true } },
  }, 3600)

  await accounts.requestPasswordReset({
    tenant,
    email: 'person@example.com',
    ipAddress: '127.0.0.1',
  })
  await deliverNextEmail(context!)
  const resetEmail = context!.mailSender.messages.find((message) => message.subject.includes('Reset your'))
  assert.ok(resetEmail)
  const resetToken = extractSecurityToken(resetEmail.textBody, 'reset-password')
  assert.equal(await accounts.isPasswordResetTokenValid(tenant, resetToken), true)
  assert.equal(await accounts.resetPassword({
    tenant,
    token: resetToken,
    password: 'replacement-password',
    ipAddress: '127.0.0.1',
  }), true)
  assert.equal(await accounts.resetPassword({
    tenant,
    token: resetToken,
    password: 'another-password',
    ipAddress: '127.0.0.1',
  }), false)

  assert.equal(await sessions.find('session-id'), undefined)
  assert.equal(await grants.find('grant-id'), undefined)
  assert.equal(await interactions.find('interaction-id'), undefined)
  assert.equal((await accounts.authenticate({
    tenant,
    email: 'person@example.com',
    password: 'initial-password',
    ipAddress: '127.0.0.1',
  })).status, 'invalid')
  assert.equal((await accounts.authenticate({
    tenant,
    email: 'person@example.com',
    password: 'replacement-password',
    ipAddress: '127.0.0.1',
  })).status, 'success')
})

test('the same email remains isolated across tenants', async () => {
  const { tenants, accounts, database } = context!
  const first = await tenants.createTenant({ slug: 'first', name: 'First' })
  const second = await tenants.createTenant({ slug: 'second', name: 'Second' })

  await accounts.signUp({
    tenant: first,
    email: 'person@example.com',
    password: 'first-password',
    interactionUid: null,
    ipAddress: null,
  })
  await accounts.signUp({
    tenant: second,
    email: 'person@example.com',
    password: 'second-password',
    interactionUid: null,
    ipAddress: null,
  })

  const rows = await database<{ tenant_id: string; password_hash: string }[]>`
    select tenant_id, password_hash from accounts where normalized_email = 'person@example.com'
    order by tenant_id
  `
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0]!.tenant_id, rows[1]!.tenant_id)
  assert.notEqual(rows[0]!.password_hash, rows[1]!.password_hash)
})

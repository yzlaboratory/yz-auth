import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AccountService } from '../accounts/account-service.js'
import type { AppConfig } from '../config.js'
import type { TenantService, TenantWithSigningKey } from '../tenants/tenant-service.js'
import { hasValidCsrfToken, issueCsrfToken } from '../web/csrf.js'
import { sensitiveRateLimit } from '../web/rate-limit.js'
import { renderInvalidCsrf, renderMessage } from '../web/responses.js'
import { requireActiveTenant } from '../web/tenant-context.js'
import type { OidcProviderManager } from './provider-manager.js'

interface InteractionParams {
  slug: string
  uid: string
}

interface InteractionBody {
  email?: string
  password?: string
  _csrf?: string
}

interface ConsentDetails {
  missingOIDCScope?: string[]
  missingOIDCClaims?: string[]
  missingResourceScopes?: Record<string, string[]>
}

export function registerInteractionRoutes(
  app: FastifyInstance,
  providers: OidcProviderManager,
  accounts: AccountService,
  tenants: TenantService,
  config: AppConfig,
): void {
  app.get<{ Params: InteractionParams }>(
    '/t/:slug/interaction/:uid',
    async (request, reply) => {
      const context = await loadInteraction(request, reply, providers, tenants)
      if (!context) return

      if (context.details.prompt.name === 'login') {
        return renderLogin(request, reply, context, config, null, '')
      }

      if (context.details.prompt.name === 'consent') {
        return renderConsent(request, reply, context, config)
      }

      return renderMessage(reply, 400, context.tenant.name, 'Unsupported request', 'This authentication request cannot be completed.')
    },
  )

  app.post<{ Params: InteractionParams; Body: InteractionBody }>(
    '/t/:slug/interaction/:uid/login',
    { config: { rateLimit: sensitiveRateLimit } },
    async (request, reply) => {
      const context = await loadInteraction(request, reply, providers, tenants)
      if (!context) return
      if (context.details.prompt.name !== 'login') {
        return renderMessage(reply, 400, context.tenant.name, 'Invalid request', 'This login request is no longer valid.')
      }
      if (!hasValidCsrfToken(request, request.body._csrf)) {
        return renderInvalidCsrf(reply, context.tenant)
      }

      const result = await accounts.authenticate({
        tenant: context.tenant,
        email: request.body.email ?? '',
        password: request.body.password ?? '',
        ipAddress: request.ip,
      })
      if (result.status !== 'success') {
        const error = result.status === 'unverified'
          ? 'Verify your email before logging in. You can request a new verification link below.'
          : 'Invalid email or password.'
        return renderLogin(request, reply, context, config, error, request.body.email ?? '')
      }

      const resumeUrl = await context.provider.interactionResult(
        request.raw,
        reply.raw,
        { login: { accountId: result.account.id, remember: true } },
        { mergeWithLastSubmission: false },
      )
      return reply.redirect(resumeUrl, 303)
    },
  )

  app.post<{ Params: InteractionParams; Body: InteractionBody }>(
    '/t/:slug/interaction/:uid/consent',
    async (request, reply) => {
      const context = await loadInteraction(request, reply, providers, tenants)
      if (!context) return
      if (context.details.prompt.name !== 'consent' || !context.details.session?.accountId) {
        return renderMessage(reply, 400, context.tenant.name, 'Invalid request', 'This authorization request is no longer valid.')
      }
      if (!hasValidCsrfToken(request, request.body._csrf)) {
        return renderInvalidCsrf(reply, context.tenant)
      }

      const isNewGrant = !context.details.grantId
      const grant = context.details.grantId
        ? await context.provider.Grant.find(context.details.grantId)
        : new context.provider.Grant({
            accountId: context.details.session.accountId,
            clientId: String(context.details.params.client_id),
          })
      if (!grant) {
        return renderMessage(reply, 400, context.tenant.name, 'Invalid request', 'The existing authorization grant was not found.')
      }

      const requested = context.details.prompt.details as ConsentDetails
      if (requested.missingOIDCScope) {
        grant.addOIDCScope(requested.missingOIDCScope)
      }
      if (requested.missingOIDCClaims) {
        grant.addOIDCClaims(requested.missingOIDCClaims)
      }
      for (const [resource, scopes] of Object.entries(requested.missingResourceScopes ?? {})) {
        grant.addResourceScope(resource, scopes)
      }

      const grantId = await grant.save()
      const resumeUrl = await context.provider.interactionResult(
        request.raw,
        reply.raw,
        { consent: isNewGrant ? { grantId } : {} },
        { mergeWithLastSubmission: true },
      )
      return reply.redirect(resumeUrl, 303)
    },
  )
}

async function loadInteraction(
  request: FastifyRequest<{ Params: InteractionParams }>,
  reply: FastifyReply,
  providers: OidcProviderManager,
  tenants: TenantService,
) {
  const tenant = await requireActiveTenant(request, reply, tenants)
  if (!tenant) return null

  const provider = await providers.getProvider(tenant.slug)
  if (!provider) {
    await renderMessage(reply, 404, tenant.name, 'Not found', 'This authentication service is disabled.')
    return null
  }

  const details = await provider.interactionDetails(request.raw, reply.raw)
  const clientId = String(details.params.client_id ?? '')
  const registeredClients = await tenants.listClients(tenant.slug)
  const clientName = registeredClients.find((client) => client.clientId === clientId)?.name ?? 'this application'

  return { tenant, provider, details, clientName }
}

async function renderLogin(
  request: FastifyRequest,
  reply: FastifyReply,
  context: InteractionContext,
  config: AppConfig,
  error: string | null,
  email: string,
): Promise<string> {
  return reply.viewAsync('login.ejs', {
    tenantName: context.tenant.name,
    clientName: context.clientName,
    slug: context.tenant.slug,
    uid: context.details.uid,
    error,
    email,
    csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
  })
}

async function renderConsent(
  request: FastifyRequest,
  reply: FastifyReply,
  context: InteractionContext,
  config: AppConfig,
): Promise<string> {
  const requested = context.details.prompt.details as ConsentDetails
  const scopes = requested.missingOIDCScope ?? String(context.details.params.scope ?? 'openid').split(' ')

  return reply.viewAsync('consent.ejs', {
    tenantName: context.tenant.name,
    clientName: context.clientName,
    slug: context.tenant.slug,
    uid: context.details.uid,
    scopes,
    csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
  })
}

type InteractionContext = NonNullable<Awaited<ReturnType<typeof loadInteraction>>> & {
  tenant: TenantWithSigningKey
}

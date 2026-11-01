import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type Provider from 'oidc-provider'
import type { OidcProviderManager } from './provider-manager.js'

interface TenantParams {
  slug: string
}

export function registerOidcRoutes(app: FastifyInstance, providers: OidcProviderManager): void {
  app.all<{ Params: TenantParams }>(
    '/.well-known/oauth-authorization-server/t/:slug',
    async (request, reply) => {
      const provider = await providers.getProvider(request.params.slug)
      if (!provider) {
        return reply.code(404).send({ error: 'tenant_not_found' })
      }

      const prefix = `/t/${request.params.slug}`
      dispatchProvider(request, reply, provider, {
        internalUrl: '/.well-known/oauth-authorization-server',
        originalUrl: `${prefix}/.well-known/oauth-authorization-server`,
      })
    },
  )

  app.all<{ Params: TenantParams }>(
    '/t/:slug/*',
    async (request, reply) => {
      const provider = await providers.getProvider(request.params.slug)
      if (!provider) {
        return reply.code(404).send({ error: 'tenant_not_found' })
      }

      const prefix = `/t/${request.params.slug}`
      const currentUrl = request.raw.url ?? '/'
      const internalUrl = currentUrl.slice(prefix.length) || '/'
      dispatchProvider(request, reply, provider, {
        internalUrl,
        originalUrl: `${prefix}${internalUrl}`,
      })
    },
  )
}

function dispatchProvider(
  request: FastifyRequest,
  reply: FastifyReply,
  provider: Provider,
  urls: { internalUrl: string; originalUrl: string },
): void {
  Object.assign(request.raw, { originalUrl: urls.originalUrl })
  request.raw.url = urls.internalUrl
  reply.hijack()
  const callback = provider.callback()
  void (async () => {
    try {
      await callback(request.raw, reply.raw)
    } catch (error) {
      request.log.error(error)
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500
        reply.raw.end()
      }
    }
  })()
}

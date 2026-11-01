import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Tenant, TenantService } from '../tenants/tenant-service.js'
import { renderMessage } from './responses.js'

export async function requireActiveTenant(
  request: FastifyRequest,
  reply: FastifyReply,
  tenants: TenantService,
): Promise<Tenant | null> {
  reply.header('Cache-Control', 'no-store')
  const { slug } = request.params as { slug?: string }
  const tenant = slug ? await tenants.getTenant(slug) : null
  const isActive = tenant?.status === 'active'

  if (!isActive) {
    await renderMessage(reply, 404, 'yz-auth', 'Not found', 'This authentication service does not exist.')
    return null
  }

  return tenant
}

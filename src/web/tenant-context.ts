import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TenantService, TenantWithSigningKey } from '../tenants/tenant-service.js'
import { renderMessage } from './responses.js'

export async function requireActiveTenant(
  request: FastifyRequest,
  reply: FastifyReply,
  tenants: TenantService,
): Promise<TenantWithSigningKey | null> {
  const { slug } = request.params as { slug?: string }
  const tenant = slug ? await tenants.getTenant(slug) : null

  if (!tenant || tenant.status !== 'active') {
    await renderMessage(reply, 404, 'yz-auth', 'Not found', 'This authentication service does not exist.')
    return null
  }

  return tenant
}

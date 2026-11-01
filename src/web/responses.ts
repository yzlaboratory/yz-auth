import type { FastifyReply } from 'fastify'
import type { Tenant } from '../tenants/tenant-service.js'

export function renderMessage(
  reply: FastifyReply,
  statusCode: number,
  tenantName: string,
  title: string,
  message: string,
  action: { url: string; text: string } | null = null,
): Promise<string> {
  return reply
    .code(statusCode)
    .viewAsync('message.ejs', {
      title,
      tenantName,
      message,
      actionUrl: action?.url ?? null,
      actionText: action?.text ?? null,
    })
}

export function renderInvalidCsrf(reply: FastifyReply, tenant: Tenant): Promise<string> {
  return renderMessage(
    reply,
    403,
    tenant.name,
    'Form expired',
    'The form has expired or was opened in another window. Go back and try again.',
  )
}

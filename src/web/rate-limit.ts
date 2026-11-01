import type { FastifyRequest } from 'fastify'

export const sensitiveRateLimit = {
  max: 10,
  timeWindow: '1 minute',
  keyGenerator: sensitiveRateLimitKey,
}

export function sensitiveRateLimitKey(request: FastifyRequest): string {
  const parameters = request.params as { slug?: string }
  const body = request.body as { email?: unknown } | undefined
  const email = typeof body?.email === 'string'
    ? body.email.trim().toLowerCase()
    : ''
  const identity = email || request.ip

  return `${request.routeOptions.url}:${parameters.slug ?? ''}:${identity}`
}

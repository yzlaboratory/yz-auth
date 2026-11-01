import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

const cookieName = 'yz_auth_csrf'

export function issueCsrfToken(
  request: FastifyRequest,
  reply: FastifyReply,
  isProduction: boolean,
): string {
  const existing = request.cookies[cookieName]
  if (existing) {
    return existing
  }

  const token = randomBytes(32).toString('base64url')
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  })

  return token
}

export function hasValidCsrfToken(
  request: FastifyRequest,
  submittedToken: unknown,
): boolean {
  const cookieToken = request.cookies[cookieName]
  if (!cookieToken || typeof submittedToken !== 'string') {
    return false
  }

  const expected = Buffer.from(cookieToken)
  const submitted = Buffer.from(submittedToken)
  return expected.length === submitted.length && timingSafeEqual(expected, submitted)
}

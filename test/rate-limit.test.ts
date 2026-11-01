import assert from 'node:assert/strict'
import test from 'node:test'
import type { FastifyRequest } from 'fastify'
import { sensitiveRateLimitKey } from '../src/web/rate-limit.js'

test('sensitive throttles remain stable across source IPs and separate tenant accounts', () => {
  const first = sensitiveRateLimitKey(request('198.51.100.1', 'Person@Example.com', 'acme'))
  const rotatedIp = sensitiveRateLimitKey(request('203.0.113.2', 'person@example.com', 'acme'))
  const otherAccount = sensitiveRateLimitKey(request('198.51.100.1', 'other@example.com', 'acme'))
  const otherTenant = sensitiveRateLimitKey(request('198.51.100.1', 'person@example.com', 'other'))

  assert.equal(first, rotatedIp)
  assert.notEqual(first, otherAccount)
  assert.notEqual(first, otherTenant)
})

function request(ip: string, email: string, slug: string): FastifyRequest {
  return {
    ip,
    params: { slug },
    body: { email },
    routeOptions: { url: '/t/:slug/interaction/:uid/login' },
  } as unknown as FastifyRequest
}

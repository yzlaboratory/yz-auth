import assert from 'node:assert/strict'
import test from 'node:test'
import formbody from '@fastify/formbody'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { sensitiveRateLimitKey } from '../src/web/rate-limit.js'

test('the account throttle uses the parsed form email across source IPs', async () => {
  const server = Fastify()
  await server.register(formbody)
  await server.register(rateLimit, { hook: 'preHandler' })
  server.post('/login', {
    config: {
      rateLimit: {
        max: 1,
        timeWindow: '1 minute',
        keyGenerator: sensitiveRateLimitKey,
      },
    },
  }, async () => ({ accepted: true }))

  const first = await submit(server, '198.51.100.1')
  const rotatedIp = await submit(server, '203.0.113.2')

  assert.equal(first.statusCode, 200)
  assert.equal(rotatedIp.statusCode, 429)
  await server.close()
})

function submit(server: ReturnType<typeof Fastify>, remoteAddress: string) {
  return server.inject({
    method: 'POST',
    url: '/login',
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'email=person%40example.com',
  })
}

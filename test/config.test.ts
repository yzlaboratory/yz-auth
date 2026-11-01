import assert from 'node:assert/strict'
import test from 'node:test'
import { loadConfig } from '../src/config.js'

const baseEnvironment = {
  DATABASE_URL: 'postgres://localhost/yz_auth',
  COOKIE_KEYS: '12345678901234567890123456789012',
  KEY_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  EMAIL_DRIVER: 'memory',
}

test('configuration creates a memory email driver for tests', () => {
  const config = loadConfig(baseEnvironment)

  assert.equal(config.environment, 'development')
  assert.equal(config.email.driver, 'memory')
  assert.equal(config.publicBaseUrl, 'http://localhost:3000')
})

test('production requires HTTPS and SES', () => {
  assert.throws(() => loadConfig({
    ...baseEnvironment,
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'http://auth.example.com',
  }), /HTTPS/)

  assert.throws(() => loadConfig({
    ...baseEnvironment,
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://auth.example.com',
  }), /must be ses/)

  const config = loadConfig({
    ...baseEnvironment,
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://auth.example.com',
    EMAIL_DRIVER: 'ses',
    SES_FROM_ADDRESS: 'no-reply@mail.example.com',
  })
  assert.equal(config.email.driver, 'ses')
})

test('encryption and cookie keys must have sufficient entropy', () => {
  assert.throws(() => loadConfig({
    ...baseEnvironment,
    KEY_ENCRYPTION_KEY: 'c2hvcnQ=',
  }), /32 bytes/)

  assert.throws(() => loadConfig({
    ...baseEnvironment,
    COOKIE_KEYS: 'short',
  }), /32 characters/)
})

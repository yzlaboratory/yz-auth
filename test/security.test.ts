import assert from 'node:assert/strict'
import test from 'node:test'
import { hashPassword, verifyPassword } from '../src/security/passwords.js'
import { decryptSecret, encryptSecret } from '../src/security/secret-cipher.js'
import { createOneTimeToken, hashBearerToken, normalizeEmail } from '../src/security/tokens.js'

test('password hashes verify only the original password', async () => {
  const encoded = await hashPassword('a-secure-password')

  assert.match(encoded, /^\$argon2id\$/)
  assert.equal(await verifyPassword('a-secure-password', encoded), true)
  assert.equal(await verifyPassword('a-different-password', encoded), false)
})

test('secret encryption round trips and detects tampering', () => {
  const key = Buffer.alloc(32, 7)
  const encrypted = encryptSecret('private signing key', key)

  assert.notEqual(encrypted, 'private signing key')
  assert.equal(decryptSecret(encrypted, key), 'private signing key')

  const parts = encrypted.split('.')
  const payload = parts[3]!
  parts[3] = `${payload[0] === 'A' ? 'B' : 'A'}${payload.slice(1)}`
  assert.throws(() => decryptSecret(parts.join('.'), key))
})

test('one-time tokens can be reconstructed without storing their raw values', () => {
  const key = Buffer.alloc(32, 9)
  const first = createOneTimeToken('first-token-id', key)
  const second = createOneTimeToken('second-token-id', key)

  assert.equal(first, createOneTimeToken('first-token-id', key))
  assert.notEqual(first, second)
  assert.equal(hashBearerToken(first), hashBearerToken(first))
  assert.notEqual(hashBearerToken(first), hashBearerToken(second))
  assert.equal(normalizeEmail(' Person@Example.COM '), 'person@example.com')
})

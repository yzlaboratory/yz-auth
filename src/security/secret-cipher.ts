import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function createEncryptionKey(): string {
  return randomBytes(32).toString('base64')
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authenticationTag = cipher.getAuthTag()

  return [
    'v1',
    initializationVector.toString('base64url'),
    authenticationTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  const [version, encodedVector, encodedTag, encodedPayload, ...extra] = ciphertext.split('.')

  if (version !== 'v1' || !encodedVector || !encodedTag || !encodedPayload || extra.length > 0) {
    throw new Error('Encrypted secret has an invalid format')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encodedVector, 'base64url'))
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encodedPayload, 'base64url')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

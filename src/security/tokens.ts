import { createHash, createHmac } from 'node:crypto'

export function createOneTimeToken(identifier: string, signingKey: Buffer): string {
  const signature = createHmac('sha256', signingKey)
    .update('yz-auth-one-time-token-v1')
    .update(identifier)
    .digest('base64url')

  return `${identifier}.${signature}`
}

export function hashBearerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

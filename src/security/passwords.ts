import { randomBytes } from 'node:crypto'
import { argon2id, argon2Verify } from 'hash-wasm'
import { z } from 'zod'

export const passwordSchema = z.string().min(12).max(128)

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password: password.normalize('NFKC'),
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 2,
    memorySize: 19_456,
    hashLength: 32,
    outputType: 'encoded',
  })
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  return argon2Verify({
    password: password.normalize('NFKC'),
    hash: encodedHash,
  })
}

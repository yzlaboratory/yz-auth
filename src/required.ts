import { ClientError } from './client-error.js'

export function required(value: string | undefined, description: string): string {
  if (!value) {
    throw new ClientError(`${description} is required`)
  }

  return value
}

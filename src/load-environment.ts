import { existsSync } from 'node:fs'

export function loadEnvironmentFile(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env')
  }
}

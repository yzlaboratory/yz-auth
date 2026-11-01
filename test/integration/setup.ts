import type { Application } from '../../src/app.js'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import { createDatabase, migrateDatabase, type Database } from '../../src/db/database.js'
import { EmailOutboxWorker } from '../../src/email/outbox-worker.js'
import { MemoryMailSender } from './memory-mail-sender.js'
import type { AccountService } from '../../src/accounts/account-service.js'
import type { TenantService } from '../../src/tenants/tenant-service.js'

export const integrationConfig: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 0,
  publicBaseUrl: 'http://localhost',
  trustProxy: false,
  databaseUrl: process.env.TEST_DATABASE_URL ?? '',
  cookieKeys: ['integration-test-cookie-key-1234567890'],
  encryptionKey: Buffer.alloc(32, 11),
  email: {
    driver: 'smtp',
    from: 'yz-auth <no-reply@localhost>',
    host: 'localhost',
    port: 1025,
    secure: false,
  },
  emailOutboxPollMs: 60_000,
}

export interface IntegrationContext {
  application: Application
  database: Database
  tenants: TenantService
  accounts: AccountService
  mailSender: MemoryMailSender
}

export async function createIntegrationContext(): Promise<IntegrationContext> {
  if (!integrationConfig.databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for integration tests')
  }

  const setupDatabase = createDatabase(integrationConfig.databaseUrl)
  try {
    await migrateDatabase(setupDatabase)
  } finally {
    await setupDatabase.end()
  }

  const mailSender = new MemoryMailSender()
  const application = await buildApp(integrationConfig, { mailSender, startOutboxWorker: false })
  const database = application.database
  await clearDatabase(database)

  return {
    application,
    database,
    tenants: application.tenants,
    accounts: application.accounts,
    mailSender,
  }
}

export async function clearDatabase(database: Database): Promise<void> {
  await database`
    truncate table
      email_outbox, audit_events, oidc_models, one_time_tokens,
      clients, accounts, tenants
    cascade
  `
}

export async function deliverNextEmail(context: IntegrationContext): Promise<void> {
  const worker = new EmailOutboxWorker(
    context.database,
    context.mailSender,
    60_000,
    () => undefined,
    integrationConfig.encryptionKey,
    integrationConfig.publicBaseUrl,
  )

  if (!await worker.deliverNext()) {
    throw new Error('No pending email found')
  }
}

export function extractSecurityToken(textBody: string, path: 'verify' | 'reset-password'): string {
  const match = textBody.match(new RegExp(`/${path}\\?token=([^&\\s]+)`))
  const token = match?.[1]
  if (!token) {
    throw new Error(`No ${path} token found in email`)
  }

  return token
}

import path from 'node:path'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import view from '@fastify/view'
import ejs from 'ejs'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { registerAccountRoutes } from './accounts/routes.js'
import { AccountService } from './accounts/account-service.js'
import { ClientError } from './client-error.js'
import type { AppConfig } from './config.js'
import { createDatabase, type Database } from './db/database.js'
import { EmailOutboxWorker } from './email/outbox-worker.js'
import { createMailSender, type MailSender } from './email/sender.js'
import { registerInteractionRoutes } from './oidc/interaction-routes.js'
import { purgeExpiredOidcModels } from './oidc/postgres-adapter.js'
import { OidcProviderManager } from './oidc/provider-manager.js'
import { registerOidcRoutes } from './oidc/routes.js'
import { TenantService } from './tenants/tenant-service.js'
import { renderMessage } from './web/responses.js'
import { authenticationStyles } from './web/styles.js'

export interface Application {
  server: FastifyInstance
  database: Database
  tenants: TenantService
  accounts: AccountService
}

export async function buildApp(
  config: AppConfig,
  dependencies: { mailSender?: MailSender; startOutboxWorker?: boolean } = {},
): Promise<Application> {
  const database = createDatabase(config.databaseUrl)

  const tenants = new TenantService(database, config.encryptionKey)
  const accounts = new AccountService(database, config.encryptionKey)
  const providers = new OidcProviderManager(database, tenants, accounts, config)
  const mailSender = dependencies.mailSender ?? createMailSender(config.email)
  const startOutboxWorker = dependencies.startOutboxWorker ?? true
  const server = Fastify({
    logger: config.environment === 'test' ? false : {
      level: 'info',
      redact: {
        paths: [
          'req.url',
          'req.headers.cookie',
          'req.headers.authorization',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
  })
  const outboxWorker = new EmailOutboxWorker(
    database,
    mailSender,
    config.emailOutboxPollMs,
    (error) => server.log.error(error),
    config.encryptionKey,
    config.publicBaseUrl,
  )
  const maintenanceTimer = setInterval(() => {
    purgeExpiredOidcModels(database).catch((error: unknown) => server.log.error(error))
  }, 60 * 60 * 1000)
  maintenanceTimer.unref()

  await server.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
  })

  server.get('/health/live', async () => ({ status: 'ok' }))
  server.get('/health/ready', async () => {
    await database`select 1`
    return { status: 'ok' }
  })

  await server.register(async (web) => {
    await web.register(cookie)
    await web.register(formbody)
    await web.register(view, {
      engine: { ejs },
      root: path.join(process.cwd(), 'src/web/views'),
    })
    await web.register(rateLimit, {
      max: 200,
      timeWindow: '1 minute',
      hook: 'preHandler',
    })

    web.get('/assets/auth.css', async (_request, reply) => {
      return reply
        .type('text/css; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .send(authenticationStyles)
    })

    registerAccountRoutes(web, accounts, tenants, config)
    registerInteractionRoutes(web, providers, accounts, tenants, config)

    web.setErrorHandler(async (error, _request, reply) => {
      const statusCode = errorStatus(error)
      if (statusCode === 500) {
        web.log.error(error)
      }

      try {
        return await renderMessage(
          reply,
          statusCode,
          'yz-auth',
          'Request error',
          'The request could not be completed.',
        )
      } catch {
        return reply.code(statusCode).type('text/html; charset=utf-8').send(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Request error</title><h1>Request error</h1><p>The request could not be completed.</p></html>',
        )
      }
    })
  })

  await server.register(async (oidc) => {
    oidc.addContentTypeParser('application/x-www-form-urlencoded', (_request, _payload, done) => {
      done(null, undefined)
    })
    registerOidcRoutes(oidc, providers)
  })

  server.addHook('onReady', async () => {
    if (startOutboxWorker) {
      outboxWorker.start()
    }
  })
  server.addHook('onClose', async () => {
    await outboxWorker.stop()
    clearInterval(maintenanceTimer)
    await database.end()
  })

  return { server, database, tenants, accounts }
}

function errorStatus(error: unknown): number {
  if (error instanceof ClientError) {
    return error.statusCode
  }
  if (error instanceof ZodError) {
    return 400
  }
  if (error instanceof Error && 'statusCode' in error) {
    const statusCode = error.statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return statusCode
    }
  }

  return 500
}

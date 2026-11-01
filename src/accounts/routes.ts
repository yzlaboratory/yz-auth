import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../config.js'
import { required } from '../required.js'
import type { TenantService } from '../tenants/tenant-service.js'
import { hasValidCsrfToken, issueCsrfToken } from '../web/csrf.js'
import { sensitiveRateLimit } from '../web/rate-limit.js'
import { renderInvalidCsrf, renderMessage } from '../web/responses.js'
import { requireActiveTenant } from '../web/tenant-context.js'
import type { AccountService } from './account-service.js'

interface TenantParams {
  slug: string
}

interface InteractionQuery {
  interaction?: string
  token?: string
}

interface EmailBody {
  email?: string
  password?: string
  interaction?: string
  token?: string
  _csrf?: string
}

export function registerAccountRoutes(
  app: FastifyInstance,
  accounts: AccountService,
  tenants: TenantService,
  config: AppConfig,
): void {
  app.get<{ Params: TenantParams; Querystring: InteractionQuery }>(
    '/t/:slug/signup',
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return

      return reply.viewAsync('signup.ejs', {
        tenantName: tenant.name,
        slug: tenant.slug,
        interactionUid: interactionUid(request.query.interaction),
        email: '',
        error: null,
        csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
      })
    },
  )

  app.post<{ Params: TenantParams; Body: EmailBody }>(
    '/t/:slug/signup',
    { config: { rateLimit: sensitiveRateLimit } },
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return
      if (!hasValidCsrfToken(request, request.body._csrf)) {
        return renderInvalidCsrf(reply, tenant)
      }

      try {
        await accounts.signUp({
          tenant,
          email: required(request.body.email, 'email'),
          password: required(request.body.password, 'password'),
          interactionUid: interactionUid(request.body.interaction),
          ipAddress: request.ip,
        })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).viewAsync('signup.ejs', {
            tenantName: tenant.name,
            slug: tenant.slug,
            interactionUid: interactionUid(request.body.interaction),
            email: request.body.email ?? '',
            error: validationMessage(error),
            csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
          })
        }
        throw error
      }

      return renderCheckYourInbox(reply, tenant.name)
    },
  )

  app.get<{ Params: TenantParams; Querystring: InteractionQuery }>(
    '/t/:slug/resend-verification',
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return

      return reply.viewAsync('email-request.ejs', {
        title: 'Resend verification',
        tenantName: tenant.name,
        instructions: 'Enter your account email to request a new verification link.',
        action: `/t/${tenant.slug}/resend-verification`,
        buttonText: 'Resend verification',
        interactionUid: interactionUid(request.query.interaction),
        csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
      })
    },
  )

  app.post<{ Params: TenantParams; Body: EmailBody }>(
    '/t/:slug/resend-verification',
    { config: { rateLimit: sensitiveRateLimit } },
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return
      if (!hasValidCsrfToken(request, request.body._csrf)) {
        return renderInvalidCsrf(reply, tenant)
      }

      const startedAt = performance.now()
      await accounts.resendVerification({
        tenant,
        email: required(request.body.email, 'email'),
        interactionUid: interactionUid(request.body.interaction),
        ipAddress: request.ip,
      })
      await ensureMinimumDuration(startedAt, 300)

      return renderCheckYourInbox(reply, tenant.name)
    },
  )

  app.get<{ Params: TenantParams; Querystring: InteractionQuery }>(
    '/t/:slug/verify',
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return

      const verified = await accounts.verifyEmail({
        tenant,
        token: required(request.query.token, 'token'),
        ipAddress: request.ip,
      })
      if (!verified) {
        return renderMessage(reply, 400, tenant.name, 'Invalid verification link', 'This verification link is invalid, used, or expired. Request a new one.')
      }

      const interaction = interactionUid(request.query.interaction)
      const action = interaction
        ? { url: `/t/${tenant.slug}/interaction/${interaction}`, text: 'Continue to login' }
        : null
      return renderMessage(reply, 200, tenant.name, 'Email verified', 'Your email is verified. You can now log in.', action)
    },
  )

  app.get<{ Params: TenantParams }>(
    '/t/:slug/forgot-password',
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return

      return reply.viewAsync('email-request.ejs', {
        title: 'Reset your password',
        tenantName: tenant.name,
        instructions: 'Enter your account email. If it is registered, a reset link will be sent.',
        action: `/t/${tenant.slug}/forgot-password`,
        buttonText: 'Send reset link',
        interactionUid: '',
        csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
      })
    },
  )

  app.post<{ Params: TenantParams; Body: EmailBody }>(
    '/t/:slug/forgot-password',
    { config: { rateLimit: sensitiveRateLimit } },
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return
      if (!hasValidCsrfToken(request, request.body._csrf)) {
        return renderInvalidCsrf(reply, tenant)
      }

      const startedAt = performance.now()
      await accounts.requestPasswordReset({
        tenant,
        email: required(request.body.email, 'email'),
        ipAddress: request.ip,
      })
      await ensureMinimumDuration(startedAt, 300)

      return renderCheckYourInbox(reply, tenant.name)
    },
  )

  app.get<{ Params: TenantParams; Querystring: InteractionQuery }>(
    '/t/:slug/reset-password',
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return

      const token = required(request.query.token, 'token')
      if (!await accounts.isPasswordResetTokenValid(tenant, token)) {
        return renderInvalidResetLink(reply, tenant.name)
      }

      return reply.viewAsync('reset-password.ejs', {
        tenantName: tenant.name,
        slug: tenant.slug,
        token,
        error: null,
        csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
      })
    },
  )

  app.post<{ Params: TenantParams; Body: EmailBody }>(
    '/t/:slug/reset-password',
    { config: { rateLimit: sensitiveRateLimit } },
    async (request, reply) => {
      const tenant = await requireActiveTenant(request, reply, tenants)
      if (!tenant) return
      if (!hasValidCsrfToken(request, request.body._csrf)) {
        return renderInvalidCsrf(reply, tenant)
      }

      let reset: boolean
      try {
        reset = await accounts.resetPassword({
          tenant,
          token: required(request.body.token, 'token'),
          password: required(request.body.password, 'password'),
          ipAddress: request.ip,
        })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).viewAsync('reset-password.ejs', {
            tenantName: tenant.name,
            slug: tenant.slug,
            token: request.body.token ?? '',
            error: validationMessage(error),
            csrfToken: issueCsrfToken(request, reply, config.environment === 'production'),
          })
        }
        throw error
      }
      if (!reset) {
        return renderInvalidResetLink(reply, tenant.name)
      }

      return renderMessage(reply, 200, tenant.name, 'Password reset', 'Your password has been changed. Existing sessions have been revoked; you can now log in again.')
    },
  )
}

function validationMessage(error: z.ZodError): string {
  const paths = new Set(error.issues.flatMap((issue) => issue.path))
  if (paths.has('password')) {
    return 'Use a password of 12 to 128 characters.'
  }
  if (paths.has('email')) {
    return 'Enter a valid email address.'
  }

  return 'Check the form and try again.'
}

function interactionUid(value: string | undefined): string {
  if (!value) {
    return ''
  }

  return z.string().max(200).regex(/^[A-Za-z0-9_-]+$/).parse(value)
}

function renderCheckYourInbox(reply: FastifyReply, tenantName: string): Promise<string> {
  return renderMessage(
    reply,
    200,
    tenantName,
    'Check your inbox',
    'If the email address can be used, a message with next steps has been sent.',
  )
}

function renderInvalidResetLink(reply: FastifyReply, tenantName: string): Promise<string> {
  return renderMessage(reply, 400, tenantName, 'Invalid reset link', 'This password reset link is invalid, used, or expired. Request a new one.')
}

async function ensureMinimumDuration(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (performance.now() - startedAt)
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}

import type { Database } from '../db/database.js'
import { createOneTimeToken } from '../security/tokens.js'
import type { MailSender } from './sender.js'
import { createPasswordResetEmail, createVerificationEmail } from './templates.js'

interface OutboxRow {
  id: string
  token_id: string
  recipient: string
  kind: 'email_verification' | 'password_reset'
  interaction_uid: string | null
  attempts: number
  consumed_at: string | null
  expires_at: string
  tenant_slug: string
  tenant_name: string
}

export class EmailOutboxWorker {
  private timer: NodeJS.Timeout | null = null
  private activeDelivery: Promise<void> | null = null
  private isDelivering = false

  constructor(
    private readonly database: Database,
    private readonly sender: MailSender,
    private readonly pollIntervalMs: number,
    private readonly reportError: (error: unknown) => void,
    private readonly tokenSigningKey: Buffer,
    private readonly publicBaseUrl: string,
  ) {}

  start(): void {
    if (this.timer) {
      return
    }

    const deliver = () => {
      if (this.isDelivering) {
        return
      }

      this.activeDelivery = this.deliverSafely()
    }
    this.timer = setInterval(deliver, this.pollIntervalMs)
    this.timer.unref()
    deliver()
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    await this.activeDelivery
  }

  async deliverNext(): Promise<boolean> {
    const rows = await this.database<OutboxRow[]>`
      select
        email_outbox.id, email_outbox.token_id, email_outbox.recipient,
        email_outbox.kind, email_outbox.interaction_uid, email_outbox.attempts,
        one_time_tokens.consumed_at::text as consumed_at,
        one_time_tokens.expires_at::text as expires_at,
        tenants.slug as tenant_slug, tenants.name as tenant_name
      from email_outbox
      join one_time_tokens on one_time_tokens.id = email_outbox.token_id
      join tenants on tenants.id = email_outbox.tenant_id
      where email_outbox.status = 'pending' and email_outbox.next_attempt_at <= now()
      order by email_outbox.created_at
      limit 1
      for update of email_outbox skip locked
    `
    const email = rows[0]

    if (!email) {
      return false
    }

    if (email.consumed_at || Date.parse(email.expires_at) <= Date.now()) {
      await this.database`
        update email_outbox set status = 'cancelled' where id = ${email.id}
      `
      return true
    }

    const token = createOneTimeToken(email.token_id, this.tokenSigningKey)
    const actionPath = email.kind === 'email_verification' ? '/verify' : '/reset-password'
    const actionUrl = new URL(`/t/${email.tenant_slug}${actionPath}`, this.publicBaseUrl)
    actionUrl.searchParams.set('token', token)
    if (email.interaction_uid) {
      actionUrl.searchParams.set('interaction', email.interaction_uid)
    }

    const message = email.kind === 'email_verification'
      ? createVerificationEmail({
          tenantName: email.tenant_name,
          recipient: email.recipient,
          verificationUrl: actionUrl.toString(),
        })
      : createPasswordResetEmail({
          tenantName: email.tenant_name,
          recipient: email.recipient,
          resetUrl: actionUrl.toString(),
        })

    try {
      const result = await this.sender.send(message)
      await this.database`
        update email_outbox set
          status = 'sent', provider_message_id = ${result.providerMessageId},
          sent_at = now(), last_error = null
        where id = ${email.id} and status = 'pending'
      `
    } catch (error) {
      const attempts = email.attempts + 1
      const status = attempts >= 10 ? 'failed' : 'pending'
      const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10) * 5)
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000)
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Email delivery failed'

      await this.database`
        update email_outbox set
          status = ${status}, attempts = ${attempts}, next_attempt_at = ${nextAttemptAt},
          last_error = ${message}
        where id = ${email.id}
      `

      throw error
    }

    return true
  }

  private async deliverSafely(): Promise<void> {
    this.isDelivering = true
    try {
      await this.deliverNext()
    } catch (error) {
      this.reportError(error)
    } finally {
      this.isDelivering = false
    }
  }
}

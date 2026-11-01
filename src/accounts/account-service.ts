import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { recordAuditEvent } from '../audit/record-audit-event.js'
import type { Database, Queryable } from '../db/database.js'
import { enqueueEmail } from '../email/outbox.js'
import { hashPassword, passwordSchema, verifyPassword } from '../security/passwords.js'
import { createOneTimeToken, hashBearerToken } from '../security/tokens.js'
import type { Tenant } from '../tenants/tenant-service.js'
import { normalizeEmail } from './email.js'

const emailSchema = z.email().max(254)
const loginInputSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) })
const verificationLifetimeMs = 24 * 60 * 60 * 1000
const passwordResetLifetimeMs = 60 * 60 * 1000

export interface Account {
  id: string
  tenantId: string
  email: string
  normalizedEmail: string
  passwordHash: string
  status: 'active' | 'disabled'
  emailVerifiedAt: string | null
}

export type AuthenticationResult =
  | { status: 'success'; account: Account }
  | { status: 'invalid' | 'unverified' }

interface AccountRow {
  id: string
  tenant_id: string
  email: string
  normalized_email: string
  password_hash: string
  status: 'active' | 'disabled'
  email_verified_at: string | null
}

interface TokenIssueInput {
  tenantId: string
  accountId: string
  kind: 'email_verification' | 'password_reset'
  lifetimeMs: number
}

export class AccountService {
  constructor(
    private readonly database: Database,
    private readonly tokenSigningKey: Buffer,
  ) {}

  async signUp(input: {
    tenant: Tenant
    email: string
    password: string
    interactionUid: string | null
    ipAddress: string | null
  }): Promise<boolean> {
    const email = emailSchema.parse(input.email)
    const password = passwordSchema.parse(input.password)
    const normalizedEmail = normalizeEmail(email)
    const passwordHash = await hashPassword(password)

    return this.database.begin(async (transaction) => {
      const inserted = await transaction<AccountRow[]>`
        insert into accounts (
          id, tenant_id, email, normalized_email, password_hash, status
        ) values (
          ${randomUUID()}, ${input.tenant.id}, ${email}, ${normalizedEmail}, ${passwordHash}, 'active'
        )
        on conflict (tenant_id, normalized_email) do nothing
        returning ${this.accountColumns}
      `

      const account = inserted.length === 0 ? null : this.mapAccount(inserted[0]!)
      if (!account) {
        return false
      }

      const tokenId = await this.issueToken(transaction, {
        tenantId: account.tenantId,
        accountId: account.id,
        kind: 'email_verification',
        lifetimeMs: verificationLifetimeMs,
      })

      await enqueueEmail(transaction, {
        tenantId: account.tenantId,
        tokenId,
        recipient: account.email,
        kind: 'email_verification',
        interactionUid: input.interactionUid,
      })
      await recordAuditEvent(transaction, {
        tenantId: account.tenantId,
        accountId: account.id,
        eventType: 'account.signup',
        ipAddress: input.ipAddress,
      })

      return true
    })
  }

  async resendVerification(input: {
    tenant: Tenant
    email: string
    interactionUid: string | null
    ipAddress: string | null
  }): Promise<void> {
    const email = emailSchema.parse(input.email)
    const normalizedEmail = normalizeEmail(email)
    const account = await this.findAccountByEmail(input.tenant.id, normalizedEmail)

    if (!account || account.status !== 'active' || account.emailVerifiedAt) {
      return
    }

    await this.database.begin(async (transaction) => {
      await this.invalidateTokens(transaction, account, 'email_verification')
      const tokenId = await this.issueToken(transaction, {
        tenantId: account.tenantId,
        accountId: account.id,
        kind: 'email_verification',
        lifetimeMs: verificationLifetimeMs,
      })

      await enqueueEmail(transaction, {
        tenantId: account.tenantId,
        tokenId,
        recipient: account.email,
        kind: 'email_verification',
        interactionUid: input.interactionUid,
      })
      await recordAuditEvent(transaction, {
        tenantId: account.tenantId,
        accountId: account.id,
        eventType: 'account.verification_resent',
        ipAddress: input.ipAddress,
      })
    })
  }

  async verifyEmail(input: {
    tenant: Tenant
    token: string
    ipAddress: string | null
  }): Promise<boolean> {
    const tokenHash = hashBearerToken(input.token)

    return this.database.begin(async (transaction) => {
      const consumed = await transaction<{ account_id: string }[]>`
        update one_time_tokens set consumed_at = now()
        where tenant_id = ${input.tenant.id}
          and kind = 'email_verification'
          and token_hash = ${tokenHash}
          and consumed_at is null
          and expires_at > now()
        returning account_id
      `

      const accountId = consumed[0]?.account_id
      if (!accountId) {
        return false
      }

      const updated = await transaction`
        update accounts set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
        where tenant_id = ${input.tenant.id} and id = ${accountId} and status = 'active'
      `

      if (updated.count === 0) {
        return false
      }

      await recordAuditEvent(transaction, {
        tenantId: input.tenant.id,
        accountId,
        eventType: 'account.email_verified',
        ipAddress: input.ipAddress,
      })

      return true
    })
  }

  async authenticate(input: {
    tenant: Tenant
    email: string
    password: string
    ipAddress: string | null
  }): Promise<AuthenticationResult> {
    const parsed = loginInputSchema.safeParse({ email: input.email, password: input.password })
    if (!parsed.success) {
      return { status: 'invalid' }
    }

    const { email, password } = parsed.data
    const normalizedEmail = normalizeEmail(email)
    const account = await this.findAccountByEmail(input.tenant.id, normalizedEmail)

    if (!account) {
      await hashPassword(password)
      return { status: 'invalid' }
    }

    const isValid = await verifyPassword(password, account.passwordHash)
    if (!isValid || account.status !== 'active') {
      await recordAuditEvent(this.database, {
        tenantId: account.tenantId,
        accountId: account.id,
        eventType: 'account.login_failed',
        ipAddress: input.ipAddress,
      })
      return { status: 'invalid' }
    }

    if (!account.emailVerifiedAt) {
      await recordAuditEvent(this.database, {
        tenantId: account.tenantId,
        accountId: account.id,
        eventType: 'account.login_rejected_unverified',
        ipAddress: input.ipAddress,
      })
      return { status: 'unverified' }
    }

    await recordAuditEvent(this.database, {
      tenantId: account.tenantId,
      accountId: account.id,
      eventType: 'account.login_succeeded',
      ipAddress: input.ipAddress,
    })

    return { status: 'success', account }
  }

  async requestPasswordReset(input: {
    tenant: Tenant
    email: string
    ipAddress: string | null
  }): Promise<void> {
    const email = emailSchema.parse(input.email)
    const account = await this.findAccountByEmail(input.tenant.id, normalizeEmail(email))

    if (!account || account.status !== 'active' || !account.emailVerifiedAt) {
      return
    }

    await this.database.begin(async (transaction) => {
      await this.invalidateTokens(transaction, account, 'password_reset')
      const tokenId = await this.issueToken(transaction, {
        tenantId: account.tenantId,
        accountId: account.id,
        kind: 'password_reset',
        lifetimeMs: passwordResetLifetimeMs,
      })

      await enqueueEmail(transaction, {
        tenantId: account.tenantId,
        tokenId,
        recipient: account.email,
        kind: 'password_reset',
        interactionUid: null,
      })
      await recordAuditEvent(transaction, {
        tenantId: account.tenantId,
        accountId: account.id,
        eventType: 'account.password_reset_requested',
        ipAddress: input.ipAddress,
      })
    })
  }

  async isPasswordResetTokenValid(tenant: Tenant, token: string): Promise<boolean> {
    const rows = await this.database<{ id: string }[]>`
      select id from one_time_tokens
      where tenant_id = ${tenant.id}
        and kind = 'password_reset'
        and token_hash = ${hashBearerToken(token)}
        and consumed_at is null
        and expires_at > now()
    `

    return rows.length === 1
  }

  async resetPassword(input: {
    tenant: Tenant
    token: string
    password: string
    ipAddress: string | null
  }): Promise<boolean> {
    const password = passwordSchema.parse(input.password)
    const tokenHash = hashBearerToken(input.token)
    const tokens = await this.database<{ account_id: string }[]>`
      select account_id from one_time_tokens
      where tenant_id = ${input.tenant.id}
        and kind = 'password_reset'
        and token_hash = ${tokenHash}
        and consumed_at is null
        and expires_at > now()
    `

    if (tokens.length === 0) {
      return false
    }

    const passwordHash = await hashPassword(password)

    return this.database.begin(async (transaction) => {
      const consumed = await transaction<{ account_id: string }[]>`
        update one_time_tokens set consumed_at = now()
        where tenant_id = ${input.tenant.id}
          and kind = 'password_reset'
          and token_hash = ${tokenHash}
          and consumed_at is null
          and expires_at > now()
        returning account_id
      `

      const accountId = consumed[0]?.account_id
      if (!accountId) {
        return false
      }

      const updated = await transaction`
        update accounts set password_hash = ${passwordHash}, updated_at = now()
        where tenant_id = ${input.tenant.id} and id = ${accountId} and status = 'active'
      `

      if (updated.count === 0) {
        throw new Error('Password reset account is not active')
      }

      await transaction`
        update one_time_tokens set consumed_at = now()
        where tenant_id = ${input.tenant.id} and account_id = ${accountId}
          and kind = 'password_reset' and consumed_at is null
      `
      await this.revokeAuthenticationState(transaction, input.tenant.id, accountId)
      await recordAuditEvent(transaction, {
        tenantId: input.tenant.id,
        accountId,
        eventType: 'account.password_reset_completed',
        ipAddress: input.ipAddress,
      })

      return true
    })
  }

  async findAccount(tenantId: string, accountId: string): Promise<Account | null> {
    const rows = await this.database<AccountRow[]>`
      select ${this.accountColumns} from accounts
      where tenant_id = ${tenantId} and id = ${accountId}
    `

    return rows.length === 0 ? null : this.mapAccount(rows[0]!)
  }

  private get accountColumns() {
    return this.database`
      id, tenant_id, email, normalized_email, password_hash, status, email_verified_at::text as email_verified_at
    `
  }

  private async findAccountByEmail(tenantId: string, normalizedEmail: string): Promise<Account | null> {
    const rows = await this.database<AccountRow[]>`
      select ${this.accountColumns} from accounts
      where tenant_id = ${tenantId} and normalized_email = ${normalizedEmail}
    `

    return rows.length === 0 ? null : this.mapAccount(rows[0]!)
  }

  private mapAccount(row: AccountRow): Account {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      normalizedEmail: row.normalized_email,
      passwordHash: row.password_hash,
      status: row.status,
      emailVerifiedAt: row.email_verified_at,
    }
  }

  private async issueToken(
    database: Queryable,
    input: TokenIssueInput,
  ): Promise<string> {
    const tokenId = randomUUID()
    const token = createOneTimeToken(tokenId, this.tokenSigningKey)
    const expiresAt = new Date(Date.now() + input.lifetimeMs)

    await database`
      insert into one_time_tokens (
        id, tenant_id, account_id, kind, token_hash, expires_at
      ) values (
        ${tokenId}, ${input.tenantId}, ${input.accountId}, ${input.kind},
        ${hashBearerToken(token)}, ${expiresAt}
      )
    `

    return tokenId
  }

  private async invalidateTokens(
    database: Queryable,
    account: Account,
    kind: 'email_verification' | 'password_reset',
  ): Promise<void> {
    await database`
      update one_time_tokens set consumed_at = now()
      where tenant_id = ${account.tenantId} and account_id = ${account.id}
        and kind = ${kind} and consumed_at is null
    `
  }

  private async revokeAuthenticationState(
    database: Queryable,
    tenantId: string,
    accountId: string,
  ): Promise<void> {
    const grants = await database<{ grant_id: string }[]>`
      select distinct grant_id from oidc_models
      where tenant_id = ${tenantId} and account_id = ${accountId} and grant_id is not null
    `
    const grantIds = grants.map((grant) => grant.grant_id)

    await database`
      delete from oidc_models
      where tenant_id = ${tenantId}
        and (
          account_id = ${accountId}
          or (${database.json(grantIds)}::jsonb ? grant_id)
        )
    `
  }

}

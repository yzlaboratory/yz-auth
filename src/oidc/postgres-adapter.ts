import type { Adapter, AdapterPayload } from 'oidc-provider'
import type { Database } from '../db/database.js'

interface OidcModelRow {
  payload: AdapterPayload
  consumed_at: string | null
}

export class PostgresOidcAdapter implements Adapter {
  constructor(
    private readonly database: Database,
    private readonly tenantId: string,
    private readonly model: string,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    const expiresAt = expiresIn === undefined ? null : new Date(Date.now() + expiresIn * 1000)
    const grantId = payload.grantId ?? null
    const accountId = payload.accountId
      ?? payload.result?.login?.accountId
      ?? payload.session?.accountId
      ?? null
    const userCode = payload.userCode ?? null
    const uid = payload.uid ?? null

    if (this.model === 'ReplayDetection') {
      const inserted = await this.database<{ id: string }[]>`
        insert into oidc_models (
          tenant_id, model, id, payload, grant_id, account_id, user_code, uid, expires_at
        ) values (
          ${this.tenantId}, ${this.model}, ${id}, ${this.database.json(payload)},
          ${grantId}, ${accountId}, ${userCode}, ${uid}, ${expiresAt}
        )
        on conflict (tenant_id, model, id) do update set
          payload = excluded.payload, expires_at = excluded.expires_at, consumed_at = null
        where oidc_models.expires_at <= now()
        returning id
      `

      if (inserted.length === 0) {
        throw new Error('OIDC replay detected')
      }

      return
    }

    await this.database`
      insert into oidc_models (
        tenant_id, model, id, payload, grant_id, account_id, user_code, uid, expires_at
      ) values (
        ${this.tenantId}, ${this.model}, ${id}, ${this.database.json(payload)},
        ${grantId}, ${accountId}, ${userCode}, ${uid}, ${expiresAt}
      )
      on conflict (tenant_id, model, id) do update set
        payload = excluded.payload,
        grant_id = excluded.grant_id,
        account_id = excluded.account_id,
        user_code = excluded.user_code,
        uid = excluded.uid,
        expires_at = excluded.expires_at
    `
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const rows = await this.database<OidcModelRow[]>`
      select payload, consumed_at::text as consumed_at from oidc_models
      where tenant_id = ${this.tenantId} and model = ${this.model} and id = ${id}
        and (expires_at is null or expires_at > now())
    `

    return this.mapRow(rows[0])
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const rows = await this.database<OidcModelRow[]>`
      select payload, consumed_at::text as consumed_at from oidc_models
      where tenant_id = ${this.tenantId} and model = ${this.model} and user_code = ${userCode}
        and (expires_at is null or expires_at > now())
    `

    return this.mapRow(rows[0])
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const rows = await this.database<OidcModelRow[]>`
      select payload, consumed_at::text as consumed_at from oidc_models
      where tenant_id = ${this.tenantId} and model = ${this.model} and uid = ${uid}
        and (expires_at is null or expires_at > now())
    `

    return this.mapRow(rows[0])
  }

  async consume(id: string): Promise<void> {
    await this.database`
      update oidc_models set consumed_at = coalesce(consumed_at, now())
      where tenant_id = ${this.tenantId} and model = ${this.model} and id = ${id}
    `
  }

  async destroy(id: string): Promise<void> {
    await this.database`
      delete from oidc_models
      where tenant_id = ${this.tenantId} and model = ${this.model} and id = ${id}
    `
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.database`
      delete from oidc_models
      where tenant_id = ${this.tenantId} and model = ${this.model} and grant_id = ${grantId}
    `
  }

  private mapRow(row: OidcModelRow | undefined): AdapterPayload | undefined {
    if (!row) {
      return undefined
    }

    if (!row.consumed_at) {
      return row.payload
    }

    return {
      ...row.payload,
      consumed: row.consumed_at,
    }
  }
}

export async function purgeExpiredOidcModels(database: Database): Promise<void> {
  await database`
    delete from oidc_models where expires_at is not null and expires_at <= now()
  `
}

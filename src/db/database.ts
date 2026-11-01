import postgres, { type Sql, type TransactionSql } from 'postgres'

export type Database = Sql
export type Queryable = Sql | TransactionSql

export function createDatabase(databaseUrl: string): Database {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })
}

export async function migrateDatabase(database: Database): Promise<void> {
  const connection = await database.reserve()

  try {
    await connection`select pg_advisory_lock(hashtext('yz-auth-migrations'))`
    await connection`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `

    for (const migration of migrations) {
      const existing = await connection<{ version: string }[]>`
        select version from schema_migrations where version = ${migration.version}
      `

      if (existing.length > 0) {
        continue
      }

      await connection.unsafe('begin')
      try {
        await connection.unsafe(migration.sql)
        await connection`
          insert into schema_migrations (version) values (${migration.version})
        `
        await connection.unsafe('commit')
      } catch (error) {
        await connection.unsafe('rollback')
        throw error
      }
    }
  } finally {
    await connection`select pg_advisory_unlock(hashtext('yz-auth-migrations'))`
    connection.release()
  }
}

const migrations = [
  {
    version: '0001_initial',
    sql: `
      create table tenants (
        id uuid primary key,
        slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
        name text not null,
        status text not null check (status in ('active', 'disabled')),
        signing_key_ciphertext text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table accounts (
        id uuid primary key,
        tenant_id uuid not null references tenants(id),
        email text not null,
        normalized_email text not null,
        password_hash text not null,
        status text not null check (status in ('active', 'disabled')),
        email_verified_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, normalized_email),
        unique (tenant_id, id)
      );

      create table clients (
        id uuid primary key,
        tenant_id uuid not null references tenants(id),
        name text not null,
        client_id text not null unique,
        secret_ciphertext text,
        redirect_uris jsonb not null,
        post_logout_redirect_uris jsonb not null,
        resource_uris jsonb not null,
        is_public boolean not null,
        status text not null check (status in ('active', 'disabled')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tenant_id, id),
        check ((is_public and secret_ciphertext is null) or (not is_public and secret_ciphertext is not null))
      );

      create table one_time_tokens (
        id uuid primary key,
        tenant_id uuid not null,
        account_id uuid not null,
        kind text not null check (kind in ('email_verification', 'password_reset')),
        token_hash text not null unique,
        expires_at timestamptz not null,
        consumed_at timestamptz,
        created_at timestamptz not null default now(),
        foreign key (tenant_id, account_id) references accounts(tenant_id, id)
      );

      create index one_time_tokens_lookup on one_time_tokens (tenant_id, account_id, kind, consumed_at);
      create index one_time_tokens_expiry on one_time_tokens (expires_at) where consumed_at is null;

      create table oidc_models (
        tenant_id uuid not null references tenants(id),
        model text not null,
        id text not null,
        payload jsonb not null,
        grant_id text,
        account_id text,
        user_code text,
        uid text,
        expires_at timestamptz,
        consumed_at timestamptz,
        primary key (tenant_id, model, id)
      );

      create index oidc_models_grant on oidc_models (tenant_id, grant_id) where grant_id is not null;
      create index oidc_models_account on oidc_models (tenant_id, account_id) where account_id is not null;
      create index oidc_models_expiry on oidc_models (expires_at);
      create unique index oidc_models_user_code on oidc_models (tenant_id, model, user_code) where user_code is not null;
      create unique index oidc_models_uid on oidc_models (tenant_id, model, uid) where uid is not null;

      create table email_outbox (
        id uuid primary key,
        tenant_id uuid not null references tenants(id),
        token_id uuid not null references one_time_tokens(id),
        recipient text not null,
        kind text not null check (kind in ('email_verification', 'password_reset')),
        interaction_uid text,
        status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
        attempts integer not null default 0,
        next_attempt_at timestamptz not null default now(),
        last_error text,
        provider_message_id text,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      );

      create index email_outbox_pending on email_outbox (next_attempt_at, created_at) where status = 'pending';

      create table audit_events (
        id uuid primary key,
        tenant_id uuid not null references tenants(id),
        account_id uuid,
        event_type text not null,
        ip_address text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create index audit_events_tenant_time on audit_events (tenant_id, created_at desc);
      create index audit_events_account_time on audit_events (tenant_id, account_id, created_at desc);
    `,
  },
] as const

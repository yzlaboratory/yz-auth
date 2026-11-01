import { randomBytes, randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair } from 'jose'
import type { Configuration } from 'oidc-provider'
import { z } from 'zod'
import type { Database } from '../db/database.js'
import { decryptSecret, encryptSecret } from '../security/secret-cipher.js'

const tenantInputSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().trim().min(1).max(100),
})

const clientInputSchema = z.object({
  tenantSlug: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  redirectUris: z.array(z.string()).min(1).max(20),
  postLogoutRedirectUris: z.array(z.string()).max(20).default([]),
  resourceUris: z.array(z.string()).max(20).default([]),
  isPublic: z.boolean().default(false),
})

export interface Tenant {
  id: string
  slug: string
  name: string
  status: 'active' | 'disabled'
  updatedAt: string
}

export interface TenantWithSigningKey extends Tenant {
  signingKeyCiphertext: string
}

export interface OidcClient {
  id: string
  tenantId: string
  name: string
  clientId: string
  redirectUris: string[]
  postLogoutRedirectUris: string[]
  resourceUris: string[]
  isPublic: boolean
  status: 'active' | 'disabled'
  updatedAt: string
}

export interface OidcClientWithSecret extends OidcClient {
  clientSecret: string | null
}

export type ClientCreation = {
  client: OidcClient
  clientSecret: string | null
}

interface TenantRow {
  id: string
  slug: string
  name: string
  status: 'active' | 'disabled'
  signing_key_ciphertext: string
  updated_at: string
}

interface ClientRow {
  id: string
  tenant_id: string
  name: string
  client_id: string
  secret_ciphertext: string | null
  redirect_uris: string[]
  post_logout_redirect_uris: string[]
  resource_uris: string[]
  is_public: boolean
  status: 'active' | 'disabled'
  updated_at: string
}

export class TenantService {
  constructor(
    private readonly database: Database,
    private readonly encryptionKey: Buffer,
  ) {}

  async createTenant(input: { slug: string; name: string }): Promise<Tenant> {
    const tenant = tenantInputSchema.parse(input)
    const signingKeyCiphertext = await this.createSigningKey()
    const rows = await this.database<TenantRow[]>`
      insert into tenants (
        id, slug, name, status, signing_key_ciphertext
      ) values (
        ${randomUUID()}, ${tenant.slug}, ${tenant.name}, 'active', ${signingKeyCiphertext}
      )
      returning ${this.tenantColumns}
    `

    return this.mapTenant(requiredRow(rows, 'Tenant creation returned no row'))
  }

  async listTenants(): Promise<Tenant[]> {
    const rows = await this.database<TenantRow[]>`
      select ${this.tenantColumns} from tenants order by slug
    `

    return rows.map((row) => this.mapTenant(row))
  }

  async getTenant(slug: string): Promise<TenantWithSigningKey | null> {
    const rows = await this.database<TenantRow[]>`
      select ${this.tenantColumns}, signing_key_ciphertext
      from tenants where slug = ${slug}
    `

    if (rows.length === 0) {
      return null
    }

    const row = requiredRow(rows, 'Tenant row disappeared')
    return {
      ...this.mapTenant(row),
      signingKeyCiphertext: row.signing_key_ciphertext,
    }
  }

  async disableTenant(slug: string): Promise<boolean> {
    const rows = await this.database<TenantRow[]>`
      update tenants set status = 'disabled', updated_at = now()
      where slug = ${slug} and status = 'active'
      returning ${this.tenantColumns}
    `

    return rows.length === 1
  }

  async getSigningKeys(tenant: TenantWithSigningKey): Promise<NonNullable<Configuration['jwks']>> {
    const plaintext = decryptSecret(tenant.signingKeyCiphertext, this.encryptionKey)
    return JSON.parse(plaintext) as NonNullable<Configuration['jwks']>
  }

  async createClient(input: {
    tenantSlug: string
    name: string
    redirectUris: string[]
    postLogoutRedirectUris?: string[]
    resourceUris?: string[]
    isPublic?: boolean
  }): Promise<ClientCreation | null> {
    const client = clientInputSchema.parse(input)
    client.redirectUris.forEach(assertValidHttpsUri)
    client.postLogoutRedirectUris.forEach(assertValidHttpsUri)
    client.resourceUris.forEach(assertValidHttpsUri)

    const tenant = await this.getTenant(client.tenantSlug)
    if (!tenant || tenant.status !== 'active') {
      return null
    }

    const clientSecret = client.isPublic ? null : randomBytes(48).toString('base64url')
    const secretCiphertext = clientSecret ? encryptSecret(clientSecret, this.encryptionKey) : null
    const rows = await this.database<ClientRow[]>`
      insert into clients (
        id, tenant_id, name, client_id, secret_ciphertext, redirect_uris,
        post_logout_redirect_uris, resource_uris, is_public, status
      ) values (
        ${randomUUID()}, ${tenant.id}, ${client.name}, ${randomUUID()}, ${secretCiphertext},
        ${this.database.json(client.redirectUris)}, ${this.database.json(client.postLogoutRedirectUris)},
        ${this.database.json(client.resourceUris)}, ${client.isPublic}, 'active'
      )
      returning ${this.clientColumns}
    `

    return {
      client: this.mapClient(requiredRow(rows, 'Client creation returned no row')),
      clientSecret,
    }
  }

  async listClients(tenantSlug: string): Promise<OidcClient[]> {
    const rows = await this.database<ClientRow[]>`
      select ${this.clientColumns} from clients
      where tenant_id = (select id from tenants where slug = ${tenantSlug})
      order by created_at
    `

    return rows.map((row) => this.mapClient(row))
  }

  async getClientsWithSecrets(tenantId: string): Promise<OidcClientWithSecret[]> {
    const rows = await this.database<ClientRow[]>`
      select ${this.clientColumns} from clients
      where tenant_id = ${tenantId} and status = 'active'
      order by created_at
    `

    return rows.map((row) => ({
      ...this.mapClient(row),
      clientSecret: row.secret_ciphertext
        ? decryptSecret(row.secret_ciphertext, this.encryptionKey)
        : null,
    }))
  }

  async disableClient(tenantSlug: string, clientId: string): Promise<boolean> {
    const rows = await this.database<ClientRow[]>`
      update clients set status = 'disabled', updated_at = now()
      where client_id = ${clientId} and status = 'active'
        and tenant_id = (select id from tenants where slug = ${tenantSlug})
      returning ${this.clientColumns}
    `

    return rows.length === 1
  }

  async rotateClientSecret(tenantSlug: string, clientId: string): Promise<string | null> {
    const clientSecret = randomBytes(48).toString('base64url')
    const ciphertext = encryptSecret(clientSecret, this.encryptionKey)
    const rows = await this.database<ClientRow[]>`
      update clients set secret_ciphertext = ${ciphertext}, updated_at = now()
      where client_id = ${clientId} and is_public = false and status = 'active'
        and tenant_id = (select id from tenants where slug = ${tenantSlug})
      returning ${this.clientColumns}
    `

    return rows.length === 1 ? clientSecret : null
  }

  private get tenantColumns() {
    return this.database`id, slug, name, status, updated_at::text as updated_at`
  }

  private get clientColumns() {
    return this.database`
      id, tenant_id, name, client_id, secret_ciphertext, redirect_uris,
      post_logout_redirect_uris, resource_uris, is_public, status, updated_at::text as updated_at
    `
  }

  private mapTenant(row: TenantRow): Tenant {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      updatedAt: row.updated_at,
    }
  }

  private mapClient(row: ClientRow): OidcClient {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      clientId: row.client_id,
      redirectUris: row.redirect_uris,
      postLogoutRedirectUris: row.post_logout_redirect_uris,
      resourceUris: row.resource_uris,
      isPublic: row.is_public,
      status: row.status,
      updatedAt: row.updated_at,
    }
  }

  private async createSigningKey(): Promise<string> {
    const { privateKey } = await generateKeyPair('RS256', {
      modulusLength: 2048,
      extractable: true,
    })
    const privateJwk = await exportJWK(privateKey)
    privateJwk.alg = 'RS256'
    privateJwk.use = 'sig'
    privateJwk.kid = randomUUID()

    return encryptSecret(JSON.stringify({ keys: [privateJwk] }), this.encryptionKey)
  }
}

function requiredRow<T>(rows: T[], message: string): T {
  const row = rows[0]
  if (!row) {
    throw new Error(message)
  }

  return row
}

function assertValidHttpsUri(value: string): void {
  const uri = new URL(z.url().parse(value))

  if (uri.hash) {
    throw new Error('Redirect URIs must not contain fragments')
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)
  if (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && isLoopback)) {
    throw new Error('Redirect URIs must use HTTPS except on loopback hosts')
  }
}

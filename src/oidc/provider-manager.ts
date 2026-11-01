import Provider, {
  errors,
  type ClientMetadata,
} from 'oidc-provider'
import type { AccountService } from '../accounts/account-service.js'
import type { AppConfig } from '../config.js'
import type { Database } from '../db/database.js'
import {
  TenantService,
  type OidcClientWithSecret,
  type TenantWithSigningKey,
} from '../tenants/tenant-service.js'
import { PostgresOidcAdapter } from './postgres-adapter.js'

interface ProviderEntry {
  version: string
  provider: Provider
}

const accessTokenTtlSeconds = 300

export class OidcProviderManager {
  private readonly cache = new Map<string, ProviderEntry>()
  private readonly pending = new Map<string, Promise<Provider | null>>()

  constructor(
    private readonly database: Database,
    private readonly tenants: TenantService,
    private readonly accounts: AccountService,
    private readonly config: AppConfig,
  ) {}

  async getProvider(slug: string): Promise<Provider | null> {
    const tenant = await this.tenants.getTenantWithSigningKey(slug)
    if (!tenant) {
      return null
    }
    if (tenant.status !== 'active') {
      return null
    }

    const version = `${tenant.updatedAt}:${await this.tenants.getActiveClientVersion(tenant.id)}`
    const cached = this.cache.get(slug)

    if (cached?.version === version) {
      this.cache.delete(slug)
      this.cache.set(slug, cached)
      return cached.provider
    }

    const pending = this.pending.get(slug)
    if (pending) {
      return pending
    }

    const creation = (async () => {
      const clients = await this.tenants.getClientsWithSecrets(tenant.id)
      return this.createProvider(tenant, clients, version)
    })().finally(() => this.pending.delete(slug))
    this.pending.set(slug, creation)
    return creation
  }

  private createProvider(
    tenant: TenantWithSigningKey,
    clients: OidcClientWithSecret[],
    version: string,
  ): Provider {
    const issuer = `${this.config.publicBaseUrl}/t/${tenant.slug}`
    const signingKeys = this.tenants.getSigningKeys(tenant)
    const provider = new Provider(issuer, {
      adapter: (model) => new PostgresOidcAdapter(this.database, tenant.id, model),
      clients: clients.map(toClientMetadata),
      jwks: signingKeys,
      responseTypes: ['code'],
      scopes: ['openid', 'profile', 'email', 'offline_access', 'api'],
      pkce: {
        required: () => true,
      },
      rotateRefreshToken: true,
      acceptQueryParamAccessTokens: false,
      interactions: {
        url: (_context, interaction) => `/t/${tenant.slug}/interaction/${interaction.uid}`,
      },
      findAccount: async (_context, accountId) => {
        const account = await this.accounts.findAccount(tenant.id, accountId)
        if (!account) {
          return undefined
        }
        if (account.status !== 'active' || !account.emailVerifiedAt) {
          return undefined
        }

        return {
          accountId,
          claims: () => ({
            sub: account.id,
            email: account.email,
            email_verified: true,
          }),
        }
      },
      extraTokenClaims: () => ({
        tenant_id: tenant.id,
        tenant: tenant.slug,
      }),
      features: {
        devInteractions: { enabled: false },
        userinfo: { enabled: true },
        revocation: { enabled: true },
        introspection: { enabled: true },
        rpInitiatedLogout: { enabled: true },
        resourceIndicators: {
          enabled: true,
          getResourceServerInfo: (_context, resource, client) => {
            const registration = clients.find((candidate) => candidate.clientId === client.clientId)
            if (!registration?.resourceUris.includes(resource)) {
              throw new errors.InvalidTarget()
            }

            return {
              scope: 'api',
              audience: resource,
              accessTokenTTL: accessTokenTtlSeconds,
              accessTokenFormat: 'jwt',
              jwt: { sign: { alg: 'RS256' } },
            }
          },
          useGrantedResource: () => true,
        },
      },
      cookies: {
        keys: this.config.cookieKeys,
        names: {
          session: `yz_${tenant.slug}_session`,
          interaction: `yz_${tenant.slug}_interaction`,
          resume: `yz_${tenant.slug}_resume`,
        },
        long: {
          httpOnly: true,
          secure: this.config.environment === 'production',
          sameSite: 'lax',
          path: `/t/${tenant.slug}`,
        },
        short: {
          httpOnly: true,
          secure: this.config.environment === 'production',
          sameSite: 'lax',
        },
      },
      ttl: {
        Grant: 14 * 24 * 60 * 60,
        Session: 14 * 24 * 60 * 60,
        Interaction: 60 * 60,
        AccessToken: accessTokenTtlSeconds,
        AuthorizationCode: 60,
        IdToken: 300,
        RefreshToken: 30 * 24 * 60 * 60,
      },
    })
    provider.proxy = this.config.trustProxy

    this.cache.set(tenant.slug, { version, provider })
    if (this.cache.size > 20) {
      const oldest = this.cache.keys().next().value
      if (oldest) {
        this.cache.delete(oldest)
      }
    }

    return provider
  }
}

function toClientMetadata(client: OidcClientWithSecret): ClientMetadata {
  return {
    client_id: client.clientId,
    client_name: client.name,
    application_type: 'web',
    token_endpoint_auth_method: client.isPublic ? 'none' : 'client_secret_basic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: client.redirectUris,
    post_logout_redirect_uris: client.postLogoutRedirectUris,
    scope: 'openid profile email offline_access api',
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
  }
}

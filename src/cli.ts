import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { createDatabase, migrateDatabase } from './db/database.js'
import { loadEnvironmentFile } from './load-environment.js'
import { createEncryptionKey } from './security/secret-cipher.js'
import { TenantService } from './tenants/tenant-service.js'

loadEnvironmentFile()

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    tenant: { type: 'string' },
    'client-id': { type: 'string' },
    'redirect-uri': { type: 'string', multiple: true },
    'post-logout-redirect-uri': { type: 'string', multiple: true },
    'resource-uri': { type: 'string', multiple: true },
    public: { type: 'boolean' },
  },
})

const [resource, action] = positionals

if (resource === 'secrets' && action === 'generate') {
  print({
    cookieKey: randomBytes(32).toString('base64url'),
    encryptionKey: createEncryptionKey(),
  })
  process.exit(0)
}

const config = loadConfig()
const database = createDatabase(config.databaseUrl)
const tenants = new TenantService(database, config.encryptionKey)

try {
  if (resource === 'db' && action === 'migrate') {
    await migrateDatabase(database)
    print({ migrated: true })
  } else {
    await executeCommand()
  }
} finally {
  await database.end()
}

async function executeCommand(): Promise<void> {
  if (resource === 'tenants' && action === 'create') {
    const tenant = await tenants.createTenant({
      slug: required(values.slug, 'slug'),
      name: required(values.name, 'name'),
    })
    print(tenant)
    return
  }

  if (resource === 'tenants' && action === 'list') {
    print(await tenants.listTenants())
    return
  }

  if (resource === 'tenants' && action === 'disable') {
    const disabled = await tenants.disableTenant(required(values.slug, 'slug'))
    print({ disabled })
    process.exitCode = disabled ? 0 : 1
    return
  }

  if (resource === 'clients' && action === 'create') {
    const result = await tenants.createClient({
      tenantSlug: required(values.tenant, 'tenant'),
      name: required(values.name, 'name'),
      redirectUris: values['redirect-uri'] ?? [],
      postLogoutRedirectUris: values['post-logout-redirect-uri'] ?? [],
      resourceUris: values['resource-uri'] ?? [],
      isPublic: values.public ?? false,
    })
    print(result)
    process.exitCode = result ? 0 : 1
    return
  }

  if (resource === 'clients' && action === 'list') {
    print(await tenants.listClients(required(values.tenant, 'tenant')))
    return
  }

  if (resource === 'clients' && action === 'disable') {
    const disabled = await tenants.disableClient(
      required(values.tenant, 'tenant'),
      required(values['client-id'], 'client-id'),
    )
    print({ disabled })
    process.exitCode = disabled ? 0 : 1
    return
  }

  if (resource === 'clients' && action === 'rotate-secret') {
    const clientSecret = await tenants.rotateClientSecret(
      required(values.tenant, 'tenant'),
      required(values['client-id'], 'client-id'),
    )
    print({ clientSecret })
    process.exitCode = clientSecret ? 0 : 1
    return
  }

  throw new Error('Expected db migrate, tenants create|list|disable, clients create|list|disable|rotate-secret, or secrets generate')
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`--${name} is required`)
  }

  return value
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

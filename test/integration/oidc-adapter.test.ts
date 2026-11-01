import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { PostgresOidcAdapter } from '../../src/oidc/postgres-adapter.js'
import { createIntegrationContext, type IntegrationContext } from './setup.js'

let context: IntegrationContext | undefined

beforeEach(async () => {
  context = await createIntegrationContext()
})

afterEach(async () => {
  await context?.application.server.close()
  context = undefined
})

test('OIDC persistence scopes models by tenant and supports consumption and grant revocation', async () => {
  const { database, tenants } = context!
  const first = await tenants.createTenant({ slug: 'first', name: 'First' })
  const second = await tenants.createTenant({ slug: 'second', name: 'Second' })
  const firstTokens = new PostgresOidcAdapter(database, first.id, 'RefreshToken')
  const secondTokens = new PostgresOidcAdapter(database, second.id, 'RefreshToken')

  await firstTokens.upsert('shared-id', {
    accountId: 'account-id',
    grantId: 'grant-id',
    scope: 'openid',
  }, 3600)
  await firstTokens.consume('shared-id')

  assert.ok((await firstTokens.find('shared-id'))?.consumed)
  assert.equal(await secondTokens.find('shared-id'), undefined)

  await firstTokens.revokeByGrantId('grant-id')
  assert.equal(await firstTokens.find('shared-id'), undefined)
})

test('ReplayDetection rejects a second unexpired insertion', async () => {
  const { database, tenants } = context!
  const tenant = await tenants.createTenant({ slug: 'acme', name: 'Acme' })
  const replay = new PostgresOidcAdapter(database, tenant.id, 'ReplayDetection')

  await replay.upsert('request-id', { request: 'signed-request' }, 60)
  await assert.rejects(() => replay.upsert('request-id', { request: 'signed-request' }, 60), /replay/i)
})

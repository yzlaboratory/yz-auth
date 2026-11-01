import { randomUUID } from 'node:crypto'
import type { Queryable } from '../db/database.js'

export interface OutboxEmail {
  tenantId: string
  tokenId: string
  recipient: string
  kind: 'email_verification' | 'password_reset'
  interactionUid: string | null
}

export async function enqueueEmail(database: Queryable, email: OutboxEmail): Promise<void> {
  await database`
    insert into email_outbox (
      id, tenant_id, token_id, recipient, kind, interaction_uid
    ) values (
      ${randomUUID()}, ${email.tenantId}, ${email.tokenId}, ${email.recipient},
      ${email.kind}, ${email.interactionUid}
    )
  `
}

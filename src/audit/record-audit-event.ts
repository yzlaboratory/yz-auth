import { randomUUID } from 'node:crypto'
import type { Queryable } from '../db/database.js'

export interface AuditEvent {
  tenantId: string
  accountId: string | null
  eventType: string
  ipAddress: string | null
  metadata?: Record<string, unknown>
}

export async function recordAuditEvent(database: Queryable, event: AuditEvent): Promise<void> {
  await database`
    insert into audit_events (
      id, tenant_id, account_id, event_type, ip_address, metadata
    ) values (
      ${randomUUID()}, ${event.tenantId}, ${event.accountId}, ${event.eventType},
      ${event.ipAddress}, ${database.json(event.metadata ?? {})}
    )
  `
}

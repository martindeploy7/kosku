import type { SessionUser } from '../auth/session'
import { type Executor, db, schema } from '../db/client'
import { log } from '../lib/log'

export interface AuditInput {
  action: string
  entityType: string
  entityId?: string | null
  propertyId?: string | null
  summary: string
  meta?: Record<string, unknown>
}

/** Who did what, when. Written inside the same transaction as the change when one is given. */
export async function writeAudit(
  actor: Pick<SessionUser, 'id' | 'username'> | null,
  ip: string | null,
  input: AuditInput,
  exec: Executor = db,
) {
  try {
    await exec.insert(schema.auditLogs).values({
      userId: actor?.id ?? null,
      username: actor?.username ?? 'sistem',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      propertyId: input.propertyId ?? null,
      summary: input.summary,
      meta: input.meta ?? null,
      ip,
    })
  } catch (e) {
    // Never let an audit failure hide the real outcome, but make it loud.
    log.error('Gagal menulis audit log', { action: input.action, error: String(e) })
    if (exec !== db) throw e
  }
}

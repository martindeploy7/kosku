import { eq } from 'drizzle-orm'
import { type Executor, db, schema } from '../db/client'
import { workspaceOf } from '../auth/session'

/* A workspace is one owner's world: their properties, tenants, staff, settings
 * and history. Nothing crosses from one workspace to another. */

/** Owner of a property (deleted ones included — their history still belongs to someone). */
export async function ownerOfProperty(propertyId: string | null | undefined, exec: Executor = db) {
  if (!propertyId) return null
  const p = await exec.query.properties.findFirst({ where: eq(schema.properties.id, propertyId), columns: { ownerId: true } })
  return p?.ownerId ?? null
}

/** Workspace of a user account. */
export async function ownerOfUser(userId: string | null | undefined, exec: Executor = db) {
  if (!userId) return null
  const u = await exec.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { id: true, role: true, ownerId: true } })
  return u ? workspaceOf(u) : null
}

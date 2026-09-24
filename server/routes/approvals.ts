import { Hono } from 'hono'
import { type AppEnv, type Ctx, requireRole, requireUser } from '../auth/context'
import type { SessionUser } from '../auth/session'
import {
  approveRequest, cancelRequest, listApprovals, needsApproval, rejectRequest, requestDelete,
} from '../services/approvals'
import { softDelete, type TrashEntity } from '../services/trash'
import { jsonBody, parse, uuid, z } from './util'

export const approvalRoutes = new Hono<AppEnv>()

/** Optional note an admin attaches to a request ("kenapa perlu diubah"). */
export function approvalReason(raw: unknown, c?: Ctx): string | undefined {
  const fromBody = raw && typeof raw === 'object' ? (raw as { approvalReason?: unknown }).approvalReason : undefined
  const r = typeof fromBody === 'string' ? fromBody : c?.req.query('reason')
  return r ? r.slice(0, 500) : undefined
}

/**
 * Every delete route ends here: a superadmin deletes (soft, restorable); anyone
 * else — after the same checks — files a request for the superadmin.
 */
export async function deleteOrRequest(c: Ctx, u: SessionUser, entity: TrashEntity, id: string, version?: number) {
  if (!needsApproval(u)) return c.json(await softDelete(entity, id, u, c.get('ip'), { version }))
  return c.json(await requestDelete(u, c.get('ip'), entity, id, approvalReason(null, c)), 202)
}

approvalRoutes.get('/', async (c) => {
  const u = requireUser(c)
  const status = c.req.query('status') === 'history' ? 'history' : 'pending'
  c.header('Cache-Control', 'no-store')
  return c.json(await listApprovals(u, { status }))
})

const note = z.object({ note: z.string().max(1000).default('') })

approvalRoutes.post('/:id/approve', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const body = parse(note, await jsonBody(c).catch(() => ({})))
  return c.json(await approveRequest(u, c.get('ip'), id, body.note))
})

approvalRoutes.post('/:id/reject', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const body = parse(note, await jsonBody(c))
  return c.json(await rejectRequest(u, c.get('ip'), id, body.note))
})

approvalRoutes.post('/:id/cancel', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  return c.json(await cancelRequest(u, c.get('ip'), id))
})

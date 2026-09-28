import { and, desc, eq, isNull, lt, sql as dsql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AuditEntry, JobRun } from '@shared/types'
import { type AppEnv, requireRole, requireUser } from '../auth/context'
import { hashPassword } from '../auth/password'
import { revokeUserSessions, type SessionUser, workspaceOf } from '../auth/session'
import { db, iso, schema } from '../db/client'
import { temporaryPassword } from '../lib/crypto'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { bumpRev } from '../lib/rev'
import { runDailyNow } from '../jobs'
import { writeAudit } from '../services/audit'
import { toUser } from '../services/mappers'
import { listNotifications, markRead } from '../services/notify'
import { sendPushToUser, vapidPublicKey } from '../services/push'
import { listTrash, restore, softDelete } from '../services/trash'
import { jsonBody, parse, updateVersioned, uuid, version, z } from './util'

export const adminRoutes = new Hono<AppEnv>()

/* ================================================================== users (superadmin) */

const userFields = {
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'username hanya huruf, angka, titik, garis bawah, strip'),
  name: z.string().trim().min(2).max(120),
  phone: z.string().max(30).default(''),
  role: z.enum(['superadmin', 'admin', 'staff']),
  allProperties: z.boolean().default(true),
  propertyIds: z.array(uuid).max(20).default([]),
}

/** A user of the caller's own workspace. Accounts of other owners simply don't exist here. */
async function workspaceUser(u: SessionUser, id: string) {
  const target = await db.query.users.findFirst({ where: and(eq(schema.users.id, id), isNull(schema.users.deletedAt)) })
  if (!target || workspaceOf(target) !== u.ownerId) throw notFound('Pengguna')
  return target
}

/** Property access can only be granted within the caller's own properties. */
function ownProperties(u: SessionUser, ids: string[]) {
  if (ids.some((id) => !u.propertyIds.includes(id))) throw forbidden('Properti yang dipilih bukan milik Anda.')
  return ids
}

adminRoutes.post('/users', async (c) => {
  const u = requireRole(c, 'superadmin')
  const body = parse(z.object(userFields), await jsonBody(c))
  const newOwner = body.role === 'superadmin'
  // A new superadmin is a separate owner with an empty workspace of their own.
  // Only a real owner can start one — a developer's sandbox never creates owners.
  if (newOwner && u.role !== 'superadmin') throw forbidden('Developer tidak dapat membuat superadmin.')
  if (!newOwner && !body.allProperties && !body.propertyIds.length) {
    throw badRequest('Pilih minimal satu properti, atau beri akses ke semua properti.')
  }
  // Handed over in person; the user must replace it at first login.
  const temp = temporaryPassword()
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.users).values({
      ...body,
      allProperties: newOwner ? true : body.allProperties,
      propertyIds: newOwner ? [] : ownProperties(u, body.propertyIds),
      ownerId: newOwner ? null : u.ownerId,
      passwordHash: await hashPassword(temp),
      mustChangePassword: true,
    }).returning()
    if (!newOwner) return created
    const [owner] = await tx.update(schema.users).set({ ownerId: created.id }).where(eq(schema.users.id, created.id)).returning()
    return owner
  })
  await writeAudit(u, c.get('ip'), {
    action: 'user.create', entityType: 'user', entityId: row.id, ownerId: u.ownerId,
    summary: newOwner
      ? `Buat superadmin baru @${row.username} (pemilik terpisah — tidak dapat melihat data Anda, dan sebaliknya)`
      : `Tambah pengguna @${row.username} (${row.role})`,
  })
  bumpRev()
  return c.json({ user: toUser(row), temporaryPassword: temp, separateWorkspace: newOwner }, 201)
})

adminRoutes.patch('/users/:id', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const body = parse(z.object({
    version,
    name: userFields.name.optional(),
    phone: z.string().max(30).optional(),
    // Staff and admins only: an owner (superadmin/developer) is never created or removed by an edit.
    role: z.enum(['admin', 'staff']).optional(),
    allProperties: z.boolean().optional(),
    propertyIds: z.array(uuid).max(20).optional(),
    isActive: z.boolean().optional(),
  }), await jsonBody(c))
  const target = await workspaceUser(u, id)
  const isOwner = target.role === 'superadmin' || target.role === 'developer'
  if (isOwner && (body.role || body.isActive === false || body.allProperties === false || body.propertyIds)) {
    throw badRequest('Peran, status, dan akses pemilik tidak dapat diubah.')
  }
  const { version: v, ...patch } = body
  if (patch.propertyIds) patch.propertyIds = ownProperties(u, patch.propertyIds)
  if (!isOwner && patch.allProperties === false && !(patch.propertyIds ?? target.propertyIds).length) {
    throw badRequest('Pilih minimal satu properti, atau beri akses ke semua properti.')
  }
  const row = await updateVersioned(db, schema.users, id, v, patch)
  // Permission changes take effect on the next request; a deactivated user is signed out now.
  if (body.isActive === false) await revokeUserSessions(id)
  await writeAudit(u, c.get('ip'), {
    action: 'user.update', entityType: 'user', entityId: id,
    summary: `Ubah pengguna @${target.username}${body.isActive === false ? ' (dinonaktifkan)' : body.isActive ? ' (diaktifkan)' : ''}`,
    meta: { fields: Object.keys(patch) },
  })
  bumpRev()
  return c.json(toUser(row))
})

adminRoutes.post('/users/:id/reset-password', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const target = await workspaceUser(u, id)
  const temp = temporaryPassword()
  await db.update(schema.users).set({
    passwordHash: await hashPassword(temp), mustChangePassword: true, failedAttempts: 0, lockedUntil: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.users.id, id))
  await revokeUserSessions(id)
  await writeAudit(u, c.get('ip'), { action: 'user.reset_password', entityType: 'user', entityId: id, summary: `Reset password @${target.username}` })
  bumpRev()
  return c.json({ temporaryPassword: temp })
})

adminRoutes.post('/users/:id/unlock', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  await workspaceUser(u, id)
  await db.update(schema.users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, id))
  await writeAudit(u, c.get('ip'), { action: 'user.unlock', entityType: 'user', entityId: id, summary: 'Buka kunci akun' })
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/logout', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  await workspaceUser(u, id)
  await revokeUserSessions(id)
  await writeAudit(u, c.get('ip'), { action: 'user.logout_all', entityType: 'user', entityId: id, summary: 'Paksa keluar dari semua perangkat' })
  return c.json({ ok: true })
})

adminRoutes.delete('/users/:id', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const target = await workspaceUser(u, id)
  if (target.role === 'superadmin' || target.role === 'developer') throw badRequest('Akun pemilik tidak dapat dihapus dari sini.')
  return c.json(await softDelete('user', id, u, c.get('ip')))
})

/* ================================================================== developer sandbox */

adminRoutes.post('/dev/reset-sandbox', async (c) => {
  const u = requireUser(c)
  if (u.role !== 'developer') throw forbidden('Hanya untuk akun developer.')
  const { resetSandbox } = await import('../sandbox')
  const result = await resetSandbox(u.id)
  await writeAudit(u, c.get('ip'), { action: 'dev.reset_sandbox', entityType: 'workspace', summary: 'Reset data dummy sandbox' })
  return c.json(result)
})

/* ================================================================== trash (superadmin) */

adminRoutes.get('/trash', async (c) => {
  const u = requireRole(c, 'superadmin')
  return c.json(await listTrash(u.ownerId))
})

adminRoutes.post('/trash/:id/restore', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const item = await restore(id, u, c.get('ip'))
  return c.json({ ok: true, label: item.label, entityType: item.entityType })
})

/* ================================================================== audit log (superadmin) */

adminRoutes.get('/audit', async (c) => {
  const u = requireRole(c, 'superadmin')
  const q = parse(z.object({
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    entityType: z.string().max(40).optional(),
    entityId: uuid.optional(),
  }), c.req.query())
  const a = schema.auditLogs
  const rows = await db.select().from(a)
    .where(and(
      eq(a.ownerId, u.ownerId),
      q.before ? lt(a.createdAt, q.before) : undefined,
      q.entityType ? eq(a.entityType, q.entityType) : undefined,
      q.entityId ? eq(a.entityId, q.entityId) : undefined,
    ))
    .orderBy(desc(a.createdAt))
    .limit(q.limit)
  const out: AuditEntry[] = rows.map((r) => ({
    id: r.id, username: r.username, action: r.action, entityType: r.entityType, entityId: r.entityId,
    summary: r.summary, ip: r.ip, createdAt: iso(r.createdAt)!,
  }))
  return c.json(out)
})

/* ================================================================== jobs (superadmin) */

adminRoutes.get('/jobs', async (c) => {
  requireRole(c, 'superadmin')
  const rows = await db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.startedAt)).limit(50)
  const out: JobRun[] = rows.map((r) => ({
    id: r.id, name: r.name, status: r.status, startedAt: iso(r.startedAt)!, finishedAt: iso(r.finishedAt),
    result: r.result as Record<string, unknown> | null, error: r.error,
  }))
  return c.json(out)
})

adminRoutes.post('/jobs/daily/run', async (c) => {
  const u = requireRole(c, 'superadmin')
  const result = await runDailyNow()
  await writeAudit(u, c.get('ip'), { action: 'jobs.run', entityType: 'job', summary: 'Jalankan tugas harian secara manual', meta: result })
  return c.json(result)
})

/* ================================================================== notifications & push */

adminRoutes.get('/notifications', async (c) => {
  const u = requireUser(c)
  c.header('Cache-Control', 'no-store')
  return c.json(await listNotifications(u, Number(c.req.query('limit') ?? 60)))
})

adminRoutes.post('/notifications/read', async (c) => {
  const u = requireUser(c)
  const body = parse(z.object({ ids: z.union([z.array(uuid).max(500), z.literal('all')]) }), await jsonBody(c))
  await markRead(u, body.ids)
  bumpRev()
  return c.json({ ok: true })
})

adminRoutes.get('/push/key', (c) => {
  requireUser(c)
  return c.json({ publicKey: vapidPublicKey() })
})

adminRoutes.post('/push/subscribe', async (c) => {
  const u = requireUser(c)
  const body = parse(z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  }), await jsonBody(c))
  await db.insert(schema.pushSubscriptions)
    .values({ userId: u.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: c.req.header('user-agent') ?? '' })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId: u.id, p256dh: body.keys.p256dh, auth: body.keys.auth } })
  return c.json({ ok: true })
})

adminRoutes.post('/push/unsubscribe', async (c) => {
  const u = requireUser(c)
  const body = parse(z.object({ endpoint: z.string().max(1000) }), await jsonBody(c))
  await db.delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.endpoint, body.endpoint), eq(schema.pushSubscriptions.userId, u.id)))
  return c.json({ ok: true })
})

adminRoutes.post('/push/test', async (c) => {
  const u = requireUser(c)
  const n = await sendPushToUser(u.id, { title: 'Notifikasi aktif ✅', body: 'Perangkat ini akan menerima pemberitahuan Kosku.', link: '/notifications', tag: 'test' })
  return c.json({ devices: n })
})

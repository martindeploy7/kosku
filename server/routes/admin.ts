import { and, desc, eq, isNull, lt, sql as dsql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AuditEntry, JobRun } from '@shared/types'
import { type AppEnv, requireRole, requireUser } from '../auth/context'
import { hashPassword } from '../auth/password'
import { revokeUserSessions } from '../auth/session'
import { db, iso, schema } from '../db/client'
import { temporaryPassword } from '../lib/crypto'
import { badRequest, conflict, notFound } from '../lib/errors'
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

adminRoutes.post('/users', async (c) => {
  const u = requireRole(c, 'superadmin')
  const body = parse(z.object(userFields), await jsonBody(c))
  if (!body.allProperties && !body.propertyIds.length && body.role !== 'superadmin') {
    throw badRequest('Pilih minimal satu properti, atau beri akses ke semua properti.')
  }
  // Handed over in person; the user must replace it at first login.
  const temp = temporaryPassword()
  const [row] = await db.insert(schema.users).values({
    ...body,
    allProperties: body.role === 'superadmin' ? true : body.allProperties,
    passwordHash: await hashPassword(temp),
    mustChangePassword: true,
  }).returning()
  await writeAudit(u, c.get('ip'), {
    action: 'user.create', entityType: 'user', entityId: row.id, summary: `Tambah pengguna @${row.username} (${row.role})`,
  })
  bumpRev()
  return c.json({ user: toUser(row), temporaryPassword: temp }, 201)
})

adminRoutes.patch('/users/:id', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const body = parse(z.object({
    version,
    name: userFields.name.optional(),
    phone: z.string().max(30).optional(),
    role: userFields.role.optional(),
    allProperties: z.boolean().optional(),
    propertyIds: z.array(uuid).max(20).optional(),
    isActive: z.boolean().optional(),
  }), await jsonBody(c))
  const target = await db.query.users.findFirst({ where: and(eq(schema.users.id, id), isNull(schema.users.deletedAt)) })
  if (!target) throw notFound('Pengguna')

  const demoting = target.role === 'superadmin' && ((body.role && body.role !== 'superadmin') || body.isActive === false)
  if (demoting) {
    if (id === u.id) throw badRequest('Anda tidak dapat menurunkan atau menonaktifkan akun Anda sendiri.')
    const supers = await db.select({ c: dsql<number>`count(*)` }).from(schema.users)
      .where(and(eq(schema.users.role, 'superadmin'), eq(schema.users.isActive, true), isNull(schema.users.deletedAt)))
    if (Number(supers[0].c) <= 1) throw conflict('Harus ada minimal satu superadmin aktif.')
  }
  const { version: v, ...patch } = body
  // A superadmin reviews requests from every property, so always sees all of them.
  if ((patch.role ?? target.role) === 'superadmin') patch.allProperties = true
  else if (patch.allProperties === false && !(patch.propertyIds ?? target.propertyIds).length) {
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
  const target = await db.query.users.findFirst({ where: and(eq(schema.users.id, id), isNull(schema.users.deletedAt)) })
  if (!target) throw notFound('Pengguna')
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
  await db.update(schema.users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, id))
  await writeAudit(u, c.get('ip'), { action: 'user.unlock', entityType: 'user', entityId: id, summary: 'Buka kunci akun' })
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/logout', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  await revokeUserSessions(id)
  await writeAudit(u, c.get('ip'), { action: 'user.logout_all', entityType: 'user', entityId: id, summary: 'Paksa keluar dari semua perangkat' })
  return c.json({ ok: true })
})

adminRoutes.delete('/users/:id', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  return c.json(await softDelete('user', id, u, c.get('ip')))
})

/* ================================================================== trash (superadmin) */

adminRoutes.get('/trash', async (c) => {
  requireRole(c, 'superadmin')
  return c.json(await listTrash())
})

adminRoutes.post('/trash/:id/restore', async (c) => {
  const u = requireRole(c, 'superadmin')
  const id = parse(uuid, c.req.param('id'))
  const item = await restore(id, u, c.get('ip'))
  return c.json({ ok: true, label: item.label, entityType: item.entityType })
})

/* ================================================================== audit log (superadmin) */

adminRoutes.get('/audit', async (c) => {
  requireRole(c, 'superadmin')
  const q = parse(z.object({
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    entityType: z.string().max(40).optional(),
    entityId: uuid.optional(),
  }), c.req.query())
  const a = schema.auditLogs
  const rows = await db.select().from(a)
    .where(and(
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

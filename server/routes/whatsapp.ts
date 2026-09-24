import { and, desc, eq, isNull, sql as dsql } from 'drizzle-orm'
import { Hono } from 'hono'
import { normalizePhone } from '@shared/phone'
import type { WaMessage } from '@shared/types'
import { type AppEnv, assertPropertyAccess, requireRole, requireUser } from '../auth/context'
import { db, iso, schema } from '../db/client'
import { env } from '../env'
import { badRequest, conflict, notFound } from '../lib/errors'
import { bumpRev } from '../lib/rev'
import { writeAudit } from '../services/audit'
import { queueWa } from '../services/messages'
import { recordIncoming } from '../wa/incoming'
import { connect, disconnect, getSessionStatus } from '../wa/manager'
import { jsonBody, parse, uuid, z } from './util'

export const waRoutes = new Hono<AppEnv>()

async function propertyFor(c: Parameters<typeof requireUser>[0], id: string) {
  const u = requireUser(c)
  assertPropertyAccess(u, id)
  const p = await db.query.properties.findFirst({ where: and(eq(schema.properties.id, id), isNull(schema.properties.deletedAt)) })
  if (!p) throw notFound('Properti')
  return { u, p }
}

waRoutes.get('/:propertyId/status', async (c) => {
  const id = parse(uuid, c.req.param('propertyId'))
  await propertyFor(c, id)
  c.header('Cache-Control', 'no-store')
  return c.json(await getSessionStatus(id))
})

waRoutes.post('/:propertyId/connect', async (c) => {
  const id = parse(uuid, c.req.param('propertyId'))
  const u = requireRole(c, 'superadmin', 'admin')
  const { p } = await propertyFor(c, id)
  if (!p.phone) throw badRequest('Isi nomor WhatsApp properti terlebih dahulu.')
  // Mock driver only: lets you rehearse the "wrong phone scanned" case.
  const body = env.WA_DRIVER === 'mock' ? parse(z.object({ mockPhone: z.string().optional() }), await jsonBody(c).catch(() => ({}))) : {}
  const status = await connect(id, { mockPhone: body.mockPhone ? normalizePhone(body.mockPhone) : undefined })
  await writeAudit(u, c.get('ip'), { action: 'wa.connect', entityType: 'property', entityId: id, propertyId: id, summary: `Mulai menghubungkan WhatsApp ${p.name}` })
  return c.json(status)
})

waRoutes.post('/:propertyId/disconnect', async (c) => {
  const id = parse(uuid, c.req.param('propertyId'))
  const u = requireRole(c, 'superadmin', 'admin')
  const { p } = await propertyFor(c, id)
  await disconnect(id)
  await writeAudit(u, c.get('ip'), { action: 'wa.disconnect', entityType: 'property', entityId: id, propertyId: id, summary: `Putuskan WhatsApp ${p.name}` })
  return c.json(await getSessionStatus(id))
})

const toMessage = (m: typeof schema.waMessages.$inferSelect, names: Map<string, string>): WaMessage => ({
  id: m.id,
  propertyId: m.propertyId,
  tenantId: m.tenantId,
  phone: m.phone,
  direction: m.direction,
  type: m.type,
  body: m.body,
  fileId: m.fileId,
  fileName: m.fileName,
  status: m.status,
  error: m.error,
  createdAt: iso(m.createdAt)!,
  readAt: iso(m.readAt),
  createdByName: m.createdBy ? names.get(m.createdBy) ?? null : m.direction === 'out' ? 'Otomatis' : null,
})

/** One row per chat partner: last message, unread count. */
waRoutes.get('/:propertyId/conversations', async (c) => {
  const id = parse(uuid, c.req.param('propertyId'))
  await propertyFor(c, id)
  const rows = await db.execute<{
    phone: string; tenant_id: string | null; last_body: string; last_at: string; last_direction: 'in' | 'out';
    last_status: string; unread: number; total: number
  }>(dsql`
    select m.phone,
           (array_agg(m.tenant_id order by m.created_at desc) filter (where m.tenant_id is not null))[1] as tenant_id,
           (array_agg(m.body order by m.created_at desc))[1] as last_body,
           max(m.created_at) as last_at,
           (array_agg(m.direction order by m.created_at desc))[1] as last_direction,
           (array_agg(m.status order by m.created_at desc))[1] as last_status,
           count(*) filter (where m.direction = 'in' and m.read_at is null) as unread,
           count(*) as total
      from wa_messages m
     where m.property_id = ${id}
     group by m.phone
     order by max(m.created_at) desc
     limit 300`)
  return c.json(rows.map((r) => ({
    phone: r.phone,
    tenantId: r.tenant_id,
    lastBody: r.last_body,
    lastAt: iso(r.last_at),
    lastDirection: r.last_direction,
    lastStatus: r.last_status,
    unread: Number(r.unread),
    total: Number(r.total),
  })))
})

waRoutes.get('/:propertyId/messages', async (c) => {
  const id = parse(uuid, c.req.param('propertyId'))
  await propertyFor(c, id)
  const phone = normalizePhone(c.req.query('phone') ?? '')
  if (!phone) throw badRequest('Nomor tidak valid.')
  const rows = await db
    .select()
    .from(schema.waMessages)
    .where(and(eq(schema.waMessages.propertyId, id), eq(schema.waMessages.phone, phone)))
    .orderBy(desc(schema.waMessages.createdAt))
    .limit(200)
  // Opening a thread marks its incoming messages read for everyone.
  const marked = await db
    .update(schema.waMessages)
    .set({ readAt: new Date().toISOString() })
    .where(and(eq(schema.waMessages.propertyId, id), eq(schema.waMessages.phone, phone), eq(schema.waMessages.direction, 'in'), isNull(schema.waMessages.readAt)))
    .returning({ id: schema.waMessages.id })
  if (marked.length) bumpRev()
  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
  const names = new Map(users.map((u) => [u.id, u.name]))
  return c.json(rows.reverse().map((m) => toMessage(m, names)))
})

waRoutes.post('/:propertyId/messages', async (c) => {
  const id = parse(uuid, c.req.param('propertyId'))
  const { u } = await propertyFor(c, id)
  const body = parse(z.object({
    phone: z.string().min(6).max(30),
    body: z.string().trim().min(1).max(4000),
    tenantId: uuid.nullable().default(null),
  }), await jsonBody(c))
  const row = await queueWa(db, {
    propertyId: id, tenantId: body.tenantId, phone: normalizePhone(body.phone), body: body.body, createdBy: u.id,
  })
  return c.json(toMessage(row!, new Map([[u.id, u.name]])), 201)
})

waRoutes.post('/messages/:id/retry', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const m = await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, id) })
  if (!m) throw notFound('Pesan')
  assertPropertyAccess(u, m.propertyId)
  if (m.status !== 'failed') throw conflict('Hanya pesan gagal yang bisa dikirim ulang.')
  await db.update(schema.waMessages).set({ status: 'queued', attempts: 0, error: null }).where(eq(schema.waMessages.id, id))
  bumpRev()
  const { events } = await import('../lib/events')
  events.emit('wa:outbox', m.propertyId)
  return c.json({ ok: true })
})

/** Mock driver only: simulate a tenant writing in, to exercise the inbox and notifications. */
waRoutes.post('/:propertyId/mock-incoming', async (c) => {
  if (env.WA_DRIVER !== 'mock') throw notFound('Endpoint')
  const id = parse(uuid, c.req.param('propertyId'))
  await propertyFor(c, id)
  const body = parse(z.object({
    phone: z.string(),
    body: z.string().max(2000).default(''),
    media: z.object({
      type: z.enum(['image', 'document']),
      fileName: z.string().max(200).default(''),
      base64: z.string().max(14_000_000),
    }).optional(),
  }), await jsonBody(c))
  const media = body.media
  const buffer = media ? Buffer.from(media.base64, 'base64') : null
  const row = await recordIncoming(id, {
    phone: normalizePhone(body.phone),
    body: body.body,
    waMessageId: `MOCK-IN-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    media: media && buffer ? { type: media.type, fileName: media.fileName, size: buffer.length, download: async () => buffer } : null,
  })
  return c.json(row ? toMessage(row, new Map()) : null)
})

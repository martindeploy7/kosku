import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { SENSITIVE_FILE_KINDS } from '@shared/constants'
import type { FileKind, FileOwnerType } from '@shared/types'
import {
  type AppEnv, assertPropertyAccess, canAccessProperty, canDelete, canSeeSensitiveDocs, requireRole, requireUser,
} from '../auth/context'
import { hit } from '../auth/rateLimit'
import type { SessionUser } from '../auth/session'
import { db, schema } from '../db/client'
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors'
import { bumpRev } from '../lib/rev'
import { writeAudit } from '../services/audit'
import {
  contractPdfPublic, createContract, resendContract, signContractPublic, viewContractPublic, voidContract,
} from '../services/contracts'
import { ingestUpload, loadFile } from '../services/files'
import { toContract, toFileMeta } from '../services/mappers'
import { deleteOrRequest } from './approvals'
import { actorOf, jsonBody, parse, uuid, z } from './util'

export const docsRoutes = new Hono<AppEnv>()
export const publicRoutes = new Hono<AppEnv>()

/* ================================================================== access */

/** The property a file belongs to, for access checks (null = not property-scoped). */
async function ownerProperties(ownerType: string, ownerId: string): Promise<string[] | null> {
  switch (ownerType) {
    case 'tenant': {
      const t = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, ownerId) })
      if (!t) throw notFound('Penyewa')
      const rentals = await db.select({ p: schema.rentals.propertyId }).from(schema.rentals).where(eq(schema.rentals.tenantId, ownerId))
      const ids = [...new Set([...rentals.map((r) => r.p), ...(t.waitlistPropertyId ? [t.waitlistPropertyId] : [])])]
      return ids.length ? ids : null
    }
    case 'payment': {
      const p = await db.query.payments.findFirst({ where: eq(schema.payments.id, ownerId) })
      return p ? [p.propertyId] : []
    }
    case 'expense': {
      const e = await db.query.expenses.findFirst({ where: eq(schema.expenses.id, ownerId) })
      return e ? [e.propertyId] : []
    }
    case 'contract': {
      const k = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, ownerId) })
      return k ? [k.propertyId] : []
    }
    case 'invoice': {
      const i = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, ownerId) })
      return i ? [i.propertyId] : []
    }
    case 'property':
      return [ownerId]
    default:
      return []
  }
}

async function assertOwnerAccess(u: SessionUser, ownerType: string, ownerId: string) {
  const props = await ownerProperties(ownerType, ownerId)
  if (props === null) return
  if (!props.length || !props.some((p) => canAccessProperty(u, p))) throw forbidden('Anda tidak memiliki akses ke berkas ini.')
}

const isSensitive = (kind: string) => SENSITIVE_FILE_KINDS.includes(kind)

/* ================================================================== files */

const OWNER_TYPES = ['tenant', 'payment', 'expense', 'contract', 'property'] as const
const KINDS = ['ktp', 'kk', 'foto', 'kontrak', 'bukti_bayar', 'nota', 'ttd', 'lainnya'] as const

docsRoutes.post('/files', async (c) => {
  const u = requireUser(c)
  const limited = hit(`upload:${u.id}`, 60, 10 * 60_000)
  if (!limited.ok) throw new HttpError(429, 'Terlalu banyak unggahan. Coba lagi sebentar lagi.', 'rate_limited')

  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw badRequest('Pilih berkas untuk diunggah.')
  const meta = parse(z.object({
    ownerType: z.enum(OWNER_TYPES),
    ownerId: uuid,
    kind: z.enum(KINDS),
  }), { ownerType: form.ownerType, ownerId: form.ownerId, kind: form.kind })

  if (meta.ownerType === 'property' && u.role === 'staff') throw forbidden()
  await assertOwnerAccess(u, meta.ownerType, meta.ownerId)

  const stored = await ingestUpload(db, {
    buffer: Buffer.from(await file.arrayBuffer()),
    originalName: file.name,
    ownerType: meta.ownerType as FileOwnerType,
    ownerId: meta.ownerId,
    kind: meta.kind as FileKind,
    uploadedBy: u.id,
  })
  // Proofs and receipts are shown on the payment / expense itself.
  if (meta.ownerType === 'payment' && meta.kind === 'bukti_bayar') {
    await db.update(schema.payments).set({ attachmentFileId: stored.id }).where(eq(schema.payments.id, meta.ownerId))
  }
  if (meta.ownerType === 'expense' && meta.kind === 'nota') {
    await db.update(schema.expenses).set({ attachmentFileId: stored.id }).where(eq(schema.expenses.id, meta.ownerId))
  }
  await writeAudit(u, c.get('ip'), {
    action: 'file.upload', entityType: 'file', entityId: stored.id,
    summary: `Unggah ${meta.kind.toUpperCase()} (${stored.originalName})`, meta: { ownerType: meta.ownerType, ownerId: meta.ownerId },
  })
  bumpRev()
  const row = await db.query.files.findFirst({ where: eq(schema.files.id, stored.id) })
  return c.json(toFileMeta(row!, new Map([[u.id, u.name]])), 201)
})

docsRoutes.get('/files', async (c) => {
  const u = requireUser(c)
  const q = parse(z.object({ ownerType: z.enum(OWNER_TYPES), ownerId: uuid }), c.req.query())
  await assertOwnerAccess(u, q.ownerType, q.ownerId)
  const rows = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.ownerType, q.ownerType), eq(schema.files.ownerId, q.ownerId), isNull(schema.files.deletedAt)))
    .orderBy(desc(schema.files.createdAt))
  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
  const names = new Map(users.map((x) => [x.id, x.name]))
  const sensitiveAllowed = canSeeSensitiveDocs(u)
  return c.json(rows.map((r) => ({ ...toFileMeta(r, names), restricted: isSensitive(r.kind) && !sensitiveAllowed })))
})

docsRoutes.get('/files/:id', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const { row, buffer } = await loadFile(id)
  await assertOwnerAccess(u, row.ownerType, row.ownerId)
  if (isSensitive(row.kind) && !canSeeSensitiveDocs(u)) {
    throw forbidden('Dokumen identitas hanya dapat dibuka oleh admin.')
  }
  if (isSensitive(row.kind)) {
    await writeAudit(u, c.get('ip'), {
      action: 'file.view', entityType: 'file', entityId: row.id, summary: `Buka dokumen ${row.kind.toUpperCase()} (${row.originalName})`,
    })
  }
  const disposition = c.req.query('download') ? 'attachment' : 'inline'
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

docsRoutes.delete('/files/:id', async (c) => {
  const u = requireUser(c)
  if (!canDelete(u)) throw forbidden('Staf tidak dapat menghapus data.')
  const id = parse(uuid, c.req.param('id'))
  const row = await db.query.files.findFirst({ where: eq(schema.files.id, id) })
  if (!row) throw notFound('Berkas')
  await assertOwnerAccess(u, row.ownerType, row.ownerId)
  return deleteOrRequest(c, u, 'file', id)
})

/* ================================================================== contracts */

docsRoutes.post('/contracts', async (c) => {
  const u = requireUser(c)
  const body = parse(z.object({ rentalId: uuid, send: z.boolean().default(true) }), await jsonBody(c))
  const r = await db.query.rentals.findFirst({ where: eq(schema.rentals.id, body.rentalId) })
  if (!r) throw notFound('Sewa')
  assertPropertyAccess(u, r.propertyId)
  const res = await createContract(body.rentalId, actorOf(u), c.get('ip'), { send: body.send })
  return c.json({ contract: toContract(res.contract), link: res.link, queued: res.queued }, 201)
})

async function contractFor(u: SessionUser, id: string) {
  const k = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) })
  if (!k || k.deletedAt) throw notFound('Perjanjian')
  assertPropertyAccess(u, k.propertyId)
  return k
}

docsRoutes.post('/contracts/:id/resend', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  await contractFor(u, id)
  const res = await resendContract(id, actorOf(u), c.get('ip'))
  return c.json({ contract: toContract(res.contract), link: res.link, queued: res.queued })
})

docsRoutes.post('/contracts/:id/void', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  await contractFor(u, id)
  return c.json(toContract(await voidContract(id, actorOf(u), c.get('ip'))))
})

docsRoutes.delete('/contracts/:id', async (c) => {
  const u = requireRole(c, 'superadmin', 'admin')
  const id = parse(uuid, c.req.param('id'))
  await contractFor(u, id)
  return deleteOrRequest(c, u, 'contract', id)
})

/* ================================================================== public signing (no login) */

function publicLimit(c: { get: (k: 'ip') => string; header: (k: string, v: string) => void }, bucket: string, limit: number) {
  const r = hit(`public:${bucket}:${c.get('ip')}`, limit, 10 * 60_000)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw new HttpError(429, 'Terlalu banyak permintaan. Coba lagi sebentar lagi.', 'rate_limited')
  }
}

publicRoutes.get('/contracts/:token', async (c) => {
  publicLimit(c, 'view', 120)
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  return c.json(await viewContractPublic(c.req.param('token'), c.get('ip')))
})

publicRoutes.get('/contracts/:token/pdf', async (c) => {
  publicLimit(c, 'pdf', 60)
  const { buffer, name } = await contractPdfPublic(c.req.param('token'))
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
})

publicRoutes.post('/contracts/:token/sign', async (c) => {
  publicLimit(c, 'sign', 10)
  const body = parse(z.object({
    name: z.string().max(120),
    agree: z.boolean(),
    signature: z.string().max(900_000),
  }), await jsonBody(c))
  return c.json(await signContractPublic(c.req.param('token'), body, {
    ip: c.get('ip'), userAgent: c.req.header('user-agent') ?? '',
  }))
})

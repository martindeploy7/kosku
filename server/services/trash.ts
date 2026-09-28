import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql as dsql, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { formatIDR } from '@shared/dates'
import type { TrashItem } from '@shared/types'
import type { SessionUser } from '../auth/session'
import { db, iso, schema, type Tx } from '../db/client'
import { Effects } from '../lib/effects'
import { badRequest, conflict, forbidden, mapDbError, notFound } from '../lib/errors'
import { events } from '../lib/events'
import { bumpRev } from '../lib/rev'
import { writeAudit } from './audit'
import { activateIfPaid, recomputeInvoice } from './billing'

/* ---------------------------------------------------------------------------
 * Soft delete with grouped restore.
 *
 * Deleting stamps the row — and everything that only makes sense with it —
 * with one batch id. The superadmin restores the batch as a unit, so a restored
 * property comes back with exactly the rooms, invoices and payments that went
 * away with it (and not ones deleted separately before or after).
 * ------------------------------------------------------------------------- */

export type TrashEntity =
  | 'property' | 'room' | 'service' | 'tenant' | 'invoice' | 'payment' | 'expense' | 'user' | 'file' | 'contract'

type SoftTable = PgTable & {
  id: typeof schema.properties.id
  deletedAt: typeof schema.properties.deletedAt
  deletedBy: typeof schema.properties.deletedBy
  deleteBatch: typeof schema.properties.deleteBatch
}

const TABLES: Record<string, SoftTable> = {
  properties: schema.properties as unknown as SoftTable,
  rooms: schema.rooms as unknown as SoftTable,
  services: schema.services as unknown as SoftTable,
  tenants: schema.tenants as unknown as SoftTable,
  rentals: schema.rentals as unknown as SoftTable,
  invoices: schema.invoices as unknown as SoftTable,
  payments: schema.payments as unknown as SoftTable,
  expenses: schema.expenses as unknown as SoftTable,
  users: schema.users as unknown as SoftTable,
  files: schema.files as unknown as SoftTable,
  contracts: schema.contracts as unknown as SoftTable,
}

const LABELS: Record<string, string> = {
  properties: 'properti', rooms: 'kamar', services: 'layanan', tenants: 'penyewa', rentals: 'sewa',
  invoices: 'faktur', payments: 'pembayaran', expenses: 'pengeluaran', users: 'pengguna', files: 'berkas',
  contracts: 'perjanjian',
}

async function stamp(tx: Tx, tableKey: string, where: SQL | undefined, batch: string, userId: string) {
  const t = TABLES[tableKey]
  const rows = await tx
    .update(t)
    .set({ deletedAt: new Date().toISOString(), deletedBy: userId, deleteBatch: batch } as never)
    .where(and(where, isNull(t.deletedAt)))
    .returning({ id: t.id })
  return rows.length
}

async function liveRentalsCount(tx: Tx, column: 'roomId' | 'tenantId' | 'propertyId', id: string) {
  const r = await tx
    .select({ c: dsql<number>`count(*)` })
    .from(schema.rentals)
    .where(and(eq(schema.rentals[column], id), inArray(schema.rentals.status, ['booked', 'active']), isNull(schema.rentals.deletedAt)))
  return Number(r[0].c)
}

interface Plan {
  label: string
  propertyId: string | null
  /** table → condition selecting the rows that go into the same batch */
  cascade: [string, SQL][]
  after?: (tx: Tx, fx: Effects) => Promise<void>
}

async function plan(tx: Tx, entity: TrashEntity, id: string, actor: SessionUser): Promise<Plan> {
  switch (entity) {
    case 'property': {
      const p = await tx.query.properties.findFirst({ where: and(eq(schema.properties.id, id), isNull(schema.properties.deletedAt)) })
      if (!p) throw notFound('Properti')
      if (await liveRentalsCount(tx, 'propertyId', id)) {
        throw conflict('Properti masih memiliki penyewa atau pemesanan aktif. Akhiri semua sewa terlebih dahulu.')
      }
      return {
        label: p.name,
        propertyId: id,
        cascade: [
          ['rooms', eq(schema.rooms.propertyId, id)],
          ['services', eq(schema.services.propertyId, id)],
          ['rentals', eq(schema.rentals.propertyId, id)],
          ['invoices', eq(schema.invoices.propertyId, id)],
          ['payments', eq(schema.payments.propertyId, id)],
          ['expenses', eq(schema.expenses.propertyId, id)],
          ['contracts', eq(schema.contracts.propertyId, id)],
        ],
        after: async (_tx, fx) => fx.push(() => events.emit('property:deleted', id)),
      }
    }
    case 'room': {
      const r = await tx.query.rooms.findFirst({ where: and(eq(schema.rooms.id, id), isNull(schema.rooms.deletedAt)) })
      if (!r) throw notFound('Kamar')
      if (await liveRentalsCount(tx, 'roomId', id)) {
        throw conflict('Kamar ini masih disewa atau dipesan. Akhiri sewanya terlebih dahulu.')
      }
      const p = await tx.query.properties.findFirst({ where: eq(schema.properties.id, r.propertyId) })
      return { label: `${r.name} · ${p?.name ?? ''}`, propertyId: r.propertyId, cascade: [] }
    }
    case 'service': {
      const s = await tx.query.services.findFirst({ where: and(eq(schema.services.id, id), isNull(schema.services.deletedAt)) })
      if (!s) throw notFound('Layanan')
      return { label: s.name, propertyId: s.propertyId, cascade: [] }
    }
    case 'tenant': {
      const t = await tx.query.tenants.findFirst({ where: and(eq(schema.tenants.id, id), isNull(schema.tenants.deletedAt)) })
      if (!t) throw notFound('Penyewa')
      if (await liveRentalsCount(tx, 'tenantId', id)) {
        throw conflict(`${t.name} masih memiliki sewa atau pemesanan aktif. Akhiri atau batalkan terlebih dahulu.`)
      }
      // Financial history (rentals, invoices, payments) stays; documents go with the tenant.
      return {
        label: t.name,
        propertyId: t.waitlistPropertyId,
        cascade: [
          ['files', and(eq(schema.files.ownerType, 'tenant'), eq(schema.files.ownerId, id))!],
          ['contracts', eq(schema.contracts.tenantId, id)],
        ],
      }
    }
    case 'invoice': {
      const i = await tx.query.invoices.findFirst({ where: and(eq(schema.invoices.id, id), isNull(schema.invoices.deletedAt)) })
      if (!i) throw notFound('Faktur')
      return {
        label: `Faktur ${i.number}`,
        propertyId: i.propertyId,
        cascade: [['payments', eq(schema.payments.invoiceId, id)]],
      }
    }
    case 'payment': {
      const p = await tx.query.payments.findFirst({ where: and(eq(schema.payments.id, id), isNull(schema.payments.deletedAt)) })
      if (!p) throw notFound('Pembayaran')
      return {
        label: `Pembayaran ${p.transactionId} (${formatIDR(p.amount)})`,
        propertyId: p.propertyId,
        cascade: [],
        after: async (t) => {
          if (p.invoiceId) await recomputeInvoice(t, p.invoiceId)
        },
      }
    }
    case 'expense': {
      const e = await tx.query.expenses.findFirst({ where: and(eq(schema.expenses.id, id), isNull(schema.expenses.deletedAt)) })
      if (!e) throw notFound('Pengeluaran')
      return { label: `${e.name} (${formatIDR(e.total)})`, propertyId: e.propertyId, cascade: [] }
    }
    case 'user': {
      const u = await tx.query.users.findFirst({ where: and(eq(schema.users.id, id), isNull(schema.users.deletedAt)) })
      if (!u) throw notFound('Pengguna')
      if (u.id === actor.id) throw badRequest('Anda tidak dapat menghapus akun Anda sendiri.')
      // Owners (superadmin/developer) hold a whole workspace; they're never removed through the trash.
      if (u.role === 'superadmin' || u.role === 'developer') throw conflict('Akun pemilik tidak dapat dihapus.')
      return {
        label: `${u.name} (@${u.username})`,
        propertyId: null,
        cascade: [],
        after: async (t) => {
          await t.delete(schema.sessions).where(eq(schema.sessions.userId, id))
          await t.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, id))
        },
      }
    }
    case 'file': {
      const f = await tx.query.files.findFirst({ where: and(eq(schema.files.id, id), isNull(schema.files.deletedAt)) })
      if (!f) throw notFound('Berkas')
      return { label: f.originalName, propertyId: null, cascade: [] }
    }
    case 'contract': {
      const c = await tx.query.contracts.findFirst({ where: and(eq(schema.contracts.id, id), isNull(schema.contracts.deletedAt)) })
      if (!c) throw notFound('Perjanjian')
      return { label: `Perjanjian ${c.number}`, propertyId: c.propertyId, cascade: [] }
    }
  }
}

const ROOT_TABLE: Record<TrashEntity, string> = {
  property: 'properties', room: 'rooms', service: 'services', tenant: 'tenants', invoice: 'invoices',
  payment: 'payments', expense: 'expenses', user: 'users', file: 'files', contract: 'contracts',
}

/**
 * Run every check a delete would (exists, no active lease…) without deleting.
 * Used to validate a delete request before it goes to the superadmin.
 */
export async function previewDelete(entity: TrashEntity, id: string, actor: SessionUser) {
  const p = await db.transaction((tx) => plan(tx, entity, id, actor))
  return { label: p.label, propertyId: p.propertyId, noun: LABELS[ROOT_TABLE[entity]] }
}

/** Soft-delete `entity` and its dependants. Returns the trash (batch) id. */
export async function softDelete(entity: TrashEntity, id: string, actor: SessionUser, ip: string, opts: { version?: number } = {}) {
  const fx = new Effects()
  const batch = randomUUID()
  const result = await db.transaction(async (tx) => {
    const p = await plan(tx, entity, id, actor)
    const rootKey = ROOT_TABLE[entity]
    const root = TABLES[rootKey]

    // Optimistic lock on the row being deleted, when the client sent its version.
    if (opts.version !== undefined && 'version' in root) {
      const v = await tx.execute<{ version: number }>(dsql`select version from ${root} where id = ${id}`)
      if (v[0] && Number(v[0].version) !== opts.version) {
        throw conflict('Data ini baru saja diubah oleh admin lain. Muat ulang lalu coba lagi.', 'stale_version')
      }
    }

    const counts: Record<string, number> = {}
    const n = await stamp(tx, rootKey, eq(root.id, id), batch, actor.id)
    if (!n) throw notFound('Data')
    for (const [key, cond] of p.cascade) {
      const c = await stamp(tx, key, cond, batch, actor.id)
      if (c) counts[LABELS[key]] = (counts[LABELS[key]] ?? 0) + c
    }
    await tx.insert(schema.trash).values({
      id: batch, entityType: entity, entityId: id, label: p.label, propertyId: p.propertyId, ownerId: actor.ownerId, counts,
      deletedBy: actor.id, deletedByName: actor.name,
    })
    await p.after?.(tx, fx)
    const extra = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')
    await writeAudit(actor, ip, {
      action: `${entity}.delete`, entityType: entity, entityId: id, propertyId: p.propertyId,
      summary: `Hapus ${LABELS[rootKey]} "${p.label}"${extra ? ` beserta ${extra}` : ''} (dapat dipulihkan)`,
      meta: { batch, counts },
    }, tx)
    return { batch, label: p.label, counts }
  })
  await fx.run()
  bumpRev()
  return result
}

/** Restore a whole delete batch. Superadmin only. */
export async function restore(batch: string, actor: SessionUser, ip: string) {
  if (actor.role !== 'superadmin' && actor.role !== 'developer') throw forbidden('Hanya superadmin yang dapat memulihkan data.')
  const fx = new Effects()
  try {
    const item = await db.transaction(async (tx) => {
      const item = await tx.query.trash.findFirst({ where: and(eq(schema.trash.id, batch), isNull(schema.trash.restoredAt)) })
      // Another owner's trash doesn't exist for this user.
      if (!item || item.ownerId !== actor.ownerId) throw notFound('Item tempat sampah')

      // A child can't come back into a parent that is still in the trash.
      const parentCheck: Partial<Record<TrashEntity, () => Promise<string | null>>> = {
        room: async () => {
          const r = await tx.query.rooms.findFirst({ where: eq(schema.rooms.id, item.entityId) })
          const p = r && (await tx.query.properties.findFirst({ where: eq(schema.properties.id, r.propertyId) }))
          return p?.deletedAt ? `Pulihkan dulu properti "${p.name}".` : null
        },
        service: async () => {
          const s = await tx.query.services.findFirst({ where: eq(schema.services.id, item.entityId) })
          const p = s && (await tx.query.properties.findFirst({ where: eq(schema.properties.id, s.propertyId) }))
          return p?.deletedAt ? `Pulihkan dulu properti "${p.name}".` : null
        },
        payment: async () => {
          const pay = await tx.query.payments.findFirst({ where: eq(schema.payments.id, item.entityId) })
          if (!pay?.invoiceId) return null
          const inv = await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, pay.invoiceId) })
          return inv?.deletedAt ? `Pulihkan dulu faktur ${inv.number}.` : null
        },
        expense: async () => {
          const e = await tx.query.expenses.findFirst({ where: eq(schema.expenses.id, item.entityId) })
          const p = e && (await tx.query.properties.findFirst({ where: eq(schema.properties.id, e.propertyId) }))
          return p?.deletedAt ? `Pulihkan dulu properti "${p.name}".` : null
        },
        file: async () => {
          const f = await tx.query.files.findFirst({ where: eq(schema.files.id, item.entityId) })
          if (f?.ownerType !== 'tenant') return null
          const t = await tx.query.tenants.findFirst({ where: eq(schema.tenants.id, f.ownerId) })
          return t?.deletedAt ? `Pulihkan dulu penyewa "${t.name}".` : null
        },
      }
      const blocker = await parentCheck[item.entityType as TrashEntity]?.()
      if (blocker) throw conflict(blocker)

      for (const t of Object.values(TABLES)) {
        await tx
          .update(t)
          .set({ deletedAt: null, deletedBy: null, deleteBatch: null } as never)
          .where(eq(t.deleteBatch, batch))
      }
      await tx.update(schema.trash).set({ restoredAt: new Date().toISOString(), restoredBy: actor.id }).where(eq(schema.trash.id, batch))

      // Derived state that depends on what came back.
      if (item.entityType === 'payment') {
        const pay = await tx.query.payments.findFirst({ where: eq(schema.payments.id, item.entityId) })
        if (pay?.invoiceId) {
          await recomputeInvoice(tx, pay.invoiceId)
          const inv = await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, pay.invoiceId) })
          if (inv) await activateIfPaid(tx, inv.rentalId, fx)
        }
      }
      if (item.entityType === 'property') fx.push(() => events.emit('property:restored', item.entityId))

      await writeAudit(actor, ip, {
        action: `${item.entityType}.restore`, entityType: item.entityType, entityId: item.entityId, propertyId: item.propertyId,
        summary: `Pulihkan ${LABELS[ROOT_TABLE[item.entityType as TrashEntity]] ?? item.entityType} "${item.label}"`,
        meta: { batch },
      }, tx)
      return item
    })
    await fx.run()
    bumpRev()
    return item
  } catch (e) {
    // e.g. the WhatsApp number or username was taken while this was in the trash.
    throw mapDbError(e) ?? e
  }
}

export async function listTrash(ownerId: string, limit = 200): Promise<TrashItem[]> {
  const rows = await db
    .select()
    .from(schema.trash)
    .where(and(isNull(schema.trash.restoredAt), eq(schema.trash.ownerId, ownerId)))
    .orderBy(desc(schema.trash.deletedAt))
    .limit(limit)
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    label: r.label,
    propertyId: r.propertyId,
    deletedByName: r.deletedByName,
    deletedAt: iso(r.deletedAt)!,
    counts: r.counts,
  }))
}

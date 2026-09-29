import { and, desc, eq, inArray, isNull, or, sql as dsql, type SQL } from 'drizzle-orm'
import { APPROVAL_GATED } from '@shared/constants'
import { formatIDR } from '@shared/dates'
import { formatPhoneDisplay } from '@shared/phone'
import type {
  ApprovalChange, ApprovalKind, ApprovalRequest, ApprovalStatus, BookingPolicy, HouseRules, InvoiceItem, LateFee,
  MessageTemplate, PendingApproval, PriceSet,
} from '@shared/types'
import type { SessionUser } from '../auth/session'
import { type Executor, db, iso, schema, type Tx } from '../db/client'
import { Effects } from '../lib/effects'
import { badRequest, conflict, forbidden, notFound, staleVersion } from '../lib/errors'
import { events } from '../lib/events'
import { bumpRev } from '../lib/rev'
import { updateVersioned } from '../routes/util'
import { writeAudit } from './audit'
import { recomputeInvoice } from './billing'
import { notify } from './notify'
import { previewDelete, softDelete, type TrashEntity } from './trash'

/* ---------------------------------------------------------------------------
 * Four-eyes control.
 *
 * A superadmin's changes apply directly. For everyone else, deletes and edits
 * to what moves money or binds legally (prices, bank details, late fees, DP
 * policy, agreement text and signature, house rules, message templates,
 * invoice amounts) become a request. The superadmin approves — the server then
 * applies exactly the requested values — or rejects with a note.
 *
 * Harmless edits in the same save (address, notes, room condition…) still
 * apply at once, so daily work isn't blocked.
 * ------------------------------------------------------------------------- */

/** Owners (and a developer in their sandbox) decide; everyone else asks. */
export const needsApproval = (u: SessionUser) => u.role !== 'superadmin' && u.role !== 'developer'

type PropertyRow = typeof schema.properties.$inferSelect
type RoomRow = typeof schema.rooms.$inferSelect
type InvoiceRow = typeof schema.invoices.$inferSelect

/* What needs approval is defined once, in shared/, so the UI warns about exactly what the server enforces. */
const PROPERTY_GATED = APPROVAL_GATED.property
/** Inside `agreement` (link expiry and auto-send stay free). */
const AGREEMENT_GATED = APPROVAL_GATED.agreement
const ROOM_GATED = APPROVAL_GATED.room
const INVOICE_GATED = APPROVAL_GATED.invoice

/* ------------------------------------------------------------------ comparison */

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
  }
  return v
}
export const same = (a: unknown, b: unknown) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null))

const pick = <T extends object>(o: T, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, (o as Record<string, unknown>)[k]]))

/**
 * Split a patch into what applies now and what needs approval. Only fields
 * that actually differ from the stored row count — the property page sends its
 * whole draft on every save.
 */
export function splitPatch<Row extends object>(
  current: Row,
  patch: Record<string, unknown>,
  gatedKeys: readonly string[],
  nested?: { key: string; gated: readonly string[] },
) {
  const direct: Record<string, unknown> = {}
  const gated: Record<string, unknown> = {}
  const cur = current as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (nested && k === nested.key) {
      const now = (cur[k] ?? {}) as Record<string, unknown>
      const next = v as Record<string, unknown>
      const gatedSub = Object.fromEntries(nested.gated.filter((s) => s in next && !same(next[s], now[s])).map((s) => [s, next[s]]))
      // The free part of the object, with the gated sub-fields kept at their stored values.
      const freePart = { ...next, ...pick(now, nested.gated) }
      if (!same(freePart, now)) direct[k] = freePart
      if (Object.keys(gatedSub).length) gated[k] = gatedSub
      continue
    }
    if (same(v, cur[k])) continue
    if (gatedKeys.includes(k)) gated[k] = v
    else direct[k] = v
  }
  return { direct, gated }
}

/** The stored values of exactly the fields a request touches. */
function snapshotOf(current: Record<string, unknown>, gated: Record<string, unknown>, nestedKey?: string) {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(gated)) {
    if (k === nestedKey) out[k] = pick((current[k] ?? {}) as object, Object.keys(gated[k] as object))
    else out[k] = current[k] ?? null
  }
  return out
}

/* ------------------------------------------------------------------ human-readable diff */

const SCHEME_LABEL: Record<keyof PriceSet, string> = { daily: 'harian', weekly: 'mingguan', monthly: 'bulanan', yearly: 'tahunan' }
const onOff = (b: unknown) => (b ? 'Aktif' : 'Nonaktif')

function describeLateFee(f: LateFee | null | undefined) {
  if (!f || !f.enabled) return 'Tidak ada denda'
  const amount = f.type === 'percent' ? `${f.value}% tagihan` : formatIDR(f.value)
  return `${amount} ${f.frequency === 'daily' ? 'per hari terlambat' : 'sekali'}, setelah ${f.graceDays} hari`
}
function describeBooking(b: BookingPolicy | null | undefined) {
  if (!b) return '-'
  return `Kamar ditahan ${b.dpHoldDays} hari · toleransi ${b.graceDays} hari · DP ${b.lapsePolicy === 'forfeit' ? 'hangus otomatis' : 'diputuskan admin'}`
}
function allRules(r: HouseRules | null | undefined) {
  if (!r) return []
  return [...Object.values(r.groups ?? {}).flat(), ...(r.custom ?? [])]
}
function describeItems(items: InvoiceItem[] | null | undefined) {
  if (!items?.length) return '-'
  const total = items.reduce((a, i) => a + i.amount, 0)
  return `${items.map((i) => `${i.name} ${formatIDR(i.amount)}`).join(' + ')} = ${formatIDR(total)}`
}

function describe(kind: ApprovalKind, label: string, before: Record<string, unknown>, payload: Record<string, unknown>): ApprovalChange[] {
  if (kind === 'delete') {
    return [{ field: 'delete', label: 'Status data', before: 'Masih ada', after: 'Dihapus (dapat dipulihkan dari Tempat Sampah)' }]
  }
  if (kind === 'invoice.void') {
    return [{ field: 'status', label: 'Status faktur', before: 'Aktif', after: 'Dibatalkan' }]
  }
  const out: ApprovalChange[] = []
  for (const [k, after] of Object.entries(payload)) {
    const prev = before[k]
    switch (k) {
      case 'name': out.push({ field: k, label: 'Nama', before: String(prev ?? ''), after: String(after) }); break
      case 'code': out.push({ field: k, label: 'Kode (penomoran faktur)', before: String(prev ?? ''), after: String(after) }); break
      case 'phone':
        out.push({ field: k, label: 'Nomor WhatsApp properti', before: formatPhoneDisplay(prev as string), after: formatPhoneDisplay(after as string) })
        break
      case 'paymentInfo': out.push({ field: k, label: 'Info pembayaran / rekening', before: String(prev ?? '') || '(kosong)', after: String(after) || '(kosong)' }); break
      case 'paymentMethods': {
        const txt = (m: { cash?: boolean; transfer?: boolean } | null) =>
          [m?.cash && 'Tunai', m?.transfer && 'Transfer'].filter(Boolean).join(', ') || '-'
        out.push({ field: k, label: 'Metode pembayaran', before: txt(prev as never), after: txt(after as never) })
        break
      }
      case 'lateFee': out.push({ field: k, label: 'Denda keterlambatan', before: describeLateFee(prev as LateFee), after: describeLateFee(after as LateFee) }); break
      case 'booking': out.push({ field: k, label: 'Kebijakan DP', before: describeBooking(prev as BookingPolicy), after: describeBooking(after as BookingPolicy) }); break
      case 'rules': {
        const a = allRules(prev as HouseRules)
        const b = allRules(after as HouseRules)
        const added = b.filter((x) => !a.includes(x))
        const removed = a.filter((x) => !b.includes(x))
        for (const r of added) out.push({ field: 'rules', label: 'Tata tertib — ditambah', before: '', after: r })
        for (const r of removed) out.push({ field: 'rules', label: 'Tata tertib — dihapus', before: r, after: '' })
        if (!added.length && !removed.length) out.push({ field: 'rules', label: 'Tata tertib', before: `${a.length} aturan`, after: 'Urutan/pengelompokan diubah' })
        break
      }
      case 'templates': {
        const a = ((prev as { whatsapp?: MessageTemplate[] })?.whatsapp ?? [])
        const b = ((after as { whatsapp?: MessageTemplate[] })?.whatsapp ?? [])
        for (const t of b) {
          const old = a.find((x) => x.id === t.id)
          if (!old || old.body !== t.body) out.push({ field: 'templates', label: `Template WA: ${t.label}`, before: old?.body ?? '(baru)', after: t.body })
        }
        for (const t of a) if (!b.some((x) => x.id === t.id)) out.push({ field: 'templates', label: `Template WA: ${t.label}`, before: t.body, after: '(dihapus)' })
        break
      }
      case 'agreement': {
        const a = (prev ?? {}) as Record<string, unknown>
        const b = after as Record<string, unknown>
        if ('template' in b) out.push({ field: 'agreement.template', label: 'Teks perjanjian sewa', before: String(a.template ?? ''), after: String(b.template) })
        if ('ownerName' in b) out.push({ field: 'agreement.ownerName', label: 'Nama pihak pertama', before: String(a.ownerName ?? ''), after: String(b.ownerName) })
        if ('ownerTitle' in b) out.push({ field: 'agreement.ownerTitle', label: 'Jabatan pihak pertama', before: String(a.ownerTitle ?? ''), after: String(b.ownerTitle) })
        if ('contactEmail' in b) out.push({ field: 'agreement.contactEmail', label: 'Email kontak', before: String(a.contactEmail ?? ''), after: String(b.contactEmail) })
        if ('ownerSignatureFileId' in b) {
          out.push({
            field: 'agreement.ownerSignatureFileId', label: 'Tanda tangan pemilik',
            before: a.ownerSignatureFileId ? 'Tanda tangan lama' : 'Belum ada', after: b.ownerSignatureFileId ? 'Tanda tangan baru' : 'Dihapus',
            fileIds: { before: (a.ownerSignatureFileId as string) ?? null, after: (b.ownerSignatureFileId as string) ?? null },
          })
        }
        if ('logoFileId' in b) {
          out.push({
            field: 'agreement.logoFileId', label: 'Logo kop surat',
            before: a.logoFileId ? 'Logo lama' : 'Belum ada', after: b.logoFileId ? 'Logo baru' : 'Dihapus',
            fileIds: { before: (a.logoFileId as string) ?? null, after: (b.logoFileId as string) ?? null },
          })
        }
        break
      }
      case 'price': {
        const a = (prev ?? {}) as PriceSet
        const b = after as PriceSet
        for (const s of Object.keys(SCHEME_LABEL) as (keyof PriceSet)[]) {
          if ((a[s] ?? 0) !== (b[s] ?? 0)) out.push({ field: `price.${s}`, label: `Harga ${SCHEME_LABEL[s]}`, before: formatIDR(a[s] ?? 0), after: formatIDR(b[s] ?? 0) })
        }
        break
      }
      case 'schemes': {
        const a = (prev ?? {}) as Record<string, boolean>
        const b = after as Record<string, boolean>
        for (const s of Object.keys(SCHEME_LABEL)) {
          if (Boolean(a[s]) !== Boolean(b[s])) out.push({ field: `schemes.${s}`, label: `Sewa ${SCHEME_LABEL[s as keyof PriceSet]}`, before: onOff(a[s]), after: onOff(b[s]) })
        }
        break
      }
      case 'items': out.push({ field: k, label: 'Rincian & total faktur', before: describeItems(prev as InvoiceItem[]), after: describeItems(after as InvoiceItem[]) }); break
      default: out.push({ field: k, label: k, before: JSON.stringify(prev ?? ''), after: JSON.stringify(after) })
    }
  }
  return out
}

/* ------------------------------------------------------------------ mapping */

type Row = typeof schema.approvalRequests.$inferSelect

export function toApproval(r: Row): ApprovalRequest {
  const fields = Object.entries(r.payload).flatMap(([k, v]) =>
    k === 'agreement' && v && typeof v === 'object' ? Object.keys(v).map((s) => `agreement.${s}`) : [k])
  return {
    id: r.id,
    kind: r.kind as ApprovalKind,
    entityType: r.entityType,
    entityId: r.entityId,
    propertyId: r.propertyId,
    label: r.label,
    reason: r.reason,
    status: r.status as ApprovalStatus,
    fields: r.kind === 'delete' ? ['delete'] : r.kind === 'invoice.void' ? ['void'] : fields,
    changes: describe(r.kind as ApprovalKind, r.label, r.before, r.payload),
    requestedById: r.requestedBy,
    requestedByName: r.requestedByName,
    reviewedByName: r.reviewedByName,
    reviewNote: r.reviewNote,
    error: r.error,
    createdAt: iso(r.createdAt)!,
    reviewedAt: iso(r.reviewedAt),
  }
}

function visibleTo(u: SessionUser): SQL | undefined {
  const t = schema.approvalRequests
  // Own workspace only, always.
  if (u.allProperties) return eq(t.ownerId, u.ownerId)
  const mine = eq(t.requestedBy, u.id)
  return and(eq(t.ownerId, u.ownerId), u.propertyIds.length ? or(mine, inArray(t.propertyId, u.propertyIds)) : mine)
}

export async function listApprovals(u: SessionUser, opts: { status: 'pending' | 'history'; limit?: number }) {
  const t = schema.approvalRequests
  const byStatus = opts.status === 'pending' ? eq(t.status, 'pending') : dsql`${t.status} <> 'pending'`
  const rows = await db
    .select()
    .from(t)
    .where(and(byStatus, visibleTo(u)))
    .orderBy(desc(opts.status === 'pending' ? t.createdAt : dsql`coalesce(${t.reviewedAt}, ${t.createdAt})`))
    .limit(opts.limit ?? 200)
  return rows.map(toApproval)
}

/* ------------------------------------------------------------------ creating */

export interface NewRequest {
  kind: ApprovalKind
  entityType: string
  entityId: string
  propertyId: string | null
  label: string
  payload?: Record<string, unknown>
  before?: Record<string, unknown>
  reason?: string
}

export async function requestApproval(exec: Executor, u: SessionUser, ip: string, input: NewRequest, fx: Effects): Promise<ApprovalRequest> {
  const t = schema.approvalRequests
  const pending = await exec.query.approvalRequests.findFirst({
    where: and(eq(t.kind, input.kind), eq(t.entityId, input.entityId), eq(t.status, 'pending')),
  })
  if (pending) {
    // Saving the same draft again is not a new request.
    if (same(pending.payload, input.payload ?? {})) return toApproval(pending)
    throw conflict(
      `Masih ada permintaan "${pending.label}" dari ${pending.requestedByName} yang menunggu persetujuan superadmin. Batalkan permintaan itu dulu atau tunggu keputusannya.`,
      'approval_pending',
    )
  }
  const [row] = await exec.insert(t).values({
    kind: input.kind, entityType: input.entityType, entityId: input.entityId, propertyId: input.propertyId, ownerId: u.ownerId,
    label: input.label, payload: input.payload ?? {}, before: input.before ?? {}, reason: (input.reason ?? '').trim().slice(0, 500),
    requestedBy: u.id, requestedByName: u.name,
  }).returning()
  await writeAudit(u, ip, {
    action: 'approval.request', entityType: input.entityType, entityId: input.entityId, propertyId: input.propertyId,
    summary: `Minta persetujuan: ${input.label}`, meta: { requestId: row.id, kind: input.kind },
  }, exec as Tx)
  await notify(exec, {
    type: 'approval_requested', severity: 'warning', audience: 'superadmin', propertyId: input.propertyId,
    ownerId: u.ownerId,
    title: `Perlu persetujuan: ${input.label}`,
    body: `Diminta oleh ${u.name}${row.reason ? ` — "${row.reason}"` : ''}`,
    link: `/approvals?id=${row.id}`, dedupeKey: `approval:${row.id}`, push: true,
  }, fx)
  fx.push(() => bumpRev())
  return toApproval(row)
}

export const pendingResponse = (request: ApprovalRequest, applied?: unknown): PendingApproval =>
  ({ pendingApproval: true, request, ...(applied !== undefined ? { applied } : {}) })

/** Deletes by non-superadmins: validate (same checks as a real delete) and queue. */
export async function requestDelete(u: SessionUser, ip: string, entity: TrashEntity, id: string, reason?: string) {
  const preview = await previewDelete(entity, id, u)
  const fx = new Effects()
  const req = await db.transaction((tx) => requestApproval(tx, u, ip, {
    kind: 'delete', entityType: entity, entityId: id, propertyId: preview.propertyId,
    label: `Hapus ${preview.noun} "${preview.label}"`, reason,
  }, fx))
  await fx.run()
  return pendingResponse(req)
}

/* ------------------------------------------------------------------ applying (shared with the direct routes) */

async function lockRow(tx: Tx, table: 'properties' | 'rooms' | 'invoices', id: string) {
  const rows = await tx.execute<{ version: number }>(dsql`select version from ${dsql.identifier(table)} where id = ${id} and deleted_at is null for update`)
  if (!rows[0]) throw notFound('Data')
  return Number(rows[0].version)
}

/** Everything a property edit must satisfy, whoever makes it. */
export async function validatePropertyPatch(exec: Executor, current: PropertyRow, patch: Record<string, unknown>) {
  if (typeof patch.phone === 'string' && patch.phone !== current.phone) {
    // The linked device must always be the configured number: unlink first, then change.
    const wa = await exec.query.waSessions.findFirst({ where: eq(schema.waSessions.propertyId, current.id) })
    if (wa && ['connected', 'connecting', 'qr'].includes(wa.status)) {
      throw conflict('Putuskan WhatsApp properti ini terlebih dahulu sebelum mengganti nomornya, lalu pindai ulang dengan nomor baru.', 'wa_connected')
    }
  }
  const patchAgreement = patch.agreement as { ownerSignatureFileId?: string | null; logoFileId?: string | null } | undefined
  const sig = patchAgreement?.ownerSignatureFileId
  if (sig) {
    const f = await exec.query.files.findFirst({ where: eq(schema.files.id, sig) })
    if (!f || f.ownerType !== 'property' || f.ownerId !== current.id) throw badRequest('Tanda tangan pemilik tidak valid.')
  }
  const logo = patchAgreement?.logoFileId
  if (logo) {
    const f = await exec.query.files.findFirst({ where: eq(schema.files.id, logo) })
    if (!f || f.ownerType !== 'property' || f.ownerId !== current.id) throw badRequest('Logo kop surat tidak valid.')
  }
}

export async function writePropertyPatch(
  tx: Tx, actor: SessionUser, ip: string, current: PropertyRow, version: number, patch: Record<string, unknown>, fx: Effects,
  note = '',
) {
  const updated = await updateVersioned(tx, schema.properties, current.id, version, patch)
  await writeAudit(actor, ip, {
    action: 'property.update', entityType: 'property', entityId: current.id, propertyId: current.id,
    summary: `Ubah properti ${updated.name} (${Object.keys(patch).join(', ')})${note}`,
  }, tx)
  if (typeof patch.phone === 'string' && patch.phone !== current.phone) {
    await tx.update(schema.waSessions).set({ status: 'disconnected', lastError: null, phone: null }).where(eq(schema.waSessions.propertyId, current.id))
    fx.push(() => events.emit('property:phoneChanged', current.id))
  }
  return updated
}

/** Admin saves a property: harmless fields apply now, sensitive ones become one request. */
export async function saveProperty(u: SessionUser, ip: string, id: string, version: number, patch: Record<string, unknown>, reason?: string) {
  const current = await db.query.properties.findFirst({ where: and(eq(schema.properties.id, id), isNull(schema.properties.deletedAt)) })
  if (!current) throw notFound('Properti')
  if (typeof patch.code === 'string') patch.code = patch.code.toUpperCase()

  const { direct, gated } = needsApproval(u)
    ? splitPatch(current, patch, PROPERTY_GATED, { key: 'agreement', gated: AGREEMENT_GATED })
    : { direct: patch, gated: {} as Record<string, unknown> }
  await validatePropertyPatch(db, current, { ...direct, ...gated, agreement: { ...current.agreement, ...(gated.agreement as object) } })

  const fx = new Effects()
  const result = await db.transaction(async (tx) => {
    // Checked for the whole save: a request built from a stale draft would silently revert others' edits.
    if ((await lockRow(tx, 'properties', id)) !== version) throw staleVersion()
    let row: PropertyRow = current
    if (Object.keys(direct).length || !Object.keys(gated).length) {
      row = await writePropertyPatch(tx, u, ip, current, version, direct, fx)
    }
    if (!Object.keys(gated).length) return { row, request: null }
    const request = await requestApproval(tx, u, ip, {
      kind: 'property.update', entityType: 'property', entityId: id, propertyId: id,
      label: `Ubah pengaturan penting ${current.name}`, payload: gated,
      before: snapshotOf(current as unknown as Record<string, unknown>, gated, 'agreement'), reason,
    }, fx)
    return { row, request }
  })
  await fx.run()
  bumpRev()
  return result
}

export async function saveRoom(u: SessionUser, ip: string, room: RoomRow, version: number, patch: Record<string, unknown>, reason?: string) {
  const { direct, gated } = needsApproval(u) ? splitPatch(room, patch, ROOM_GATED) : { direct: patch, gated: {} as Record<string, unknown> }
  const property = await db.query.properties.findFirst({ where: eq(schema.properties.id, room.propertyId) })
  const fx = new Effects()
  const result = await db.transaction(async (tx) => {
    if ((await lockRow(tx, 'rooms', room.id)) !== version) throw staleVersion()
    let row: RoomRow = room
    if (Object.keys(direct).length || !Object.keys(gated).length) {
      row = await updateVersioned(tx, schema.rooms, room.id, version, direct)
      await writeAudit(u, ip, {
        action: 'room.update', entityType: 'room', entityId: room.id, propertyId: room.propertyId,
        summary: typeof direct.condition === 'string' && Object.keys(direct).length === 1
          ? `Ubah kondisi ${room.name} menjadi ${direct.condition}` : `Ubah ${room.name} (${Object.keys(direct).join(', ')})`,
      }, tx)
    }
    if (!Object.keys(gated).length) return { row, request: null }
    const request = await requestApproval(tx, u, ip, {
      kind: 'room.update', entityType: 'room', entityId: room.id, propertyId: room.propertyId,
      label: `Ubah harga ${room.name} · ${property?.name ?? ''}`, payload: gated,
      before: snapshotOf(room as unknown as Record<string, unknown>, gated), reason,
    }, fx)
    return { row, request }
  })
  await fx.run()
  bumpRev()
  return result
}

/** Validate and write new invoice lines (amounts). */
async function writeInvoiceItems(tx: Tx, actor: SessionUser, ip: string, inv: InvoiceRow, version: number, items: InvoiceItem[], note = '') {
  const subtotal = items.reduce((a, i) => a + i.amount, 0)
  if (subtotal <= 0) throw badRequest('Total faktur harus lebih dari 0.')
  if (subtotal < inv.paidAmount) throw badRequest(`Total baru tidak boleh lebih kecil dari yang sudah dibayar (${formatIDR(inv.paidAmount)}).`)
  await updateVersioned(tx, schema.invoices, inv.id, version, { items, subtotal, total: subtotal + inv.lateFee })
  await writeAudit(actor, ip, {
    action: 'invoice.update', entityType: 'invoice', entityId: inv.id, propertyId: inv.propertyId,
    summary: `Ubah rincian faktur ${inv.number} (${formatIDR(inv.subtotal)} → ${formatIDR(subtotal)})${note}`,
  }, tx)
}

export async function saveInvoice(u: SessionUser, ip: string, inv: InvoiceRow, version: number, patch: Record<string, unknown>, reason?: string) {
  if (inv.status === 'batal') throw conflict('Faktur yang dibatalkan tidak bisa diubah.')
  const { direct, gated } = needsApproval(u) ? splitPatch(inv, patch, INVOICE_GATED) : { direct: {} as Record<string, unknown>, gated: {} as Record<string, unknown> }
  const fx = new Effects()
  const result = await db.transaction(async (tx) => {
    if ((await lockRow(tx, 'invoices', inv.id)) !== version) throw staleVersion()
    if (!needsApproval(u)) {
      const { items, ...rest } = patch as { items?: InvoiceItem[] }
      let v = version
      if (Object.keys(rest).length) {
        await updateVersioned(tx, schema.invoices, inv.id, v, rest)
        v += 1
        await writeAudit(u, ip, { action: 'invoice.update', entityType: 'invoice', entityId: inv.id, propertyId: inv.propertyId, summary: `Ubah faktur ${inv.number} (${Object.keys(rest).join(', ')})` }, tx)
      }
      if (items && !same(items, inv.items)) await writeInvoiceItems(tx, u, ip, inv, v, items)
      return { row: (await recomputeInvoice(tx, inv.id))!, request: null }
    }
    if (Object.keys(direct).length) {
      await updateVersioned(tx, schema.invoices, inv.id, version, direct)
      await writeAudit(u, ip, { action: 'invoice.update', entityType: 'invoice', entityId: inv.id, propertyId: inv.propertyId, summary: `Ubah faktur ${inv.number} (${Object.keys(direct).join(', ')})` }, tx)
    }
    const row = (await recomputeInvoice(tx, inv.id))!
    if (!Object.keys(gated).length) return { row, request: null }
    const items = gated.items as InvoiceItem[]
    const subtotal = items.reduce((a, i) => a + i.amount, 0)
    if (subtotal <= 0) throw badRequest('Total faktur harus lebih dari 0.')
    if (subtotal < inv.paidAmount) throw badRequest(`Total baru tidak boleh lebih kecil dari yang sudah dibayar (${formatIDR(inv.paidAmount)}).`)
    const request = await requestApproval(tx, u, ip, {
      kind: 'invoice.update', entityType: 'invoice', entityId: inv.id, propertyId: inv.propertyId,
      label: `Ubah nominal faktur ${inv.number}`, payload: gated, before: { items: inv.items }, reason,
    }, fx)
    return { row, request }
  })
  await fx.run()
  bumpRev()
  return result
}

async function writeVoid(tx: Tx, actor: SessionUser, ip: string, inv: InvoiceRow, note = '') {
  if (inv.status === 'batal') throw conflict('Faktur ini sudah dibatalkan.')
  if (inv.paidAmount > 0) throw conflict('Faktur yang sudah dibayar tidak bisa dibatalkan. Hapus pembayarannya terlebih dahulu.')
  const [row] = await tx.update(schema.invoices)
    .set({ status: 'batal', updatedAt: new Date().toISOString(), version: dsql`${schema.invoices.version} + 1` })
    .where(eq(schema.invoices.id, inv.id)).returning()
  await writeAudit(actor, ip, { action: 'invoice.void', entityType: 'invoice', entityId: inv.id, propertyId: inv.propertyId, summary: `Batalkan faktur ${inv.number}${note}` }, tx)
  return row
}

export async function voidInvoice(u: SessionUser, ip: string, inv: InvoiceRow, reason?: string) {
  if (inv.status === 'batal') throw conflict('Faktur ini sudah dibatalkan.')
  if (inv.paidAmount > 0) throw conflict('Faktur yang sudah dibayar tidak bisa dibatalkan. Hapus pembayarannya terlebih dahulu.')
  const fx = new Effects()
  const result = await db.transaction(async (tx) => {
    if (!needsApproval(u)) return { row: await writeVoid(tx, u, ip, inv), request: null }
    const request = await requestApproval(tx, u, ip, {
      kind: 'invoice.void', entityType: 'invoice', entityId: inv.id, propertyId: inv.propertyId,
      label: `Batalkan faktur ${inv.number}`, reason,
    }, fx)
    return { row: inv, request }
  })
  await fx.run()
  bumpRev()
  return result
}

/* ------------------------------------------------------------------ reviewing */

function assertUnchanged(current: Record<string, unknown>, before: Record<string, unknown>, nestedKey?: string) {
  for (const [k, v] of Object.entries(before)) {
    const now = k === nestedKey ? pick((current[k] ?? {}) as object, Object.keys(v as object)) : current[k]
    if (!same(now, v)) {
      throw conflict('Data ini sudah diubah sejak permintaan dibuat, jadi perubahan tidak diterapkan agar tidak menimpa perubahan lain. Tolak permintaan ini dan minta admin mengajukan ulang.', 'approval_stale')
    }
  }
}

async function loadPending(tx: Tx, id: string, ownerId: string) {
  const rows = await tx.execute<{ id: string }>(dsql`select id from approval_requests where id = ${id} for update`)
  if (!rows[0]) throw notFound('Permintaan')
  const req = await tx.query.approvalRequests.findFirst({ where: eq(schema.approvalRequests.id, id) })
  if (!req || req.ownerId !== ownerId) throw notFound('Permintaan')
  if (req.status !== 'pending') throw conflict('Permintaan ini sudah diproses.')
  return req
}

const entityLink = (r: Row) => {
  switch (r.entityType) {
    case 'property': return `/properties/${r.entityId}`
    case 'room': return '/rooms'
    case 'tenant': return `/tenants/${r.entityId}`
    default: return '/approvals?tab=history'
  }
}

export async function approveRequest(actor: SessionUser, ip: string, id: string, note?: string) {
  if (needsApproval(actor)) throw forbidden('Hanya superadmin yang dapat menyetujui.')
  const fx = new Effects()
  let deleteAfter: { entity: TrashEntity; id: string } | null = null

  const req = await db.transaction(async (tx) => {
    const r = await loadPending(tx, id, actor.ownerId)
    if (r.propertyId && !actor.allProperties && !actor.propertyIds.includes(r.propertyId)) throw forbidden('Anda tidak memiliki akses ke properti ini.')
    const suffix = ` — diminta oleh ${r.requestedByName}, disetujui ${actor.name}`

    switch (r.kind as ApprovalKind) {
      case 'property.update': {
        const version = await lockRow(tx, 'properties', r.entityId)
        const current = (await tx.query.properties.findFirst({ where: eq(schema.properties.id, r.entityId) }))!
        assertUnchanged(current as unknown as Record<string, unknown>, r.before, 'agreement')
        const patch: Record<string, unknown> = { ...r.payload }
        if (patch.agreement) patch.agreement = { ...current.agreement, ...(patch.agreement as object) }
        await validatePropertyPatch(tx, current, patch)
        await writePropertyPatch(tx, actor, ip, current, version, patch, fx, suffix)
        break
      }
      case 'room.update': {
        const version = await lockRow(tx, 'rooms', r.entityId)
        const current = (await tx.query.rooms.findFirst({ where: eq(schema.rooms.id, r.entityId) }))!
        assertUnchanged(current as unknown as Record<string, unknown>, r.before)
        await updateVersioned(tx, schema.rooms, r.entityId, version, r.payload)
        await writeAudit(actor, ip, {
          action: 'room.update', entityType: 'room', entityId: r.entityId, propertyId: r.propertyId,
          summary: `${r.label}${suffix}`,
        }, tx)
        break
      }
      case 'invoice.update': {
        const version = await lockRow(tx, 'invoices', r.entityId)
        const inv = (await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, r.entityId) }))!
        if (inv.status === 'batal') throw conflict('Faktur ini sudah dibatalkan.')
        assertUnchanged(inv as unknown as Record<string, unknown>, r.before)
        await writeInvoiceItems(tx, actor, ip, inv, version, r.payload.items as InvoiceItem[], suffix)
        await recomputeInvoice(tx, inv.id)
        break
      }
      case 'invoice.void': {
        await lockRow(tx, 'invoices', r.entityId)
        const inv = (await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, r.entityId) }))!
        await writeVoid(tx, actor, ip, inv, suffix)
        break
      }
      case 'delete':
        // softDelete runs its own transaction (and all its checks) — done right after this one commits.
        deleteAfter = { entity: r.entityType as TrashEntity, id: r.entityId }
        break
    }
    return r
  })

  if (deleteAfter) {
    const d = deleteAfter as { entity: TrashEntity; id: string }
    // Re-checks everything a direct delete checks (e.g. no active lease any more).
    const res = await softDelete(d.entity, d.id, actor, ip)
    await db.update(schema.trash).set({ deletedByName: `${req.requestedByName} (disetujui ${actor.name})` }).where(eq(schema.trash.id, res.batch))
  }

  const [done] = await db.update(schema.approvalRequests)
    .set({ status: 'approved', reviewedBy: actor.id, reviewedByName: actor.name, reviewNote: note?.trim() || null, reviewedAt: new Date().toISOString() })
    .where(and(eq(schema.approvalRequests.id, id), eq(schema.approvalRequests.status, 'pending')))
    .returning()
  if (!done) throw conflict('Permintaan ini sudah diproses.')
  await writeAudit(actor, ip, {
    action: 'approval.approve', entityType: req.entityType, entityId: req.entityId, propertyId: req.propertyId,
    summary: `Setujui: ${req.label} (diminta oleh ${req.requestedByName})`, meta: { requestId: id },
  })
  await notify(db, {
    type: 'approval_approved', severity: 'success', userId: req.requestedBy,
    title: `Disetujui: ${req.label}`, body: note?.trim() ? `Catatan ${actor.name}: ${note.trim()}` : `Disetujui oleh ${actor.name}.`,
    link: req.kind === 'delete' ? '/approvals?tab=history' : entityLink(req), push: true,
  }, fx)
  await fx.run()
  bumpRev()
  return toApproval(done)
}

export async function rejectRequest(actor: SessionUser, ip: string, id: string, note: string) {
  if (needsApproval(actor)) throw forbidden('Hanya superadmin yang dapat menolak.')
  if (!note.trim()) throw badRequest('Tulis alasan penolakan agar admin tahu apa yang perlu diperbaiki.')
  const fx = new Effects()
  const row = await db.transaction(async (tx) => {
    const r = await loadPending(tx, id, actor.ownerId)
    const [done] = await tx.update(schema.approvalRequests)
      .set({ status: 'rejected', reviewedBy: actor.id, reviewedByName: actor.name, reviewNote: note.trim().slice(0, 1000), reviewedAt: new Date().toISOString() })
      .where(eq(schema.approvalRequests.id, id)).returning()
    await writeAudit(actor, ip, {
      action: 'approval.reject', entityType: r.entityType, entityId: r.entityId, propertyId: r.propertyId,
      summary: `Tolak: ${r.label} (diminta oleh ${r.requestedByName}) — ${note.trim()}`, meta: { requestId: id },
    }, tx)
    await notify(tx, {
      type: 'approval_rejected', severity: 'warning', userId: r.requestedBy,
      title: `Ditolak: ${r.label}`, body: `${actor.name}: ${note.trim()}`, link: '/approvals?tab=history', push: true,
    }, fx)
    return done
  })
  await fx.run()
  bumpRev()
  return toApproval(row)
}

export async function cancelRequest(u: SessionUser, ip: string, id: string) {
  const row = await db.transaction(async (tx) => {
    const r = await loadPending(tx, id, u.ownerId)
    if (r.requestedBy !== u.id) throw forbidden('Hanya pembuat permintaan yang dapat membatalkannya.')
    const [done] = await tx.update(schema.approvalRequests)
      .set({ status: 'canceled', reviewedAt: new Date().toISOString() })
      .where(eq(schema.approvalRequests.id, id)).returning()
    await writeAudit(u, ip, {
      action: 'approval.cancel', entityType: r.entityType, entityId: r.entityId, propertyId: r.propertyId,
      summary: `Batalkan permintaan: ${r.label}`, meta: { requestId: id },
    }, tx)
    return done
  })
  bumpRev()
  return toApproval(row)
}

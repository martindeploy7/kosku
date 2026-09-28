import { and, eq, gt, inArray, isNull, ne, notInArray, sql as dsql } from 'drizzle-orm'
import { addDays, formatDate, formatIDR, todayInTz } from '@shared/dates'
import {
  amountDueOn, invoiceStatus, type PaidLine, planFirstInvoice, planRecurringInvoices, settleInvoice,
} from '@shared/finance'
import type { InvoiceStatus, PaymentKind, PaymentMethod, RentType } from '@shared/types'
import { type Executor, schema } from '../db/client'
import { env } from '../env'
import { transactionId } from '../lib/crypto'
import type { Effects } from '../lib/effects'
import { badRequest, conflict, notFound } from '../lib/errors'
import { writeAudit } from './audit'
import { invoiceVars, queueWa, render } from './messages'
import { notify } from './notify'
import { getAppSettings } from './settings'

export const appToday = () => todayInTz(env.APP_TIMEZONE)

/** How far ahead recurring invoices are issued, so "upcoming" and H-n reminders have something to show. */
export const LEAD_DAYS = 7

export interface Actor {
  id: string
  username: string
  name: string
}

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect']
type RentalRow = Row<typeof schema.rentals>
type InvoiceRow = Row<typeof schema.invoices>
type PropertyRow = Row<typeof schema.properties>

const nowIso = () => new Date().toISOString()

/* ------------------------------------------------------------------ numbering */

async function nextSeq(exec: Executor, key: string): Promise<number> {
  const rows = await exec.execute<{ value: number }>(
    dsql`insert into counters (key, value) values (${key}, 1)
         on conflict (key) do update set value = counters.value + 1
         returning value`,
  )
  return Number(rows[0].value)
}

export async function nextInvoiceNumber(exec: Executor, property: Pick<PropertyRow, 'id' | 'code'>, date: string) {
  const yymm = date.slice(2, 4) + date.slice(5, 7)
  const seq = await nextSeq(exec, `inv:${property.id}:${yymm}`)
  return `${property.code}-${yymm}-${String(seq).padStart(4, '0')}`
}

export async function nextContractNumber(exec: Executor, property: Pick<PropertyRow, 'id' | 'code'>, date: string) {
  const yymm = date.slice(2, 4) + date.slice(5, 7)
  const seq = await nextSeq(exec, `ctr:${property.id}:${yymm}`)
  return `PSK/${property.code}/${yymm}/${String(seq).padStart(3, '0')}`
}

/* ------------------------------------------------------------------ invoice state */

/** Payment lines (date, amount) per invoice — the input to settleInvoice. */
async function paymentLines(exec: Executor, invoiceIds: string[]) {
  const out = new Map<string, PaidLine[]>()
  if (!invoiceIds.length) return out
  const rows = await exec
    .select({ id: schema.payments.invoiceId, date: schema.payments.date, amount: schema.payments.amount })
    .from(schema.payments)
    .where(and(inArray(schema.payments.invoiceId, invoiceIds), isNull(schema.payments.deletedAt)))
  for (const r of rows) {
    const list = out.get(r.id!) ?? []
    list.push({ date: r.date, amount: r.amount })
    out.set(r.id!, list)
  }
  return out
}

const changed = (a: Pick<InvoiceRow, 'paidAmount' | 'lateFee' | 'total' | 'status'>, b: typeof a) =>
  a.paidAmount !== b.paidAmount || a.lateFee !== b.lateFee || a.total !== b.total || a.status !== b.status

/** Re-derive paid amount, late fee and status for one invoice. */
export async function recomputeInvoice(exec: Executor, invoiceId: string, asOf = appToday()) {
  const inv = await exec.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) })
  if (!inv || inv.deletedAt) return null
  const rental = await exec.query.rentals.findFirst({ where: eq(schema.rentals.id, inv.rentalId) })
  const property = await exec.query.properties.findFirst({ where: eq(schema.properties.id, inv.propertyId) })
  if (!rental || !property) return inv
  const lines = (await paymentLines(exec, [inv.id])).get(inv.id) ?? []
  const next = settleInvoice(inv, lines, rental.status, property.lateFee, asOf)
  if (changed(next, inv)) {
    const [updated] = await exec
      .update(schema.invoices)
      .set({ ...next, updatedAt: nowIso() })
      .where(eq(schema.invoices.id, inv.id))
      .returning()
    return updated
  }
  return inv
}

/* ------------------------------------------------------------------ recurring invoices */

async function rentalContext(exec: Executor, rental: RentalRow) {
  const room = await exec.query.rooms.findFirst({ where: eq(schema.rooms.id, rental.roomId) })
  const property = await exec.query.properties.findFirst({ where: eq(schema.properties.id, rental.propertyId) })
  const svc = rental.serviceIds.length
    ? await exec.select().from(schema.services).where(inArray(schema.services.id, rental.serviceIds))
    : []
  if (!room || !property) throw notFound('Kamar atau properti')
  const services = svc.map((s) => ({ id: s.id, propertyId: s.propertyId, name: s.name, price: s.price, version: s.version }))
  return { room, property, services }
}

/**
 * Issue every recurring invoice due by `horizon`. Idempotent: periods already
 * billed — including ones an admin deleted or voided — are never re-issued.
 */
export async function ensureRecurringInvoices(exec: Executor, rental: RentalRow, asOf = appToday()) {
  if (rental.status !== 'active' || rental.deletedAt) return 0
  const horizon = addDays(asOf, LEAD_DAYS)
  const last = await exec
    .select({ end: dsql<string | null>`max(${schema.invoices.periodEnd})::text` })
    .from(schema.invoices)
    .where(eq(schema.invoices.rentalId, rental.id))
  const lastEnd = last[0]?.end ?? rental.startDate
  if (lastEnd > horizon) return 0

  const { room, property, services } = await rentalContext(exec, rental)
  const plans = planRecurringInvoices(rental, lastEnd, horizon, room.name, services)
  let created = 0
  for (const p of plans) {
    const number = await nextInvoiceNumber(exec, property, p.periodStart)
    const status: InvoiceStatus = invoiceStatus({ total: p.subtotal, dueDate: p.dueDate }, 0, asOf)
    const rows = await exec
      .insert(schema.invoices)
      .values({
        number, rentalId: rental.id, tenantId: rental.tenantId, roomId: rental.roomId, propertyId: rental.propertyId,
        periodStart: p.periodStart, periodEnd: p.periodEnd, dueDate: p.dueDate, items: p.items,
        subtotal: p.subtotal, lateFee: 0, total: p.subtotal, paidAmount: 0, status, isFirst: false,
      })
      .onConflictDoNothing({ target: [schema.invoices.rentalId, schema.invoices.periodStart] })
      .returning({ id: schema.invoices.id })
    created += rows.length
  }
  return created
}

/* ------------------------------------------------------------------ create rental / booking */

export interface CreateRentalInput {
  tenantId: string
  roomId: string
  startDate: string
  endDate: string | null
  rentType: RentType
  price: number
  billingDay: number
  serviceIds: string[]
  depositAmount: number
  depositPaid: boolean
  /** full: first invoice paid now → occupied/lunas. dp: DP now, balance by deadline → booked. later: existing tenant, bill as usual. */
  paymentMode: 'full' | 'dp' | 'later'
  dpAmount: number
  paymentDeadline: string | null
  method: PaymentMethod
  paymentDate: string
  note?: string
}

export async function createRental(
  exec: Executor,
  input: CreateRentalInput,
  actor: Actor,
  ip: string | null,
  fx: Effects,
) {
  const room = await exec.query.rooms.findFirst({
    where: and(eq(schema.rooms.id, input.roomId), isNull(schema.rooms.deletedAt)),
  })
  if (!room) throw notFound('Kamar')
  const property = await exec.query.properties.findFirst({
    where: and(eq(schema.properties.id, room.propertyId), isNull(schema.properties.deletedAt)),
  })
  if (!property) throw notFound('Properti')
  const tenant = await exec.query.tenants.findFirst({
    where: and(eq(schema.tenants.id, input.tenantId), isNull(schema.tenants.deletedAt)),
  })
  // A lease joins a tenant and a room of the same owner, never across workspaces.
  if (!tenant || tenant.ownerId !== property.ownerId) throw notFound('Penyewa')

  const existing = await exec.query.rentals.findFirst({
    where: and(
      eq(schema.rentals.tenantId, tenant.id),
      inArray(schema.rentals.status, ['booked', 'active']),
      isNull(schema.rentals.deletedAt),
    ),
  })
  if (existing) throw conflict(`${tenant.name} masih memiliki sewa/pemesanan yang berjalan. Akhiri atau batalkan dulu.`)

  if (input.price <= 0) throw badRequest('Harga sewa harus lebih dari 0.')
  if (input.endDate && input.endDate <= input.startDate) throw badRequest('Tanggal selesai harus setelah tanggal mulai.')

  const today = appToday()
  let deadline: string | null = null
  if (input.paymentMode === 'dp') {
    if (input.dpAmount <= 0) throw badRequest('Nominal DP harus lebih dari 0.')
    deadline = input.paymentDeadline || addDays(today, property.booking.dpHoldDays || 3)
    if (deadline < today) throw badRequest('Batas pelunasan tidak boleh sebelum hari ini.')
  }

  const status = input.paymentMode === 'dp' ? 'booked' : 'active'
  const [rental] = await exec
    .insert(schema.rentals)
    .values({
      tenantId: tenant.id, roomId: room.id, propertyId: property.id,
      startDate: input.startDate, endDate: input.endDate, rentType: input.rentType,
      price: input.price, billingDay: input.billingDay, serviceIds: input.serviceIds,
      depositAmount: input.depositAmount, dpAmount: input.paymentMode === 'dp' ? input.dpAmount : 0,
      status, paymentDeadline: deadline, activatedAt: status === 'active' ? nowIso() : null,
      endNote: input.note ?? '', createdBy: actor.id,
    })
    .returning()

  const { services } = await rentalContext(exec, rental)
  const plan = planFirstInvoice(rental, room.name, services)
  if (input.paymentMode === 'dp' && input.dpAmount >= plan.subtotal) {
    throw badRequest(`DP (${formatIDR(input.dpAmount)}) tidak boleh menutup seluruh tagihan pertama (${formatIDR(plan.subtotal)}). Pilih "Lunas" bila dibayar penuh.`)
  }

  const [first] = await exec
    .insert(schema.invoices)
    .values({
      number: await nextInvoiceNumber(exec, property, plan.periodStart),
      rentalId: rental.id, tenantId: tenant.id, roomId: room.id, propertyId: property.id,
      periodStart: plan.periodStart, periodEnd: plan.periodEnd, dueDate: plan.dueDate,
      items: plan.items, subtotal: plan.subtotal, lateFee: 0, total: plan.subtotal, paidAmount: 0,
      status: invoiceStatus({ total: plan.subtotal, dueDate: plan.dueDate }, 0, today), isFirst: true,
    })
    .returning()

  const pay = (p: { kind: PaymentKind; amount: number; invoiceId: string | null; note: string; prefix: string }) =>
    exec.insert(schema.payments).values({
      transactionId: transactionId(p.prefix), invoiceId: p.invoiceId, rentalId: rental.id,
      tenantId: tenant.id, propertyId: property.id, date: input.paymentDate, method: input.method,
      amount: p.amount, kind: p.kind, note: p.note, createdBy: actor.id,
    })

  if (input.depositAmount > 0 && input.depositPaid) {
    await pay({ kind: 'deposit', amount: input.depositAmount, invoiceId: null, note: 'Uang jaminan', prefix: 'DEP' })
  }
  if (input.paymentMode === 'dp') {
    await pay({ kind: 'dp', amount: input.dpAmount, invoiceId: first.id, note: 'Uang muka (DP)', prefix: 'DP' })
  }
  if (input.paymentMode === 'full') {
    await pay({
      kind: 'rent', amount: plan.subtotal, invoiceId: first.id, note: 'Pembayaran sewa pertama',
      prefix: input.method === 'cash' ? 'CSH' : 'TRF',
    })
  }
  await recomputeInvoice(exec, first.id, today)
  if (status === 'active') await ensureRecurringInvoices(exec, rental, today)

  await exec
    .update(schema.tenants)
    .set({ isWaitlist: false, waitlistPropertyId: null, updatedAt: nowIso() })
    .where(eq(schema.tenants.id, tenant.id))

  if (status === 'booked') {
    await notify(exec, {
      type: 'booking_created', severity: 'info',
      title: `Pemesanan DP: ${tenant.name} · ${room.name}`,
      body: `DP ${formatIDR(input.dpAmount)} diterima. Sisa ${formatIDR(plan.subtotal - input.dpAmount)} wajib lunas paling lambat ${formatDate(deadline, 'long')}.`,
      link: `/tenants/${tenant.id}`, propertyId: property.id,
    }, fx)
    await queueWa(exec, {
      propertyId: property.id, tenantId: tenant.id, phone: tenant.phone,
      body: render(property, 'booking', {
        penyewa: tenant.name, properti: property.name, kamar: room.name,
        uangMuka: formatIDR(input.dpAmount), sisa: formatIDR(plan.subtotal - input.dpAmount),
        batasPelunasan: formatDate(deadline, 'long'), infoPembayaran: property.paymentInfo,
      }),
      dedupeKey: `booking:${rental.id}`, createdBy: actor.id,
    }, fx)
  } else {
    await notify(exec, {
      type: 'rental_created', severity: 'success',
      title: `Penyewa baru: ${tenant.name} · ${room.name}`,
      body: input.paymentMode === 'full'
        ? `Tagihan pertama ${formatIDR(plan.subtotal)} lunas. Kamar terisi mulai ${formatDate(input.startDate, 'long')}.`
        : `Sewa dicatat mulai ${formatDate(input.startDate, 'long')}. Tagihan pertama ${formatIDR(plan.subtotal)}.`,
      link: `/tenants/${tenant.id}`, propertyId: property.id, push: false,
    }, fx)
  }

  await writeAudit(actor, ip, {
    action: status === 'booked' ? 'rental.book' : 'rental.create',
    entityType: 'rental', entityId: rental.id, propertyId: property.id,
    summary: `${status === 'booked' ? 'Pemesanan DP' : 'Sewa baru'} ${tenant.name} di ${room.name} (${property.name})`,
    meta: { paymentMode: input.paymentMode, price: input.price, dpAmount: input.dpAmount, deadline },
  }, exec)

  return rental
}

/* ------------------------------------------------------------------ booking → active */

/** A booking becomes an active lease the moment its first invoice is paid in full. */
export async function activateIfPaid(exec: Executor, rentalId: string, fx: Effects, asOf = appToday()) {
  const rental = await exec.query.rentals.findFirst({ where: eq(schema.rentals.id, rentalId) })
  if (!rental || rental.status !== 'booked') return false
  const first = await exec.query.invoices.findFirst({
    where: and(eq(schema.invoices.rentalId, rentalId), eq(schema.invoices.isFirst, true), isNull(schema.invoices.deletedAt)),
  })
  if (!first || first.status !== 'lunas') return false

  const [active] = await exec
    .update(schema.rentals)
    .set({ status: 'active', activatedAt: nowIso(), updatedAt: nowIso(), version: dsql`${schema.rentals.version} + 1` })
    .where(eq(schema.rentals.id, rentalId))
    .returning()

  // The DP stops being a refundable liability and becomes rent income.
  await exec
    .update(schema.payments)
    .set({ category: 'Pendapatan Bisnis', updatedAt: nowIso() })
    .where(and(eq(schema.payments.rentalId, rentalId), eq(schema.payments.kind, 'dp'), gt(schema.payments.amount, 0)))

  await ensureRecurringInvoices(exec, active, asOf)

  const tenant = await exec.query.tenants.findFirst({ where: eq(schema.tenants.id, rental.tenantId) })
  const room = await exec.query.rooms.findFirst({ where: eq(schema.rooms.id, rental.roomId) })
  await notify(exec, {
    type: 'booking_paid', severity: 'success',
    title: `Pemesanan lunas: ${tenant?.name ?? ''} · ${room?.name ?? ''}`,
    body: 'Status kamar berubah menjadi Terisi · Lunas.',
    link: `/tenants/${rental.tenantId}`, propertyId: rental.propertyId, push: true,
  }, fx)
  return true
}

/* ------------------------------------------------------------------ payments */

export interface RecordPaymentInput {
  invoiceId: string | null
  tenantId: string
  rentalId: string | null
  date: string
  method: PaymentMethod
  amount: number
  kind: PaymentKind
  note: string
  attachmentFileId: string | null
}

export async function recordPayment(
  exec: Executor,
  input: RecordPaymentInput,
  actor: Actor,
  ip: string | null,
  fx: Effects,
  opts: { sendReceipt?: boolean } = {},
) {
  if (input.amount <= 0) throw badRequest('Jumlah pembayaran harus lebih dari 0.')

  let invoice: InvoiceRow | null = null
  let rental: RentalRow | null = null
  if (input.invoiceId) {
    invoice = (await exec.query.invoices.findFirst({
      where: and(eq(schema.invoices.id, input.invoiceId), isNull(schema.invoices.deletedAt)),
    })) ?? null
    if (!invoice) throw notFound('Faktur')
    if (invoice.status === 'batal') throw badRequest('Faktur ini sudah dibatalkan.')
    rental = (await exec.query.rentals.findFirst({ where: eq(schema.rentals.id, invoice.rentalId) })) ?? null
    const property = await exec.query.properties.findFirst({ where: eq(schema.properties.id, invoice.propertyId) })
    const lines = (await paymentLines(exec, [invoice.id])).get(invoice.id) ?? []
    // Owed as of the payment date: a backdated, on-time payment owes no late fee.
    const remaining = amountDueOn(invoice, lines, rental?.status ?? 'active', property!.lateFee, input.date)
    if (remaining <= 0) throw conflict('Faktur ini sudah lunas.')
    if (input.amount > remaining) {
      throw badRequest(`Jumlah melebihi sisa tagihan per ${formatDate(input.date, 'long')} (${formatIDR(remaining)}).`)
    }
  } else if (input.rentalId) {
    rental = (await exec.query.rentals.findFirst({ where: eq(schema.rentals.id, input.rentalId) })) ?? null
  }

  const propertyId = invoice?.propertyId ?? rental?.propertyId
  if (!propertyId) throw badRequest('Pembayaran harus terkait faktur atau sewa.')
  const tenantId = invoice?.tenantId ?? rental?.tenantId ?? input.tenantId

  const prefix = input.kind === 'deposit' ? 'DEP' : input.kind === 'dp' ? 'DP' : input.method === 'cash' ? 'CSH' : 'TRF'
  const [payment] = await exec
    .insert(schema.payments)
    .values({
      transactionId: transactionId(prefix), invoiceId: invoice?.id ?? null, rentalId: rental?.id ?? null,
      tenantId, propertyId, date: input.date, method: input.method, amount: input.amount,
      kind: input.kind, note: input.note, attachmentFileId: input.attachmentFileId, createdBy: actor.id,
    })
    .returning()

  let updatedInvoice = invoice
  if (invoice) {
    updatedInvoice = await recomputeInvoice(exec, invoice.id)
    await activateIfPaid(exec, invoice.rentalId, fx)
  }

  const tenant = await exec.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) })
  const property = await exec.query.properties.findFirst({ where: eq(schema.properties.id, propertyId) })

  await notify(exec, {
    type: 'payment_recorded', severity: 'success',
    title: `Pembayaran ${formatIDR(input.amount)} · ${tenant?.name ?? ''}`,
    body: `${invoice ? `Faktur ${invoice.number}` : 'Pembayaran'} dicatat oleh ${actor.name}.`,
    link: `/tenants/${tenantId}`, propertyId, push: false,
  }, fx)

  await writeAudit(actor, ip, {
    action: 'payment.create', entityType: 'payment', entityId: payment.id, propertyId,
    summary: `Catat pembayaran ${formatIDR(input.amount)} (${payment.transactionId})${invoice ? ` untuk ${invoice.number}` : ''}`,
    meta: { amount: input.amount, method: input.method, kind: input.kind },
  }, exec)

  const settings = await getAppSettings(property?.ownerId ?? actor.id, exec)
  const wantReceipt = opts.sendReceipt ?? settings.notifications.paymentReceipt
  if (wantReceipt && tenant?.phone && property && updatedInvoice) {
    const room = await exec.query.rooms.findFirst({ where: eq(schema.rooms.id, updatedInvoice.roomId) })
    await queueWa(exec, {
      propertyId, tenantId, phone: tenant.phone,
      body: render(property, 'receipt', {
        ...invoiceVars({ property, tenantName: tenant.name, roomName: room?.name ?? '', invoice: updatedInvoice }),
        idPembayaran: payment.transactionId, total: formatIDR(input.amount), tanggal: formatDate(input.date, 'long'),
      }),
      dedupeKey: `receipt:${payment.id}`, createdBy: actor.id,
    }, fx)
  }

  return payment
}

/* ------------------------------------------------------------------ ending, cancelling, lapsing */

async function depositBalance(exec: Executor, rentalId: string) {
  const rows = await exec
    .select({ total: dsql<number>`coalesce(sum(${schema.payments.amount}), 0)` })
    .from(schema.payments)
    .where(and(eq(schema.payments.rentalId, rentalId), eq(schema.payments.kind, 'deposit'), isNull(schema.payments.deletedAt)))
  return Number(rows[0]?.total ?? 0)
}

async function dpReceived(exec: Executor, rentalId: string) {
  const rows = await exec
    .select({ total: dsql<number>`coalesce(sum(${schema.payments.amount}), 0)` })
    .from(schema.payments)
    .where(and(eq(schema.payments.rentalId, rentalId), eq(schema.payments.kind, 'dp'), isNull(schema.payments.deletedAt)))
  return Number(rows[0]?.total ?? 0)
}

/** Void invoices nobody has paid anything on — they will never be collected. */
async function voidUnpaidInvoices(exec: Executor, rentalId: string, fromPeriod?: string) {
  await exec
    .update(schema.invoices)
    .set({ status: 'batal', updatedAt: nowIso() })
    .where(and(
      eq(schema.invoices.rentalId, rentalId),
      isNull(schema.invoices.deletedAt),
      ne(schema.invoices.status, 'lunas'),
      eq(schema.invoices.paidAmount, 0),
      fromPeriod ? dsql`${schema.invoices.periodStart} >= ${fromPeriod}` : dsql`true`,
    ))
}

export interface EndRentalInput {
  endDate: string
  refundAmount: number
  convertToIncome: boolean
  note: string
  checkOutNote: string
  version: number
}

export async function endRental(exec: Executor, rentalId: string, input: EndRentalInput, actor: Actor, ip: string | null, fx: Effects) {
  const rental = await exec.query.rentals.findFirst({
    where: and(eq(schema.rentals.id, rentalId), isNull(schema.rentals.deletedAt)),
  })
  if (!rental) throw notFound('Sewa')
  if (rental.status === 'booked') throw badRequest('Pemesanan DP dibatalkan lewat "Batalkan pemesanan", bukan check-out.')
  if (rental.status !== 'active') throw conflict('Sewa ini sudah tidak aktif.')
  if (input.endDate <= rental.startDate) throw badRequest('Tanggal keluar harus setelah tanggal mulai sewa.')

  const balance = await depositBalance(exec, rental.id)
  if (input.refundAmount < 0 || input.refundAmount > balance) {
    throw badRequest(`Pengembalian jaminan maksimal ${formatIDR(balance)}.`)
  }

  const updated = await exec
    .update(schema.rentals)
    .set({
      status: 'ended', endDate: input.endDate, endedAt: nowIso(), endNote: input.note,
      updatedAt: nowIso(), version: dsql`${schema.rentals.version} + 1`,
    })
    .where(and(eq(schema.rentals.id, rental.id), eq(schema.rentals.version, input.version)))
    .returning()
  if (!updated.length) throw conflict('Sewa ini baru saja diubah oleh admin lain. Muat ulang lalu coba lagi.', 'stale_version')

  await voidUnpaidInvoices(exec, rental.id, input.endDate)

  const base = { rentalId: rental.id, tenantId: rental.tenantId, propertyId: rental.propertyId, date: input.endDate, method: 'cash' as const, createdBy: actor.id }
  if (input.refundAmount > 0) {
    await exec.insert(schema.payments).values({
      ...base, transactionId: transactionId('RFD'), amount: -input.refundAmount, kind: 'deposit',
      note: input.note || 'Pengembalian uang jaminan',
    })
  }
  const remaining = balance - input.refundAmount
  if (input.convertToIncome && remaining > 0) {
    // Cash does not move: the liability shrinks and income grows by the same amount.
    await exec.insert(schema.payments).values([
      { ...base, transactionId: transactionId('CNV'), amount: -remaining, kind: 'deposit', category: 'Uang Jaminan', note: 'Sisa uang jaminan dialihkan ke pendapatan' },
      { ...base, transactionId: transactionId('CNV'), amount: remaining, kind: 'rent', category: 'Konversi Uang Jaminan', note: 'Konversi sisa uang jaminan menjadi pendapatan' },
    ])
  }

  if (input.checkOutNote) {
    await exec.update(schema.tenants).set({ checkOutNote: input.checkOutNote, updatedAt: nowIso() }).where(eq(schema.tenants.id, rental.tenantId))
  }

  const tenant = await exec.query.tenants.findFirst({ where: eq(schema.tenants.id, rental.tenantId) })
  const room = await exec.query.rooms.findFirst({ where: eq(schema.rooms.id, rental.roomId) })
  await notify(exec, {
    type: 'rental_ended', severity: 'info',
    title: `Check-out: ${tenant?.name ?? ''} · ${room?.name ?? ''}`,
    body: `Sewa berakhir ${formatDate(input.endDate, 'long')}. Kamar tersedia kembali.`,
    link: '/rooms', propertyId: rental.propertyId, push: false,
  }, fx)
  await writeAudit(actor, ip, {
    action: 'rental.end', entityType: 'rental', entityId: rental.id, propertyId: rental.propertyId,
    summary: `Akhiri sewa ${tenant?.name ?? ''} di ${room?.name ?? ''} per ${input.endDate}`,
    meta: { refund: input.refundAmount, converted: input.convertToIncome ? remaining : 0 },
  }, exec)
  return updated[0]
}

type DpAction = 'forfeit' | 'refund'

/**
 * Settle the money a booking that never became a lease received: the DP and
 * any security deposit taken with it. Both follow the same decision — kept
 * (recorded as income) or given back — so no deposit is left on the books as
 * "held" for a room the tenant never moved into.
 */
async function settleDp(exec: Executor, rental: RentalRow, action: DpAction, actor: Actor | null, date: string) {
  const dp = await dpReceived(exec, rental.id)
  const deposit = await depositBalance(exec, rental.id)
  const base = { rentalId: rental.id, tenantId: rental.tenantId, propertyId: rental.propertyId, date, method: 'cash' as const, createdBy: actor?.id ?? null }
  if (dp > 0) {
    if (action === 'forfeit') {
      await exec
        .update(schema.payments)
        .set({ category: 'DP Hangus', updatedAt: nowIso() })
        .where(and(eq(schema.payments.rentalId, rental.id), eq(schema.payments.kind, 'dp'), gt(schema.payments.amount, 0)))
    } else {
      await exec.insert(schema.payments).values({ ...base, transactionId: transactionId('RFD'), amount: -dp, kind: 'dp', note: 'Pengembalian DP' })
    }
  }
  if (deposit > 0) {
    if (action === 'forfeit') {
      // Cash does not move: the liability shrinks and income grows by the same amount.
      await exec.insert(schema.payments).values([
        { ...base, transactionId: transactionId('CNV'), amount: -deposit, kind: 'deposit', category: 'Uang Jaminan', note: 'Uang jaminan hangus (pemesanan batal)' },
        { ...base, transactionId: transactionId('CNV'), amount: deposit, kind: 'rent', category: 'Konversi Uang Jaminan', note: 'Uang jaminan hangus (pemesanan batal)' },
      ])
    } else {
      await exec.insert(schema.payments).values({ ...base, transactionId: transactionId('RFD'), amount: -deposit, kind: 'deposit', note: 'Pengembalian uang jaminan (pemesanan batal)' })
    }
  }
  return dp + deposit
}

export async function cancelBooking(
  exec: Executor, rentalId: string, input: { dpAction: DpAction; note: string; version: number },
  actor: Actor, ip: string | null, fx: Effects,
) {
  const rental = await exec.query.rentals.findFirst({ where: and(eq(schema.rentals.id, rentalId), isNull(schema.rentals.deletedAt)) })
  if (!rental) throw notFound('Pemesanan')
  if (rental.status !== 'booked') throw conflict('Hanya pemesanan DP yang bisa dibatalkan.')
  const updated = await exec
    .update(schema.rentals)
    .set({ status: 'canceled', endedAt: nowIso(), endNote: input.note, updatedAt: nowIso(), version: dsql`${schema.rentals.version} + 1` })
    .where(and(eq(schema.rentals.id, rental.id), eq(schema.rentals.version, input.version)))
    .returning()
  if (!updated.length) throw conflict('Pemesanan ini baru saja diubah oleh admin lain. Muat ulang lalu coba lagi.', 'stale_version')

  await exec.update(schema.invoices).set({ status: 'batal', updatedAt: nowIso() })
    .where(and(eq(schema.invoices.rentalId, rental.id), ne(schema.invoices.status, 'lunas')))
  const dp = await settleDp(exec, rental, input.dpAction, actor, appToday())

  const tenant = await exec.query.tenants.findFirst({ where: eq(schema.tenants.id, rental.tenantId) })
  const room = await exec.query.rooms.findFirst({ where: eq(schema.rooms.id, rental.roomId) })
  await notify(exec, {
    type: 'booking_canceled', severity: 'info',
    title: `Pemesanan dibatalkan: ${tenant?.name ?? ''} · ${room?.name ?? ''}`,
    body: dp > 0 ? `Uang pemesanan ${formatIDR(dp)} ${input.dpAction === 'refund' ? 'dikembalikan' : 'hangus'}.` : 'Kamar tersedia kembali.',
    link: '/rooms', propertyId: rental.propertyId, push: false,
  }, fx)
  await writeAudit(actor, ip, {
    action: 'rental.cancel', entityType: 'rental', entityId: rental.id, propertyId: rental.propertyId,
    summary: `Batalkan pemesanan ${tenant?.name ?? ''} (${room?.name ?? ''}); DP ${input.dpAction === 'refund' ? 'dikembalikan' : 'hangus'}`,
  }, exec)
  return updated[0]
}

/** System action: the DP deadline passed without full payment, so the room is released. */
export async function lapseBooking(exec: Executor, rental: RentalRow, property: PropertyRow, asOf: string, fx: Effects) {
  const policy = property.booking.lapsePolicy
  const [updated] = await exec
    .update(schema.rentals)
    .set({
      status: 'lapsed', endedAt: nowIso(), lapseResolution: policy === 'forfeit' ? 'forfeit' : 'pending',
      endNote: `Gagal bayar: belum lunas sampai ${rental.paymentDeadline}`,
      updatedAt: nowIso(), version: dsql`${schema.rentals.version} + 1`,
    })
    .where(and(eq(schema.rentals.id, rental.id), eq(schema.rentals.status, 'booked')))
    .returning()
  if (!updated) return false

  await exec.update(schema.invoices).set({ status: 'batal', updatedAt: nowIso() })
    .where(and(eq(schema.invoices.rentalId, rental.id), ne(schema.invoices.status, 'lunas')))
  const dp = policy === 'forfeit'
    ? await settleDp(exec, rental, 'forfeit', null, asOf)
    : (await dpReceived(exec, rental.id)) + (await depositBalance(exec, rental.id))

  const tenant = await exec.query.tenants.findFirst({ where: eq(schema.tenants.id, rental.tenantId) })
  const room = await exec.query.rooms.findFirst({ where: eq(schema.rooms.id, rental.roomId) })
  await notify(exec, {
    type: 'booking_lapsed', severity: 'danger',
    title: `Gagal bayar: ${tenant?.name ?? ''} · ${room?.name ?? ''}`,
    body: `Belum lunas sampai ${formatDate(rental.paymentDeadline, 'long')}. Pemesanan dibatalkan otomatis dan ${room?.name ?? 'kamar'} tersedia kembali.` +
      (dp > 0 ? (policy === 'forfeit' ? ` Uang pemesanan ${formatIDR(dp)} hangus.` : ` Tentukan nasib uang pemesanan ${formatIDR(dp)} (DP + jaminan).`) : ''),
    link: `/tenants/${rental.tenantId}`, propertyId: rental.propertyId,
    dedupeKey: `lapsed:${rental.id}`, push: true,
  }, fx)
  if (tenant?.phone) {
    await queueWa(exec, {
      propertyId: rental.propertyId, tenantId: tenant.id, phone: tenant.phone,
      body: render(property, 'lapsed', {
        penyewa: tenant.name, properti: property.name, kamar: room?.name ?? '',
        batasPelunasan: formatDate(rental.paymentDeadline, 'long'),
      }),
      dedupeKey: `lapsed:${rental.id}`,
    }, fx)
  }
  await writeAudit(null, null, {
    action: 'rental.lapse', entityType: 'rental', entityId: rental.id, propertyId: rental.propertyId,
    summary: `Pemesanan ${tenant?.name ?? ''} (${room?.name ?? ''}) gagal bayar; kamar dilepas otomatis`,
    meta: { deadline: rental.paymentDeadline, dp, policy },
  }, exec)
  return true
}

export async function resolveLapse(exec: Executor, rentalId: string, action: DpAction, actor: Actor, ip: string | null) {
  const rental = await exec.query.rentals.findFirst({ where: eq(schema.rentals.id, rentalId) })
  if (!rental || rental.status !== 'lapsed' || rental.lapseResolution !== 'pending') {
    throw conflict('DP untuk pemesanan ini sudah diselesaikan.')
  }
  const amount = await settleDp(exec, rental, action, actor, appToday())
  await exec.update(schema.rentals)
    .set({ lapseResolution: action, updatedAt: nowIso(), version: dsql`${schema.rentals.version} + 1` })
    .where(eq(schema.rentals.id, rentalId))
  await writeAudit(actor, ip, {
    action: 'rental.resolve_dp', entityType: 'rental', entityId: rentalId, propertyId: rental.propertyId,
    summary: `DP ${formatIDR(amount)} ${action === 'refund' ? 'dikembalikan' : 'dinyatakan hangus'}`,
  }, exec)
}

/* ------------------------------------------------------------------ daily routines */

export interface DailyBillingResult {
  lapsed: number
  invoicesCreated: number
  invoicesUpdated: number
}

/** Idempotent; safe to run any number of times a day and after downtime. */
export async function runDailyBilling(exec: Executor, fx: Effects, asOf = appToday()): Promise<DailyBillingResult> {
  const liveProperties = await exec.select().from(schema.properties).where(isNull(schema.properties.deletedAt))
  const propById = new Map(liveProperties.map((p) => [p.id, p]))
  const propertyIds = [...propById.keys()]
  if (!propertyIds.length) return { lapsed: 0, invoicesCreated: 0, invoicesUpdated: 0 }

  // 1) Release rooms held by DPs whose deadline (+ grace) has passed.
  let lapsed = 0
  const booked = await exec.select().from(schema.rentals).where(and(
    eq(schema.rentals.status, 'booked'), isNull(schema.rentals.deletedAt), inArray(schema.rentals.propertyId, propertyIds),
  ))
  for (const r of booked) {
    const property = propById.get(r.propertyId)!
    // A booking paid in full since the last run is activated, not lapsed.
    if (await activateIfPaid(exec, r.id, fx, asOf)) continue
    const lastDay = addDays(r.paymentDeadline ?? r.startDate, property.booking.graceDays ?? 0)
    if (lastDay < asOf && (await lapseBooking(exec, r, property, asOf, fx))) lapsed++
  }

  // 2) Issue recurring invoices for active leases.
  let invoicesCreated = 0
  const active = await exec.select().from(schema.rentals).where(and(
    eq(schema.rentals.status, 'active'), isNull(schema.rentals.deletedAt), inArray(schema.rentals.propertyId, propertyIds),
  ))
  for (const r of active) invoicesCreated += await ensureRecurringInvoices(exec, r, asOf)

  // 3) Refresh status and late fees on every open invoice.
  const open = await exec.select().from(schema.invoices).where(and(
    isNull(schema.invoices.deletedAt), notInArray(schema.invoices.status, ['lunas', 'batal']),
    inArray(schema.invoices.propertyId, propertyIds),
  ))
  const lines = await paymentLines(exec, open.map((i) => i.id))
  const rentalStatus = new Map<string, RentalRow['status']>()
  for (const r of [...booked, ...active]) rentalStatus.set(r.id, r.status)
  let invoicesUpdated = 0
  for (const inv of open) {
    const status = rentalStatus.get(inv.rentalId) ?? 'active'
    const next = settleInvoice(inv, lines.get(inv.id) ?? [], status, propById.get(inv.propertyId)!.lateFee, asOf)
    if (changed(next, inv)) {
      await exec.update(schema.invoices).set({ ...next, updatedAt: nowIso() }).where(eq(schema.invoices.id, inv.id))
      invoicesUpdated++
    }
  }

  return { lapsed, invoicesCreated, invoicesUpdated }
}


import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { formatAddress } from '@shared/agreement'
import { formatIDR } from '@shared/dates'
import { type AppEnv, assertPropertyAccess, canDelete, requireUser } from '../auth/context'
import { db, schema } from '../db/client'
import { Effects } from '../lib/effects'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { bumpRev } from '../lib/rev'
import { renderInvoicePdf } from '../pdf/invoice'
import { writeAudit } from '../services/audit'
import {
  appToday, cancelBooking, createRental, endRental, nextInvoiceNumber, recomputeInvoice, recordPayment, resolveLapse,
} from '../services/billing'
import { createContract } from '../services/contracts'
import { storeBuffer } from '../services/files'
import { toInvoice, toPayment, toRental } from '../services/mappers'
import { invoiceVars, paymentInfoText, queueWa, render } from '../services/messages'
import { pendingResponse, saveInvoice, voidInvoice } from '../services/approvals'
import { approvalReason, deleteOrRequest } from './approvals'
import { actorOf, isoDate, items, jsonBody, money, parse, updateVersioned, uuid, version, z } from './util'

export const billingRoutes = new Hono<AppEnv>()

/* ================================================================== rentals */

const createRentalBody = z.object({
  tenantId: uuid,
  roomId: uuid,
  startDate: isoDate,
  endDate: isoDate.nullable().default(null),
  rentType: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']),
  price: money.min(1),
  billingDay: z.number().int().min(1).max(31),
  serviceIds: z.array(uuid).max(20).default([]),
  depositAmount: money.default(0),
  depositPaid: z.boolean().default(false),
  paymentMode: z.enum(['full', 'dp', 'later']),
  dpAmount: money.default(0),
  paymentDeadline: isoDate.nullable().default(null),
  method: z.enum(['cash', 'transfer']).default('cash'),
  paymentDate: isoDate.optional(),
  note: z.string().max(1000).optional(),
  /** Generate the agreement + house rules PDF and send it on WhatsApp. */
  sendContract: z.boolean().default(true),
})

billingRoutes.post('/rentals', async (c) => {
  const u = requireUser(c)
  const body = parse(createRentalBody, await jsonBody(c))
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, body.roomId) })
  if (!room) throw notFound('Kamar')
  assertPropertyAccess(u, room.propertyId)

  const fx = new Effects()
  const rental = await db.transaction((tx) =>
    createRental(tx, { ...body, paymentDate: body.paymentDate ?? appToday() }, actorOf(u), c.get('ip'), fx),
  )
  await fx.run()
  bumpRev()

  // The contract is created after the lease commits: PDF rendering must not hold the transaction open.
  let contract: { link: string; queued: boolean } | null = null
  let contractError: string | null = null
  const property = await db.query.properties.findFirst({ where: eq(schema.properties.id, rental.propertyId) })
  if (body.sendContract && property) {
    try {
      const r = await createContract(rental.id, actorOf(u), c.get('ip'), { send: property.agreement.autoSend })
      contract = { link: r.link, queued: r.queued }
    } catch (e) {
      contractError = e instanceof Error ? e.message : 'Gagal membuat perjanjian.'
    }
  }
  return c.json({ rental: toRental(rental), contract, contractError }, 201)
})

async function loadRental(id: string) {
  const r = await db.query.rentals.findFirst({ where: and(eq(schema.rentals.id, id), isNull(schema.rentals.deletedAt)) })
  if (!r) throw notFound('Sewa')
  return r
}

billingRoutes.patch('/rentals/:id', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const r = await loadRental(id)
  assertPropertyAccess(u, r.propertyId)
  const body = parse(z.object({
    version,
    paymentDeadline: isoDate.optional(),
    endDate: isoDate.nullable().optional(),
    billingDay: z.number().int().min(1).max(31).optional(),
  }), await jsonBody(c))
  if (body.paymentDeadline && r.status !== 'booked') throw badRequest('Batas pelunasan hanya untuk pemesanan DP.')
  if (body.paymentDeadline && body.paymentDeadline < appToday()) throw badRequest('Batas pelunasan tidak boleh sebelum hari ini.')
  const { version: v, ...patch } = body

  const row = await db.transaction(async (tx) => {
    const updated = await updateVersioned(tx, schema.rentals, id, v, patch)
    // The first invoice of a DP booking falls due on the deadline — keep them in step.
    if (patch.paymentDeadline) {
      await tx.update(schema.invoices).set({ dueDate: patch.paymentDeadline })
        .where(and(eq(schema.invoices.rentalId, id), eq(schema.invoices.isFirst, true)))
      const first = await tx.query.invoices.findFirst({ where: and(eq(schema.invoices.rentalId, id), eq(schema.invoices.isFirst, true)) })
      if (first) await recomputeInvoice(tx, first.id)
    }
    await writeAudit(u, c.get('ip'), {
      action: 'rental.update', entityType: 'rental', entityId: id, propertyId: r.propertyId,
      summary: patch.paymentDeadline ? `Perpanjang batas pelunasan DP sampai ${patch.paymentDeadline}` : 'Ubah data sewa',
      meta: patch,
    }, tx)
    return updated
  })
  bumpRev()
  return c.json(toRental(row))
})

billingRoutes.post('/rentals/:id/end', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const r = await loadRental(id)
  assertPropertyAccess(u, r.propertyId)
  const body = parse(z.object({
    endDate: isoDate, refundAmount: money.default(0), convertToIncome: z.boolean().default(false),
    note: z.string().max(1000).default(''), checkOutNote: z.string().max(2000).default(''), version,
  }), await jsonBody(c))
  const fx = new Effects()
  const row = await db.transaction((tx) => endRental(tx, id, body, actorOf(u), c.get('ip'), fx))
  await fx.run()
  bumpRev()
  return c.json(toRental(row))
})

billingRoutes.post('/rentals/:id/cancel', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const r = await loadRental(id)
  assertPropertyAccess(u, r.propertyId)
  const body = parse(z.object({ dpAction: z.enum(['forfeit', 'refund']), note: z.string().max(1000).default(''), version }), await jsonBody(c))
  const fx = new Effects()
  const row = await db.transaction((tx) => cancelBooking(tx, id, body, actorOf(u), c.get('ip'), fx))
  await fx.run()
  bumpRev()
  return c.json(toRental(row))
})

billingRoutes.post('/rentals/:id/resolve-dp', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const r = await loadRental(id)
  assertPropertyAccess(u, r.propertyId)
  const body = parse(z.object({ action: z.enum(['forfeit', 'refund']) }), await jsonBody(c))
  await db.transaction((tx) => resolveLapse(tx, id, body.action, actorOf(u), c.get('ip')))
  bumpRev()
  return c.json({ ok: true })
})

/* ================================================================== invoices */

billingRoutes.post('/invoices', async (c) => {
  const u = requireUser(c)
  const body = parse(z.object({
    rentalId: uuid, periodStart: isoDate, periodEnd: isoDate, dueDate: isoDate, items, note: z.string().max(1000).default(''),
  }), await jsonBody(c))
  const r = await loadRental(body.rentalId)
  assertPropertyAccess(u, r.propertyId)
  if (body.periodEnd <= body.periodStart) throw badRequest('Akhir periode harus setelah awal periode.')
  const subtotal = body.items.reduce((a, i) => a + i.amount, 0)
  if (subtotal <= 0) throw badRequest('Total faktur harus lebih dari 0.')

  const row = await db.transaction(async (tx) => {
    const property = await tx.query.properties.findFirst({ where: eq(schema.properties.id, r.propertyId) })
    const [inv] = await tx.insert(schema.invoices).values({
      number: await nextInvoiceNumber(tx, property!, body.periodStart),
      rentalId: r.id, tenantId: r.tenantId, roomId: r.roomId, propertyId: r.propertyId,
      periodStart: body.periodStart, periodEnd: body.periodEnd, dueDate: body.dueDate, items: body.items,
      subtotal, lateFee: 0, total: subtotal, paidAmount: 0, status: 'terjadwal', note: body.note,
    }).returning()
    const fresh = await recomputeInvoice(tx, inv.id)
    await writeAudit(u, c.get('ip'), {
      action: 'invoice.create', entityType: 'invoice', entityId: inv.id, propertyId: r.propertyId,
      summary: `Buat faktur ${inv.number} (${formatIDR(subtotal)})`,
    }, tx)
    return fresh ?? inv
  })
  bumpRev()
  return c.json(toInvoice(row), 201)
})

async function loadInvoice(id: string) {
  const i = await db.query.invoices.findFirst({ where: and(eq(schema.invoices.id, id), isNull(schema.invoices.deletedAt)) })
  if (!i) throw notFound('Faktur')
  return i
}

billingRoutes.patch('/invoices/:id', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const inv = await loadInvoice(id)
  assertPropertyAccess(u, inv.propertyId)
  const raw = await jsonBody(c)
  const body = parse(z.object({ version, dueDate: isoDate.optional(), items: items.optional(), note: z.string().max(1000).optional() }), raw)
  const { version: v, ...patch } = body
  // New amounts need a superadmin's approval; due date and note don't.
  const { row, request } = await saveInvoice(u, c.get('ip'), inv, v, patch, approvalReason(raw))
  if (request) return c.json(pendingResponse(request, toInvoice(row)), 202)
  return c.json(toInvoice(row))
})

billingRoutes.post('/invoices/:id/void', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const inv = await loadInvoice(id)
  assertPropertyAccess(u, inv.propertyId)
  const raw = await jsonBody(c).catch(() => ({}))
  const { row, request } = await voidInvoice(u, c.get('ip'), inv, approvalReason(raw))
  if (request) return c.json(pendingResponse(request, toInvoice(row)), 202)
  return c.json(toInvoice(row))
})

/** Send (or re-send) an invoice to the tenant on WhatsApp: the PDF, with the message as its caption. */
billingRoutes.post('/invoices/:id/send', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const loaded = await loadInvoice(id)
  assertPropertyAccess(u, loaded.propertyId)
  if (loaded.status === 'batal') throw conflict('Faktur ini sudah dibatalkan.')
  // Late fee accrues daily: bring the invoice up to today before it goes out.
  const inv = (await recomputeInvoice(db, id)) ?? loaded
  const [tenant, room, property] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(schema.tenants.id, inv.tenantId) }),
    db.query.rooms.findFirst({ where: eq(schema.rooms.id, inv.roomId) }),
    db.query.properties.findFirst({ where: eq(schema.properties.id, inv.propertyId) }),
  ])
  if (!tenant?.phone || !property) throw badRequest('Penyewa belum memiliki nomor WhatsApp.')
  const body = render(property, 'billing', invoiceVars({ property, tenantName: tenant.name, roomName: room?.name ?? '', invoice: inv }))
  const pdf = await renderInvoicePdf({
    propertyName: property.name, propertyAddress: formatAddress(property.address), tenantName: tenant.name,
    roomName: room?.name ?? '', number: inv.number, periodStart: inv.periodStart, periodEnd: inv.periodEnd, dueDate: inv.dueDate,
    items: inv.items, lateFee: inv.lateFee, total: inv.total, paidAmount: inv.paidAmount,
    paymentInfo: paymentInfoText(property), note: inv.note, issuedOn: appToday(),
  })
  const fx = new Effects()
  const msg = await db.transaction(async (tx) => {
    const file = await storeBuffer(tx, {
      buffer: pdf, mime: 'application/pdf', ext: 'pdf', originalName: `Faktur ${inv.number}.pdf`,
      ownerType: 'invoice', ownerId: inv.id, kind: 'faktur', uploadedBy: u.id,
    })
    return queueWa(tx, {
      propertyId: inv.propertyId, tenantId: tenant.id, phone: tenant.phone, body,
      type: 'document', fileId: file.id, fileName: `Faktur ${inv.number.replace(/\//g, '-')}.pdf`,
      dedupeKey: `invoice:${inv.id}:${Date.now()}`, createdBy: u.id,
    }, fx)
  })
  await fx.run()
  await writeAudit(u, c.get('ip'), { action: 'invoice.send', entityType: 'invoice', entityId: id, propertyId: inv.propertyId, summary: `Kirim faktur ${inv.number} via WhatsApp` })
  return c.json({ queued: Boolean(msg), message: body })
})

billingRoutes.delete('/invoices/:id', async (c) => {
  const u = requireUser(c)
  if (!canDelete(u)) throw forbidden('Staf tidak dapat menghapus data.')
  const id = parse(uuid, c.req.param('id'))
  const inv = await loadInvoice(id)
  assertPropertyAccess(u, inv.propertyId)
  return deleteOrRequest(c, u, 'invoice', id)
})

/* ================================================================== payments */

billingRoutes.post('/payments', async (c) => {
  const u = requireUser(c)
  const body = parse(z.object({
    invoiceId: uuid.nullable().default(null),
    rentalId: uuid.nullable().default(null),
    tenantId: uuid,
    date: isoDate,
    method: z.enum(['cash', 'transfer']),
    amount: money.min(1),
    kind: z.enum(['rent', 'deposit', 'dp', 'other']).default('rent'),
    note: z.string().max(1000).default(''),
    attachment: uuid.nullable().default(null),
    sendReceipt: z.boolean().optional(),
  }), await jsonBody(c))

  let propertyId: string | null = null
  if (body.invoiceId) propertyId = (await loadInvoice(body.invoiceId)).propertyId
  else if (body.rentalId) propertyId = (await loadRental(body.rentalId)).propertyId
  else throw badRequest('Pilih faktur yang dibayar.')
  assertPropertyAccess(u, propertyId)
  if (body.date > appToday()) throw badRequest('Tanggal pembayaran tidak boleh di masa depan.')
  if (body.attachment) {
    // Only a file this tenant sent (WhatsApp) or that was uploaded for them can become the proof.
    const f = await db.query.files.findFirst({ where: eq(schema.files.id, body.attachment) })
    if (!f || f.deletedAt || f.ownerType !== 'tenant' || f.ownerId !== body.tenantId || !['wa_media', 'bukti_bayar'].includes(f.kind)) {
      throw badRequest('Lampiran bukti pembayaran tidak valid.')
    }
  }

  const fx = new Effects()
  const payment = await db.transaction(async (tx) => {
    const p = await recordPayment(tx, {
      invoiceId: body.invoiceId, rentalId: body.rentalId, tenantId: body.tenantId, date: body.date, method: body.method,
      amount: body.amount, kind: body.kind, note: body.note, attachmentFileId: body.attachment,
    }, actorOf(u), c.get('ip'), fx, { sendReceipt: body.sendReceipt })
    if (body.attachment) {
      await tx.update(schema.files).set({ kind: 'bukti_bayar' }).where(eq(schema.files.id, body.attachment))
    }
    return p
  })
  await fx.run()
  bumpRev()
  return c.json(toPayment(payment, new Map([[u.id, u.name]])), 201)
})

billingRoutes.delete('/payments/:id', async (c) => {
  const u = requireUser(c)
  if (!canDelete(u)) throw forbidden('Staf tidak dapat menghapus data.')
  const id = parse(uuid, c.req.param('id'))
  const p = await db.query.payments.findFirst({ where: eq(schema.payments.id, id) })
  if (!p) throw notFound('Pembayaran')
  assertPropertyAccess(u, p.propertyId)
  return deleteOrRequest(c, u, 'payment', id)
})

import { and, eq, inArray, isNull, sql as dsql } from 'drizzle-orm'
import { buildAgreementSnapshot, formatAddress } from '@shared/agreement'
import { formatDate } from '@shared/dates'
import { servicePriceFor } from '@shared/finance'
import { db, schema } from '../db/client'
import { env } from '../env'
import { randomToken, sha256 } from '../lib/crypto'
import { Effects } from '../lib/effects'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors'
import { bumpRev } from '../lib/rev'
import { renderAgreementPdf } from '../pdf/agreement'
import { writeAudit } from './audit'
import { type Actor, appToday, nextContractNumber } from './billing'
import { ingestUpload, loadFile, storeBuffer } from './files'
import { queueWa, render } from './messages'
import { notify } from './notify'

type ContractRow = typeof schema.contracts.$inferSelect

export const signingLink = (token: string) => `${env.PUBLIC_URL.replace(/\/$/, '')}/sign/${token}`

async function ownerSignature(fileId: string | null | undefined) {
  if (!fileId) return null
  try {
    return (await loadFile(fileId)).buffer
  } catch {
    return null
  }
}

async function queueContractMessage(
  contract: ContractRow,
  token: string,
  actorId: string | null,
  fx: Effects,
) {
  const property = await db.query.properties.findFirst({ where: eq(schema.properties.id, contract.propertyId) })
  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, contract.tenantId) })
  if (!property || !tenant) throw notFound('Properti atau penyewa')
  if (!tenant.phone) throw badRequest('Penyewa belum memiliki nomor WhatsApp.')
  const caption = render(property, 'agreement', {
    penyewa: tenant.name,
    properti: property.name,
    kamar: contract.snapshot.roomName,
    link: signingLink(token),
    berlakuSampai: formatDate(contract.tokenExpiresAt?.slice(0, 10), 'long'),
  })
  // One message: the PDF itself with the signing link as its caption.
  return queueWa(db, {
    propertyId: contract.propertyId,
    tenantId: tenant.id,
    phone: tenant.phone,
    type: 'document',
    fileId: contract.pdfFileId,
    fileName: `Perjanjian Sewa & Tata Tertib - ${contract.snapshot.roomName}.pdf`,
    body: caption,
    // A fresh key per send so "kirim ulang" is never swallowed by dedupe.
    dedupeKey: `contract:${contract.id}:${sha256(token).slice(0, 12)}`,
    createdBy: actorId,
  }, fx)
}

/**
 * Create the merged agreement + house rules PDF for a lease and (optionally)
 * send it to the tenant on WhatsApp. Any earlier unsigned contract for the
 * same lease is voided, so only one signing link is ever live.
 */
export async function createContract(rentalId: string, actor: Actor, ip: string | null, opts: { send: boolean }) {
  const fx = new Effects()
  const rental = await db.query.rentals.findFirst({
    where: and(eq(schema.rentals.id, rentalId), isNull(schema.rentals.deletedAt)),
  })
  if (!rental) throw notFound('Sewa')
  if (rental.status !== 'booked' && rental.status !== 'active') {
    throw conflict('Perjanjian hanya dibuat untuk pemesanan atau sewa yang masih berjalan.')
  }
  const [tenant, room, property] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(schema.tenants.id, rental.tenantId) }),
    db.query.rooms.findFirst({ where: eq(schema.rooms.id, rental.roomId) }),
    db.query.properties.findFirst({ where: eq(schema.properties.id, rental.propertyId) }),
  ])
  if (!tenant || !room || !property) throw notFound('Data sewa')
  const services = rental.serviceIds.length
    ? await db.select().from(schema.services).where(inArray(schema.services.id, rental.serviceIds))
    : []

  const today = appToday()
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + Math.max(1, property.agreement.linkExpiryDays) * 86400_000).toISOString()

  const contract = await db.transaction(async (tx) => {
    await tx
      .update(schema.contracts)
      .set({ status: 'void', voidedAt: new Date().toISOString(), tokenHash: null, updatedAt: new Date().toISOString() })
      .where(and(eq(schema.contracts.rentalId, rental.id), inArray(schema.contracts.status, ['draft', 'sent', 'viewed'])))

    const number = await nextContractNumber(tx, property, today)
    const snapshot = buildAgreementSnapshot({
      number,
      date: today,
      property: {
        name: property.name,
        address: formatAddress(property.address),
        paymentMethods: property.paymentMethods,
        paymentInfo: property.paymentInfo,
        lateFee: property.lateFee,
        booking: property.booking,
      },
      agreement: property.agreement,
      rules: property.rules,
      tenant: { name: tenant.name, idNumber: tenant.idNumber, phone: tenant.phone },
      room: { name: room.name },
      rental: {
        startDate: rental.startDate, endDate: rental.endDate, rentType: rental.rentType, price: rental.price,
        billingDay: rental.billingDay, depositAmount: rental.depositAmount, dpAmount: rental.dpAmount,
        paymentDeadline: rental.paymentDeadline,
        services: services.map((s) => ({ name: s.name, amount: servicePriceFor(s, rental.rentType) })),
      },
    })
    const [row] = await tx
      .insert(schema.contracts)
      .values({
        number, rentalId: rental.id, tenantId: tenant.id, propertyId: property.id, status: 'draft',
        tokenHash: sha256(token), tokenExpiresAt: expiresAt, snapshot, createdBy: actor.id,
      })
      .returning()

    const pdf = await renderAgreementPdf(snapshot, { ownerSignature: await ownerSignature(property.agreement.ownerSignatureFileId) })
    const file = await storeBuffer(tx, {
      buffer: pdf, mime: 'application/pdf', ext: 'pdf',
      originalName: `Perjanjian ${number.replace(/\//g, '-')}.pdf`,
      ownerType: 'contract', ownerId: row.id, kind: 'kontrak', uploadedBy: actor.id,
    })
    const [withPdf] = await tx
      .update(schema.contracts)
      .set({ pdfFileId: file.id, docHash: sha256(pdf) })
      .where(eq(schema.contracts.id, row.id))
      .returning()

    await writeAudit(actor, ip, {
      action: 'contract.create', entityType: 'contract', entityId: row.id, propertyId: property.id,
      summary: `Buat perjanjian ${number} untuk ${tenant.name} (${room.name})`,
    }, tx)
    return withPdf
  })

  let queued = false
  if (opts.send) queued = Boolean(await queueContractMessage(contract, token, actor.id, fx))
  await fx.run()
  bumpRev()
  return { contract, link: signingLink(token), queued }
}

/** New link (and fresh expiry) for an unsigned contract, sent again on WhatsApp. */
export async function resendContract(contractId: string, actor: Actor, ip: string | null) {
  const fx = new Effects()
  const contract = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, contractId) })
  if (!contract || contract.deletedAt) throw notFound('Perjanjian')
  if (contract.status === 'void') throw conflict('Perjanjian ini sudah dibatalkan. Buat perjanjian baru.')
  if (contract.status === 'signed') throw conflict('Perjanjian ini sudah ditandatangani.')
  const property = await db.query.properties.findFirst({ where: eq(schema.properties.id, contract.propertyId) })
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + Math.max(1, property?.agreement.linkExpiryDays ?? 7) * 86400_000).toISOString()
  const [updated] = await db
    .update(schema.contracts)
    .set({ tokenHash: sha256(token), tokenExpiresAt: expiresAt, updatedAt: new Date().toISOString() })
    .where(eq(schema.contracts.id, contract.id))
    .returning()
  const queued = Boolean(await queueContractMessage(updated, token, actor.id, fx))
  await writeAudit(actor, ip, {
    action: 'contract.resend', entityType: 'contract', entityId: contract.id, propertyId: contract.propertyId,
    summary: `Kirim ulang perjanjian ${contract.number}`,
  })
  await fx.run()
  bumpRev()
  return { contract: updated, link: signingLink(token), queued }
}

export async function voidContract(contractId: string, actor: Actor, ip: string | null) {
  const [row] = await db
    .update(schema.contracts)
    .set({ status: 'void', voidedAt: new Date().toISOString(), tokenHash: null, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.contracts.id, contractId), inArray(schema.contracts.status, ['draft', 'sent', 'viewed'])))
    .returning()
  if (!row) throw conflict('Perjanjian ini tidak bisa dibatalkan (sudah ditandatangani atau dibatalkan).')
  await writeAudit(actor, ip, {
    action: 'contract.void', entityType: 'contract', entityId: row.id, propertyId: row.propertyId,
    summary: `Batalkan perjanjian ${row.number}`,
  })
  bumpRev()
  return row
}

/* ------------------------------------------------------------------ public signing */

async function byToken(token: string) {
  if (!token || token.length < 20 || token.length > 100) throw notFound('Perjanjian')
  const row = await db.query.contracts.findFirst({ where: eq(schema.contracts.tokenHash, sha256(token)) })
  if (!row || row.deletedAt || row.status === 'void') throw notFound('Perjanjian')
  const expired = row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() < Date.now()
  // A signed copy stays viewable; an unsigned one expires.
  if (expired && row.status !== 'signed') {
    throw new HttpError(410, 'Tautan ini sudah kedaluwarsa. Minta pengelola mengirim ulang perjanjian.', 'expired')
  }
  return row
}

export async function viewContractPublic(token: string, ip: string) {
  const row = await byToken(token)
  if (row.status === 'draft' || row.status === 'sent') {
    await db
      .update(schema.contracts)
      .set({ status: 'viewed', viewedAt: new Date().toISOString() })
      .where(and(eq(schema.contracts.id, row.id), inArray(schema.contracts.status, ['draft', 'sent'])))
    await notify(db, {
      type: 'contract_viewed', severity: 'info',
      title: `Perjanjian dibuka: ${row.snapshot.tenantName}`,
      body: `${row.snapshot.roomName} · ${row.number}`,
      link: `/tenants/${row.tenantId}?tab=contract`, propertyId: row.propertyId,
      dedupeKey: `contract_viewed:${row.id}`, push: false,
    })
    bumpRev()
    void ip
  }
  return {
    number: row.number,
    status: row.status === 'signed' ? 'signed' : 'pending',
    snapshot: row.snapshot,
    signedAt: row.signedAt,
    signedName: row.signedName,
    expiresAt: row.tokenExpiresAt,
  }
}

export async function contractPdfPublic(token: string) {
  const row = await byToken(token)
  const fileId = row.signedPdfFileId ?? row.pdfFileId
  if (!fileId) throw notFound('Dokumen')
  const { buffer } = await loadFile(fileId)
  return { buffer, name: `Perjanjian ${row.number.replace(/\//g, '-')}${row.signedPdfFileId ? ' (ditandatangani)' : ''}.pdf` }
}

export async function signContractPublic(
  token: string,
  input: { name: string; agree: boolean; signature: string },
  meta: { ip: string; userAgent: string },
) {
  const row = await byToken(token)
  if (row.status === 'signed') throw conflict('Perjanjian ini sudah ditandatangani.')
  if (!input.agree) throw badRequest('Centang persetujuan terlebih dahulu.')
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name.length < 3) throw badRequest('Tulis nama lengkap Anda sesuai identitas.')

  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.signature)
  if (!m) throw badRequest('Tanda tangan tidak valid. Silakan gambar ulang.')
  const png = Buffer.from(m[1], 'base64')
  if (png.length < 200 || png.length > 600_000) throw badRequest('Tanda tangan tidak valid. Silakan gambar ulang.')

  const fx = new Effects()
  const signedAt = new Date().toISOString()
  const property = await db.query.properties.findFirst({ where: eq(schema.properties.id, row.propertyId) })

  const updated = await db.transaction(async (tx) => {
    // Lock the row so a double tap can't sign twice.
    const locked = await tx.execute(dsql`select status from contracts where id = ${row.id} for update`)
    if ((locked[0] as { status: string }).status === 'signed') throw conflict('Perjanjian ini sudah ditandatangani.')

    const sig = await ingestUpload(tx, {
      buffer: png, originalName: 'tanda-tangan.png', ownerType: 'contract', ownerId: row.id, kind: 'ttd', uploadedBy: null,
    })
    const pdf = await renderAgreementPdf(row.snapshot, {
      ownerSignature: await ownerSignature(property?.agreement.ownerSignatureFileId),
      tenantSignature: sig.buffer,
      signed: {
        name, signedAt, ip: meta.ip, userAgent: meta.userAgent, docHash: row.docHash ?? '-', timezone: env.APP_TIMEZONE,
      },
    })
    const file = await storeBuffer(tx, {
      buffer: pdf, mime: 'application/pdf', ext: 'pdf',
      originalName: `Perjanjian ${row.number.replace(/\//g, '-')} (ditandatangani).pdf`,
      ownerType: 'contract', ownerId: row.id, kind: 'kontrak', uploadedBy: null,
    })
    const [u] = await tx
      .update(schema.contracts)
      .set({
        status: 'signed', signedAt, signedName: name, signedIp: meta.ip, signedUserAgent: meta.userAgent.slice(0, 400),
        signatureFileId: sig.id, signedPdfFileId: file.id, updatedAt: signedAt,
        // Keep the signed copy viewable from the same link for 90 days.
        tokenExpiresAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
      })
      .where(eq(schema.contracts.id, row.id))
      .returning()

    await notify(tx, {
      type: 'contract_signed', severity: 'success',
      title: `Perjanjian ditandatangani: ${row.snapshot.tenantName}`,
      body: `${row.snapshot.roomName} · ${row.number}`,
      link: `/tenants/${row.tenantId}?tab=contract`, propertyId: row.propertyId,
      dedupeKey: `contract_signed:${row.id}`, push: true,
    }, fx)

    const tenant = await tx.query.tenants.findFirst({ where: eq(schema.tenants.id, row.tenantId) })
    if (property && tenant?.phone) {
      await queueWa(tx, {
        propertyId: row.propertyId, tenantId: row.tenantId, phone: tenant.phone, type: 'document', fileId: file.id,
        fileName: `Perjanjian ${row.number.replace(/\//g, '-')} (ditandatangani).pdf`,
        body: render(property, 'agreementSigned', {
          penyewa: tenant.name, properti: property.name, kamar: row.snapshot.roomName,
        }),
        dedupeKey: `contract_signed:${row.id}`,
      }, fx)
    }
    await writeAudit(null, meta.ip, {
      action: 'contract.sign', entityType: 'contract', entityId: row.id, propertyId: row.propertyId,
      summary: `Perjanjian ${row.number} ditandatangani oleh ${name}`,
      meta: { userAgent: meta.userAgent.slice(0, 200) },
    }, tx)
    return u
  })

  await fx.run()
  bumpRev()
  return { status: 'signed', signedAt: updated.signedAt, signedName: updated.signedName }
}

/** Called by the WhatsApp sender once a contract message actually went out. */
export async function markContractSent(dedupeKey: string | null) {
  if (!dedupeKey?.startsWith('contract:')) return
  const id = dedupeKey.split(':')[1]
  await db
    .update(schema.contracts)
    .set({ status: 'sent', sentAt: new Date().toISOString() })
    .where(and(eq(schema.contracts.id, id), eq(schema.contracts.status, 'draft')))
  bumpRev()
}

import { and, sql as dsql, eq, inArray, isNull, lte } from 'drizzle-orm'
import { addDays } from '@shared/dates'
import { formatPhoneDisplay } from '@shared/phone'
import { db, schema } from '../db/client'
import { env } from '../env'
import { errMeta, log } from '../lib/log'
import { bumpRev } from '../lib/rev'
import { appToday } from '../services/billing'
import { ingestUpload } from '../services/files'
import { notify } from '../services/notify'

export interface IncomingMedia {
  type: 'image' | 'document'
  fileName: string
  /** Declared size in bytes, checked before anything is downloaded. */
  size: number
  download: () => Promise<Buffer>
}

export interface IncomingInput {
  phone: string
  body: string
  waMessageId?: string | null
  media?: IncomingMedia | null
}

/**
 * Store one message a tenant sent to a property's WhatsApp. Photos and PDFs
 * from registered tenants are downloaded into the app (usually transfer
 * proofs) so admins can see them and attach them to a payment without the
 * phone. Attachments from unknown numbers are not downloaded.
 */
export async function recordIncoming(propertyId: string, input: IncomingInput) {
  const dedupeKey = input.waMessageId ? `in:${propertyId}:${input.waMessageId}` : null
  if (dedupeKey) {
    const seen = await db.query.waMessages.findFirst({ where: eq(schema.waMessages.dedupeKey, dedupeKey) })
    if (seen) return null
  }
  const tenant = await tenantByPhone(input.phone, propertyId)

  let body = input.body.trim()
  let fileId: string | null = null
  const media = input.media
  if (media) {
    const label = media.type === 'image' ? '[Gambar]' : `[Dokumen] ${media.fileName}`
    if (!body) body = label
    if (!tenant) {
      body += '\n(lampiran dari nomor yang bukan penyewa tidak disimpan — lihat di HP)'
    } else if (media.size > env.UPLOAD_MAX_MB * 1024 * 1024) {
      body += `\n(lampiran lebih dari ${env.UPLOAD_MAX_MB} MB tidak disimpan — lihat di HP)`
    } else {
      try {
        const stored = await ingestUpload(db, {
          buffer: await media.download(),
          originalName: media.fileName || (media.type === 'image' ? 'kiriman-wa.jpg' : 'kiriman-wa.pdf'),
          ownerType: 'tenant', ownerId: tenant.id, kind: 'wa_media', uploadedBy: null,
        })
        fileId = stored.id
      } catch (e) {
        const unsupported = (e as { code?: string }).code === 'unsupported_type'
        log.warn('Lampiran WhatsApp tidak disimpan', { propertyId, ...errMeta(e) })
        body += unsupported
          ? '\n(format lampiran tidak didukung — hanya foto & PDF yang disimpan; lihat di HP)'
          : '\n(lampiran gagal diunduh — lihat di HP)'
      }
    }
  }
  if (!body) return null

  const [row] = await db
    .insert(schema.waMessages)
    .values({
      propertyId, tenantId: tenant?.id ?? null, phone: input.phone, direction: 'in',
      type: fileId ? media!.type : 'text', fileId, fileName: fileId ? media!.fileName || null : null,
      body: body.slice(0, 4000), status: 'received', waMessageId: input.waMessageId ?? null, dedupeKey,
    })
    .onConflictDoNothing({ target: schema.waMessages.dedupeKey })
    .returning()
  if (!row) return null
  bumpRev()

  const who = tenant?.name ?? formatPhoneDisplay(input.phone)
  const link = `/chat?property=${propertyId}&phone=${input.phone}`
  // A photo/PDF from a tenant who owes money is almost always a transfer proof: make it stand out.
  const owes = fileId && tenant ? await hasOpenInvoice(tenant.id) : false
  await notify(db, owes
    ? {
        type: 'wa_payment_proof', severity: 'warning',
        title: `Kemungkinan bukti bayar dari ${who}`,
        body: 'Periksa mutasi rekening, lalu catat pembayarannya dari percakapan WhatsApp.',
        link, propertyId, push: true,
      }
    : {
        type: 'wa_incoming', severity: 'info', title: `Pesan WhatsApp dari ${who}`,
        body: body.slice(0, 140), link, propertyId, push: true,
      })
  return row
}

/**
 * The same number can belong to several tenant records (someone who moves out
 * and comes back years later). Prefer the one living here now, then anyone
 * with a current lease, then the newest record.
 */
export async function tenantByPhone(phone: string, propertyId: string) {
  const rows = await db.execute<{ id: string }>(dsql`
    select t.id
      from tenants t
      left join rentals r on r.tenant_id = t.id and r.deleted_at is null and r.status in ('booked', 'active')
     where t.phone = ${phone} and t.deleted_at is null
     order by (r.property_id = ${propertyId}) desc nulls last, (r.id is not null) desc, t.created_at desc
     limit 1`)
  const id = rows[0]?.id
  return id ? (await db.query.tenants.findFirst({ where: eq(schema.tenants.id, id) })) ?? null : null
}

async function hasOpenInvoice(tenantId: string) {
  const soon = addDays(appToday(), 10)
  const row = await db.query.invoices.findFirst({
    where: and(
      eq(schema.invoices.tenantId, tenantId), isNull(schema.invoices.deletedAt),
      inArray(schema.invoices.status, ['terjadwal', 'belum_dibayar', 'sebagian']), lte(schema.invoices.dueDate, soon),
    ),
  })
  return Boolean(row)
}

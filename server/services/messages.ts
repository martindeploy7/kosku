import { DEFAULT_WA_TEMPLATES, renderTemplate } from '@shared/constants'
import { formatDate, formatIDR } from '@shared/dates'
import type { MessageTemplate } from '@shared/types'
import { type Executor, schema } from '../db/client'
import type { Effects } from '../lib/effects'
import { events } from '../lib/events'
import { bumpRev } from '../lib/rev'

type PropertyRow = typeof schema.properties.$inferSelect

/** The property's own wording, falling back to the built-in template. */
export function templateBody(property: Pick<PropertyRow, 'templates'>, id: string): string {
  const own = property.templates?.whatsapp?.find((t: MessageTemplate) => t.id === id)
  return (own ?? DEFAULT_WA_TEMPLATES.find((t) => t.id === id))?.body ?? ''
}

export function paymentInfoText(property: Pick<PropertyRow, 'paymentInfo' | 'paymentMethods'>) {
  if (property.paymentInfo.trim()) return property.paymentInfo.trim()
  if (property.paymentMethods.transfer && !property.paymentMethods.cash) return 'Pembayaran melalui transfer bank.'
  if (property.paymentMethods.cash && !property.paymentMethods.transfer) return 'Pembayaran secara tunai ke pengelola.'
  return 'Pembayaran dapat dilakukan tunai atau transfer.'
}

export function invoiceVars(input: {
  property: PropertyRow
  tenantName: string
  roomName: string
  invoice: { number: string; periodStart: string; periodEnd: string; dueDate: string; total: number; paidAmount: number }
}) {
  const { property, invoice } = input
  return {
    penyewa: input.tenantName,
    properti: property.name,
    kamar: input.roomName,
    nomorFaktur: invoice.number,
    periode: `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`,
    jatuhTempo: formatDate(invoice.dueDate, 'long'),
    total: formatIDR(invoice.total),
    sisa: formatIDR(Math.max(0, invoice.total - invoice.paidAmount)),
    infoPembayaran: paymentInfoText(property),
  }
}

export function render(property: PropertyRow, templateId: string, vars: Record<string, string | number | null | undefined>) {
  return renderTemplate(templateBody(property, templateId), vars).trim()
}

export interface QueueWaInput {
  propertyId: string
  tenantId?: string | null
  phone: string
  body: string
  type?: 'text' | 'document'
  fileId?: string | null
  fileName?: string | null
  dedupeKey?: string | null
  createdBy?: string | null
}

/**
 * Put a WhatsApp message in the outbox. It is written in the caller's
 * transaction and picked up by the sender after commit, so messages are never
 * sent for changes that rolled back — and are never lost if WhatsApp is down.
 */
export async function queueWa(exec: Executor, input: QueueWaInput, fx?: Effects) {
  if (!input.phone) return null
  const rows = await exec
    .insert(schema.waMessages)
    .values({
      propertyId: input.propertyId,
      tenantId: input.tenantId ?? null,
      phone: input.phone,
      direction: 'out',
      type: input.type ?? 'text',
      body: input.body,
      fileId: input.fileId ?? null,
      fileName: input.fileName ?? null,
      status: 'queued',
      dedupeKey: input.dedupeKey ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing({ target: schema.waMessages.dedupeKey })
    .returning()
  const row = rows[0] ?? null
  if (row) {
    const wake = () => {
      bumpRev()
      events.emit('wa:outbox', input.propertyId)
    }
    if (fx) fx.push(wake)
    else wake()
  }
  return row
}

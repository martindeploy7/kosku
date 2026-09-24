import PDFDocument from 'pdfkit'
import { formatDate, formatIDR } from '@shared/dates'
import type { InvoiceItem } from '@shared/types'

/* The invoice a tenant receives on WhatsApp. Rendered on the server so the
 * message carries a real PDF, not just text. */

export interface InvoicePdfInput {
  propertyName: string
  propertyAddress: string
  tenantName: string
  roomName: string
  number: string
  periodStart: string
  periodEnd: string
  dueDate: string
  items: InvoiceItem[]
  lateFee: number
  total: number
  paidAmount: number
  paymentInfo: string
  note: string
  issuedOn: string
}

const INK = '#111827'
const MUTED = '#6b7280'
const ACCENT = '#4f46e5'
const LINE = '#e5e7eb'

export function renderInvoicePdf(inv: InvoicePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: { Title: `Faktur ${inv.number}`, Author: inv.propertyName, Subject: `Faktur sewa ${inv.roomName} — ${inv.tenantName}` },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right
  const remaining = Math.max(0, inv.total - inv.paidAmount)
  const paid = remaining === 0

  /* ---------- header ---------- */
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('FAKTUR SEWA', left, 56, { width: width / 2 })
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(inv.number, left, doc.y + 2, { width: width / 2 })
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(inv.propertyName, left + width / 2, 56, { width: width / 2, align: 'right' })
  if (inv.propertyAddress) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(inv.propertyAddress, left + width / 2, doc.y + 2, { width: width / 2, align: 'right' })
  }
  const headerBottom = Math.max(doc.y, 100) + 14
  doc.moveTo(left, headerBottom).lineTo(left + width, headerBottom).lineWidth(1).strokeColor(LINE).stroke()

  /* ---------- details ---------- */
  let y = headerBottom + 18
  const pairs: [string, string][] = [
    ['Ditagihkan kepada', inv.tenantName],
    ['Kamar', inv.roomName],
    ['Periode', `${formatDate(inv.periodStart, 'long')} – ${formatDate(inv.periodEnd, 'long')}`],
    ['Tanggal faktur', formatDate(inv.issuedOn, 'long')],
    ['Jatuh tempo', formatDate(inv.dueDate, 'long')],
  ]
  for (const [k, v] of pairs) {
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(k, left, y, { width: 130 })
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(v, left + 140, y, { width: width - 140 })
    y = doc.y + 6
  }

  // Status stamp
  const stamp = paid ? 'LUNAS' : inv.paidAmount > 0 ? 'DIBAYAR SEBAGIAN' : 'BELUM DIBAYAR'
  const stampColor = paid ? '#059669' : inv.paidAmount > 0 ? '#2563eb' : '#dc2626'
  doc.font('Helvetica-Bold').fontSize(10)
  const sw = doc.widthOfString(stamp) + 20
  doc.roundedRect(left + width - sw, headerBottom + 16, sw, 22, 4).lineWidth(1.2).strokeColor(stampColor).stroke()
  doc.fillColor(stampColor).text(stamp, left + width - sw, headerBottom + 22, { width: sw, align: 'center' })

  /* ---------- items ---------- */
  y += 14
  doc.rect(left, y, width, 24).fillColor(ACCENT).fill()
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#ffffff')
    .text('Deskripsi', left + 10, y + 7, { width: width - 150 })
    .text('Jumlah', left + width - 140, y + 7, { width: 130, align: 'right' })
  y += 24
  const row = (label: string, amount: string, opts: { bold?: boolean; color?: string; shade?: boolean } = {}) => {
    const h = Math.max(22, doc.font('Helvetica').fontSize(9.5).heightOfString(label, { width: width - 160 }) + 12)
    if (opts.shade) doc.rect(left, y, width, h).fillColor('#f8fafc').fill()
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(opts.color ?? INK)
      .text(label, left + 10, y + 6, { width: width - 160 })
      .text(amount, left + width - 140, y + 6, { width: 130, align: 'right' })
    y += h
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(LINE).stroke()
  }
  for (const it of inv.items) row(it.name, formatIDR(it.amount))
  if (inv.lateFee > 0) row('Denda keterlambatan', formatIDR(inv.lateFee), { color: '#dc2626' })
  row('Total', formatIDR(inv.total), { bold: true, shade: true })
  if (inv.paidAmount > 0) row('Sudah dibayar', `- ${formatIDR(inv.paidAmount)}`, { shade: true })
  row('Sisa tagihan', formatIDR(remaining), { bold: true, shade: true, color: remaining > 0 ? '#dc2626' : '#059669' })

  /* ---------- how to pay ---------- */
  y += 20
  if (!paid && inv.paymentInfo.trim()) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Cara pembayaran', left, y, { width })
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(inv.paymentInfo.trim(), left, doc.y + 4, { width, lineGap: 2 })
    y = doc.y + 14
  }
  if (inv.note.trim()) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Catatan', left, y, { width })
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(inv.note.trim(), left, doc.y + 4, { width })
    y = doc.y + 14
  }
  if (!paid) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text('Setelah membayar, kirim foto bukti transfer ke nomor WhatsApp ini. Terima kasih.', left, y, { width })
  }

  // Footer sits inside the bottom margin; lift the margin so pdfkit doesn't start a new page.
  doc.page.margins.bottom = 0
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
    .text(`${inv.propertyName} · ${inv.number}`, left, doc.page.height - 40, { width, align: 'center', lineBreak: false })

  doc.end()
  return done
}

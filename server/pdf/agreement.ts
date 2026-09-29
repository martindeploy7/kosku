import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import type { AgreementSnapshot } from '@shared/agreement'
import { formatDate } from '@shared/dates'
import { formatPhoneDisplay } from '@shared/phone'

/* One PDF: the rental agreement, the house rules as an attachment, the
 * signature block and — once signed — an electronic-signature certificate. */

export interface SignedInfo {
  name: string
  signedAt: string
  ip: string
  userAgent: string
  docHash: string
  timezone: string
}

export interface RenderOptions {
  /** Letterhead logo, shown at the top of every page instead of the plain property name. */
  logo?: Buffer | null
  ownerSignature?: Buffer | null
  tenantSignature?: Buffer | null
  signed?: SignedInfo | null
}

const INK = '#111827'
const MUTED = '#6b7280'
const ACCENT = '#4f46e5'

type AgreementBrand = 'default' | 'lasta' | 'lamira'

const letterheadDir = path.resolve(process.cwd(), 'server/pdf/assets/letterhead')
const asset = (name: string) => {
  const file = path.join(letterheadDir, name)
  return existsSync(file) ? readFileSync(file) : null
}

const letterheadAssets = {
  lastaLogo: asset('lasta-logo.png'),
  lastaAddress: asset('lasta-address.png'),
  lamiraLogo: asset('lamira-logo.png'),
  lamiraDecoration: asset('lamira-decoration.png'),
}

function brandFor(s: AgreementSnapshot): AgreementBrand {
  const key = `${s.propertyCode ?? ''} ${s.propertyName}`.toLowerCase()
  if (key.includes('lasta') || /\bdrn\b/.test(key)) return 'lasta'
  if (key.includes('lamira') || /\bwat\b/.test(key)) return 'lamira'
  return 'default'
}

function formatInstant(isoTs: string, tz: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(isoTs))
}

export function renderAgreementPdf(s: AgreementSnapshot, opts: RenderOptions = {}): Promise<Buffer> {
  const brand = brandFor(s)
  const doc = new PDFDocument({
    size: 'A4',
    margins: brand === 'default'
      ? { top: 64, bottom: 64, left: 60, right: 60 }
      : { top: brand === 'lasta' ? 112 : 128, bottom: 92, left: 60, right: 60 },
    bufferPages: true,
    info: {
      Title: `Perjanjian Sewa & Tata Tertib ${s.number}`,
      Author: s.propertyName,
      Subject: `Perjanjian sewa ${s.roomName} — ${s.tenantName}`,
    },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const left = doc.page.margins.left

  const ensureSpace = (h: number) => {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage()
  }

  /* ---------- letterhead (header, repeats on every page) ----------
   * With a logo: the logo alone carries the header, like the source
   * kop surat (logo in the header, full contact block in the footer).
   * Without one: fall back to the plain property name + address. */
  let logoDrawn = false
  const letterhead = () => {
    if (brand === 'lasta') {
      if (letterheadAssets.lastaLogo) {
        doc.image(letterheadAssets.lastaLogo, left + width - 180, 12, { fit: [180, 96] })
      } else {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#978dbb').text('Lasta residence', left + width - 180, 42, { width: 180, align: 'right' })
      }
      logoDrawn = true
      doc.y = 112
      doc.x = left
      return
    }

    if (brand === 'lamira') {
      if (letterheadAssets.lamiraLogo) {
        doc.image(letterheadAssets.lamiraLogo, left + width / 2 - 145, 18, { fit: [290, 82] })
      } else {
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#7c3f12').text('Rumah LAMIRA', left, 48, { width, align: 'center' })
      }
      logoDrawn = true
      doc.y = 126
      doc.x = left
      return
    }

    const top = doc.page.margins.top - 30
    if (opts.logo) {
      try {
        doc.image(opts.logo, left, top, { fit: [180, 42] })
        doc.y = top + 42 + 4
        doc.x = left
        logoDrawn = true
      } catch {
        doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(s.propertyName, left, top, { width })
      }
    } else {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(s.propertyName, left, top, { width })
    }
    if (!logoDrawn) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(s.propertyAddress || '', left, doc.y, { width })
    const y = doc.y + 6
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(ACCENT).stroke()
    doc.y = y + 18
  }
  letterhead()

  /* ---------- agreement body ---------- */
  let summaryDrawn = false
  const drawSummary = () => {
    if (summaryDrawn || !s.summary.length) return
    summaryDrawn = true
    ensureSpace(24 + s.summary.length * 16)
    const top = doc.y + 4
    const rowH = 16
    const h = 14 + s.summary.length * rowH
    doc.roundedRect(left, top, width, h, 6).fillColor('#f5f5ff').fill()
    let y = top + 8
    for (const row of s.summary) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(row.label, left + 12, y, { width: 130 })
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(row.value, left + 150, y, { width: width - 162 })
      y += rowH
    }
    doc.y = top + h + 14
    doc.x = left
  }

  for (const b of s.blocks) {
    switch (b.type) {
      case 'title':
        ensureSpace(40)
        doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(b.text.toUpperCase(), left, doc.y, { width, align: 'center' })
        doc.moveDown(0.3)
        break
      case 'heading':
        drawSummary()
        ensureSpace(40)
        doc.moveDown(0.5)
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(b.text, left, doc.y, { width })
        doc.moveDown(0.25)
        break
      case 'para':
        ensureSpace(24)
        // A lone "Nomor: …" line under the title is centred like a document number.
        if (!summaryDrawn && /^nomor\s*:/i.test(b.text)) {
          doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(b.text, left, doc.y, { width, align: 'center' })
          doc.moveDown(0.8)
        } else {
          doc.font('Helvetica').fontSize(10).fillColor(INK).text(b.text, left, doc.y, { width, align: 'justify', lineGap: 2 })
          doc.moveDown(0.5)
        }
        break
      case 'list':
        b.items.forEach((item, i) => {
          ensureSpace(22)
          const marker = b.ordered ? `${i + 1}.` : '•'
          const y = doc.y
          doc.font('Helvetica').fontSize(10).fillColor(INK).text(marker, left + 4, y, { width: 18 })
          doc.text(item, left + 24, y, { width: width - 24, align: 'justify', lineGap: 2 })
          doc.moveDown(0.25)
        })
        doc.moveDown(0.3)
        break
    }
  }
  drawSummary()

  /* ---------- attachment: house rules ---------- */
  doc.addPage()
  letterhead()
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('LAMPIRAN — TATA TERTIB', left, doc.y, { width, align: 'center' })
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`${s.propertyName} · Bagian tidak terpisahkan dari Perjanjian ${s.number}`, { width, align: 'center' })
  doc.moveDown(1)

  if (!s.rules.length) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('Belum ada tata tertib khusus yang ditetapkan.', { width })
  }
  let n = 1
  for (const section of s.rules) {
    ensureSpace(40)
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(section.label, left, doc.y, { width })
    doc.moveDown(0.25)
    for (const item of section.items) {
      ensureSpace(20)
      const y = doc.y
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${n}.`, left + 4, y, { width: 22 })
      doc.text(item, left + 28, y, { width: width - 28, lineGap: 2 })
      doc.moveDown(0.2)
      n++
    }
    doc.moveDown(0.5)
  }

  /* ---------- acknowledgement + signatures ---------- */
  ensureSpace(230)
  doc.moveDown(0.6)
  doc.roundedRect(left, doc.y, width, 44, 6).fillColor('#fffbeb').fill()
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(
    'Dengan menandatangani dokumen ini, PIHAK KEDUA menyatakan telah membaca, memahami, dan menyetujui Perjanjian Sewa beserta Tata Tertib di atas.',
    left + 12, doc.y + 9, { width: width - 24 },
  )
  doc.y += 30
  doc.moveDown(1.2)

  const colW = (width - 40) / 2
  const sigTop = doc.y
  const col = (x: number, role: string, name: string, title: string, image: Buffer | null | undefined, dateText: string, awaiting: boolean) => {
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(role, x, sigTop, { width: colW, align: 'center' })
    const imgTop = sigTop + 18
    if (image) {
      try {
        doc.image(image, x + colW / 2 - 80, imgTop, { fit: [160, 70], align: 'center', valign: 'center' })
      } catch {
        /* an unreadable image must not break the whole document */
      }
    } else if (awaiting) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text('(menunggu tanda tangan elektronik)', x, imgTop + 30, { width: colW, align: 'center' })
    }
    const lineY = imgTop + 78
    doc.moveTo(x + 20, lineY).lineTo(x + colW - 20, lineY).lineWidth(0.8).strokeColor(INK).stroke()
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(name, x, lineY + 6, { width: colW, align: 'center' })
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(title, x, doc.y + 1, { width: colW, align: 'center' })
    if (dateText) doc.text(dateText, x, doc.y + 1, { width: colW, align: 'center' })
  }
  col(left, 'PIHAK PERTAMA', s.ownerName, s.ownerTitle, opts.ownerSignature, formatDate(s.date, 'long'), false)
  col(
    left + colW + 40, 'PIHAK KEDUA', s.tenantName, 'Penyewa', opts.tenantSignature,
    opts.signed ? formatInstant(opts.signed.signedAt, opts.signed.timezone) : '',
    !opts.tenantSignature,
  )

  /* ---------- e-signature certificate ---------- */
  if (opts.signed) {
    const sg = opts.signed
    doc.addPage()
    letterhead()
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('SERTIFIKAT TANDA TANGAN ELEKTRONIK', left, doc.y, { width, align: 'center' })
    doc.moveDown(1)
    const rows: [string, string][] = [
      ['Nomor dokumen', s.number],
      ['Dokumen', `Perjanjian Sewa & Tata Tertib — ${s.roomName}, ${s.propertyName}`],
      ['Penandatangan', sg.name],
      ['Nomor WhatsApp tujuan', formatPhoneDisplay(s.tenantPhone)],
      ['Waktu tanda tangan', formatInstant(sg.signedAt, sg.timezone)],
      ['Alamat IP', sg.ip],
      ['Perangkat', sg.userAgent.slice(0, 160)],
      ['Metode', 'Tanda tangan elektronik melalui tautan unik yang dikirim ke nomor WhatsApp penyewa.'],
      ['SHA-256 dokumen asli', sg.docHash],
    ]
    for (const [k, v] of rows) {
      ensureSpace(30)
      const y = doc.y
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, left, y, { width: 150 })
      doc.font(k.startsWith('SHA') ? 'Courier' : 'Helvetica').fontSize(9).fillColor(INK).text(v, left + 160, y, { width: width - 160 })
      doc.moveDown(0.6)
    }
    doc.moveDown(1)
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
      'Hash SHA-256 di atas adalah sidik jari dokumen sebelum ditandatangani. Perubahan sekecil apa pun pada isi dokumen asli akan menghasilkan hash yang berbeda.',
      left, doc.y, { width },
    )
  }

  /* ---------- footer on every page (contact line + page number) ----------
   * A logo header has no text, so the address moves down here with phone/email
   * (mirroring the source kop surat). Without a logo, address already sits in
   * the header, so this line only adds phone/email when set. */
  const contactLine = [
    logoDrawn && s.propertyAddress,
    s.propertyPhone && `Telp: ${formatPhoneDisplay(s.propertyPhone)}`,
    s.propertyEmail && `Email: ${s.propertyEmail}`,
  ].filter(Boolean).join(' · ')
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const pageHeight = doc.page.height
    const y = pageHeight - 40
    const saved = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    if (brand === 'lasta') {
      if (letterheadAssets.lastaAddress) {
        doc.image(letterheadAssets.lastaAddress, left, pageHeight - 82, { fit: [width, 42] })
      } else {
        doc.moveTo(left, pageHeight - 82).lineTo(left + width, pageHeight - 82).lineWidth(1).strokeColor('#978dbb').stroke()
        doc.font('Helvetica').fontSize(8).fillColor('#978dbb').text(s.propertyAddress || '', left, pageHeight - 68, { width })
      }
      doc.font('Helvetica').fontSize(7.5).fillColor('#978dbb')
        .text(`${s.number} · Halaman ${i + 1} dari ${range.count}`, left, y, { width, align: 'right', lineBreak: false })
    } else if (brand === 'lamira') {
      if (letterheadAssets.lamiraDecoration) {
        doc.save()
        doc.opacity(0.16)
        doc.image(letterheadAssets.lamiraDecoration, left - 8, pageHeight - 82, { fit: [92, 74] })
        doc.restore()
      }
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#6b3510')
        .text('Address: Jl. Widya Chandra X No. 2A, Jakarta Selatan  |  Phone: 021-5274862  |  Email: rumah_lamira@yahoo.com', left + 20, pageHeight - 61, { width: width - 20, align: 'center', lineBreak: false })
      doc.font('Helvetica').fontSize(7).fillColor('#8b735f')
        .text(`${s.number} · Halaman ${i + 1} dari ${range.count}`, left, y, { width, align: 'right', lineBreak: false })
    } else {
      if (contactLine) {
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(contactLine, left, y - 12, { width, align: 'center', lineBreak: false })
      }
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`${s.number} · Halaman ${i + 1} dari ${range.count}`, left, y, { width, align: 'right', lineBreak: false })
      doc.text(s.propertyName, left, y, { width, align: 'left', lineBreak: false })
    }
    doc.page.margins.bottom = saved
  }

  doc.end()
  return done
}

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { formatDate, formatIDR } from './utils'

export interface ExportColumn<T> {
  header: string
  accessor: (row: T) => string | number
  align?: 'left' | 'right' | 'center'
}

export interface ExportMeta {
  title: string
  subtitle?: string
  company?: string
  period?: string
  filename: string
}

export function exportToExcel<T>(rows: T[], columns: ExportColumn<T>[], meta: ExportMeta) {
  const header = columns.map((c) => c.header)
  const body = rows.map((r) => columns.map((c) => c.accessor(r)))

  const aoa: (string | number)[][] = [
    [meta.title],
    ...(meta.company ? [[`Perusahaan: ${meta.company}`]] : []),
    ...(meta.period ? [[`Periode: ${meta.period}`]] : []),
    [],
    header,
    ...body,
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(14, c.header.length + 4) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, meta.title.slice(0, 28) || 'Laporan')
  XLSX.writeFile(wb, `${meta.filename}.xlsx`)
}

export function exportToPDF<T>(rows: T[], columns: ExportColumn<T>[], meta: ExportMeta) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(meta.title, pageWidth / 2, 46, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  let y = 66
  if (meta.company) {
    doc.text(`Perusahaan: ${meta.company}`, pageWidth / 2, y, { align: 'center' })
    y += 16
  }
  if (meta.period) {
    doc.text(`Periode: ${meta.period}`, pageWidth / 2, y, { align: 'center' })
    y += 16
  }

  autoTable(doc, {
    startY: y + 8,
    head: [columns.map((c) => c.header)],
    // Printed numbers get thousand separators (29.250.000); Excel keeps raw numbers for formulas.
    body: rows.map((r) => columns.map((c) => {
      const v = c.accessor(r)
      return typeof v === 'number' ? v.toLocaleString('id-ID') : String(v)
    })),
    styles: { fontSize: 8, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: columns.reduce<Record<number, { halign: 'left' | 'right' | 'center' }>>(
      (acc, c, i) => {
        if (c.align) acc[i] = { halign: c.align }
        return acc
      },
      {},
    ),
    didDrawPage: () => {
      const str = `Dicetak ${formatDate(new Date().toISOString().slice(0, 10), 'long')} • Kosku`
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text(str, pageWidth / 2, doc.internal.pageSize.getHeight() - 20, { align: 'center' })
      doc.setTextColor(0)
    },
  })

  doc.save(`${meta.filename}.pdf`)
}

/** Simple invoice PDF honouring the property's PDF customisation settings. */
export function exportInvoicePDF(opts: {
  invoiceNumber: string
  propertyName: string
  propertyAddress: string
  tenantName: string
  roomName: string
  periodLabel: string
  dueDate: string
  items: { name: string; amount: number }[]
  total: number
  paid: number
  note?: string
  textColor?: string
  labelColor?: string
  fontSize?: number
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const text = hexToRgb(opts.textColor ?? '#111827')
  const label = hexToRgb(opts.labelColor ?? '#6b7280')
  const fs = opts.fontSize ?? 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(text.r, text.g, text.b)
  doc.text('FAKTUR SEWA', 48, 60)

  doc.setFontSize(fs)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(label.r, label.g, label.b)
  doc.text(opts.propertyName, W - 48, 50, { align: 'right' })
  doc.text(doc.splitTextToSize(opts.propertyAddress, 220), W - 48, 50 + fs + 4, { align: 'right' })

  doc.setDrawColor(226, 232, 240)
  doc.line(48, 92, W - 48, 92)

  const pairs: [string, string][] = [
    ['No. Faktur', opts.invoiceNumber],
    ['Penyewa', opts.tenantName],
    ['Kamar', opts.roomName],
    ['Periode', opts.periodLabel],
    ['Jatuh Tempo', opts.dueDate],
  ]
  let y = 120
  pairs.forEach(([k, v]) => {
    doc.setTextColor(label.r, label.g, label.b)
    doc.text(k, 48, y)
    doc.setTextColor(text.r, text.g, text.b)
    doc.text(v, 160, y)
    y += fs + 8
  })

  autoTable(doc, {
    startY: y + 12,
    head: [['Deskripsi', 'Jumlah']],
    body: opts.items.map((i) => [i.name, formatIDR(i.amount)]),
    foot: [
      ['Total', formatIDR(opts.total)],
      ['Dibayar', formatIDR(opts.paid)],
      ['Sisa', formatIDR(Math.max(0, opts.total - opts.paid))],
    ],
    styles: { fontSize: fs, cellPadding: 8 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255 },
    footStyles: { fillColor: [248, 250, 252], textColor: [17, 24, 39], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 48, right: 48 },
  })

  if (opts.note) {
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    doc.setTextColor(label.r, label.g, label.b)
    doc.setFontSize(fs - 1)
    doc.text(doc.splitTextToSize(opts.note, W - 96), 48, finalY + 28)
  }

  doc.save(`${opts.invoiceNumber}.pdf`)
}

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 17, g: 24, b: 39 }
}

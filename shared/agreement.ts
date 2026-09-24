import { RULE_GROUPS, rentTypeLabel, rentTypeUnit, renderTemplate } from './constants'
import { formatDate, formatIDR } from './dates'
import { formatPhoneDisplay } from './phone'
import type { AgreementSettings, BookingPolicy, HouseRules, LateFee, RentType } from './types'

/* The rental agreement and the house rules are merged into ONE document.
 *
 * `buildAgreementSnapshot` freezes everything the tenant will read. The PDF
 * renderer (server) and the signing page (web) both render from the snapshot,
 * so the text the tenant signs is exactly the text in the PDF — and editing
 * the property's template later never rewrites a contract already sent. */

export type AgreementBlock =
  | { type: 'title'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'para'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }

export interface RuleSection {
  label: string
  items: string[]
}

export interface AgreementSnapshot {
  number: string
  date: string
  propertyName: string
  propertyAddress: string
  roomName: string
  tenantName: string
  tenantIdNumber: string
  tenantPhone: string
  ownerName: string
  ownerTitle: string
  blocks: AgreementBlock[]
  rules: RuleSection[]
  summary: { label: string; value: string }[]
}

export interface AgreementContext {
  number: string
  date: string
  property: {
    name: string
    address: string
    paymentMethods: { cash: boolean; transfer: boolean }
    paymentInfo: string
    lateFee: LateFee
    booking: BookingPolicy
  }
  agreement: Pick<AgreementSettings, 'template' | 'ownerName' | 'ownerTitle'>
  rules: HouseRules
  tenant: { name: string; idNumber: string; phone: string }
  room: { name: string }
  rental: {
    startDate: string
    endDate: string | null
    rentType: RentType
    price: number
    billingDay: number
    depositAmount: number
    dpAmount: number
    paymentDeadline: string | null
    services: { name: string; amount: number }[]
  }
}

export function agreementVariables(ctx: AgreementContext): Record<string, string> {
  const { property: p, rental: r } = ctx
  const unit = rentTypeUnit(r.rentType)

  const methods = [p.paymentMethods.transfer && 'transfer bank', p.paymentMethods.cash && 'tunai']
    .filter(Boolean)
    .join(' atau ') || 'cara yang disepakati para pihak'

  const lf = p.lateFee
  const denda = lf.enabled && lf.value > 0
    ? `Keterlambatan pembayaran dikenakan denda ${lf.type === 'fixed' ? formatIDR(lf.value) : `${lf.value}% dari nilai tagihan`}${lf.frequency === 'daily' ? ' per hari' : ''}${lf.graceDays > 0 ? `, setelah masa tenggang ${lf.graceDays} hari` : ''}.`
    : 'Keterlambatan pembayaran tidak dikenakan denda, namun PIHAK KEDUA wajib segera melunasi tagihan.'

  const dp = r.dpAmount > 0
    ? `Uang muka sebesar ${formatIDR(r.dpAmount)} diperhitungkan sebagai bagian dari pembayaran sewa pertama. Sisa pembayaran wajib dilunasi paling lambat ${formatDate(r.paymentDeadline ?? r.startDate, 'long')}. Apabila tidak dilunasi sampai batas waktu tersebut, pemesanan batal dengan sendirinya dan uang muka ${p.booking.lapsePolicy === 'forfeit' ? 'menjadi hak PIHAK PERTAMA (hangus)' : 'diselesaikan sesuai kesepakatan para pihak'}.`
    : 'Tidak ada uang muka dalam perjanjian ini.'

  const deposit = r.depositAmount > 0
    ? `Uang jaminan sebesar ${formatIDR(r.depositAmount)} dikembalikan saat sewa berakhir, setelah dikurangi biaya kerusakan dan/atau tunggakan (jika ada).`
    : 'Tidak ada uang jaminan dalam perjanjian ini.'

  const services = r.services.filter((s) => s.amount > 0)
  const layanan = services.length
    ? `, ditambah layanan ${services.map((s) => `${s.name} (${formatIDR(s.amount)})`).join(', ')}`
    : ''

  return {
    nomorPerjanjian: ctx.number,
    tanggalPerjanjian: formatDate(ctx.date, 'long'),
    pemilik: ctx.agreement.ownerName || `Pengelola ${p.name}`,
    jabatanPemilik: ctx.agreement.ownerTitle || 'Pemilik',
    properti: p.name,
    alamatProperti: p.address || '-',
    penyewa: ctx.tenant.name,
    nomorIdentitas: ctx.tenant.idNumber || '-',
    teleponPenyewa: formatPhoneDisplay(ctx.tenant.phone),
    kamar: ctx.room.name,
    tanggalMulai: formatDate(r.startDate, 'long'),
    klausulBerakhir: r.endDate
      ? `sampai dengan ${formatDate(r.endDate, 'long')}`
      : 'dan berlaku sampai diakhiri oleh salah satu pihak sesuai Pasal 6',
    periodeSewa: rentTypeLabel(r.rentType).toLowerCase(),
    harga: formatIDR(r.price),
    satuanPeriode: unit,
    klausulLayanan: layanan,
    tanggalTagihan: String(r.billingDay),
    metodePembayaran: methods,
    klausulDenda: denda,
    klausulDp: dp,
    klausulDeposit: deposit,
  }
}

/** Parse the template's tiny line format into blocks. */
export function parseAgreement(text: string): AgreementBlock[] {
  const blocks: AgreementBlock[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'para', text: para.join(' ') })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      flushPara()
      flushList()
      continue
    }
    const ordered = /^\d+[.)]\s+/.exec(line)
    const bullet = /^[-*•]\s+/.exec(line)
    if (line.startsWith('## ')) {
      flushPara(); flushList()
      blocks.push({ type: 'heading', text: line.slice(3).trim() })
    } else if (line.startsWith('# ')) {
      flushPara(); flushList()
      blocks.push({ type: 'title', text: line.slice(2).trim() })
    } else if (ordered || bullet) {
      flushPara()
      const isOrdered = Boolean(ordered)
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(line.slice((ordered ?? bullet)![0].length))
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return blocks
}

export function ruleSections(rules: HouseRules): RuleSection[] {
  const sections = RULE_GROUPS
    .map((g) => ({ label: g.label, items: rules.groups[g.key] ?? [] }))
    .filter((s) => s.items.length > 0)
  const custom = rules.custom.map((c) => c.trim()).filter(Boolean)
  if (custom.length) sections.push({ label: 'Ketentuan tambahan', items: custom })
  return sections
}

export function buildAgreementSnapshot(ctx: AgreementContext): AgreementSnapshot {
  const vars = agreementVariables(ctx)
  const r = ctx.rental
  return {
    number: ctx.number,
    date: ctx.date,
    propertyName: ctx.property.name,
    propertyAddress: ctx.property.address,
    roomName: ctx.room.name,
    tenantName: ctx.tenant.name,
    tenantIdNumber: ctx.tenant.idNumber,
    tenantPhone: ctx.tenant.phone,
    ownerName: vars.pemilik,
    ownerTitle: vars.jabatanPemilik,
    blocks: parseAgreement(renderTemplate(ctx.agreement.template, vars)),
    rules: ruleSections(ctx.rules),
    summary: [
      { label: 'Kamar', value: `${ctx.room.name} · ${ctx.property.name}` },
      { label: 'Mulai sewa', value: formatDate(r.startDate, 'long') },
      { label: 'Berakhir', value: r.endDate ? formatDate(r.endDate, 'long') : 'Tidak ditentukan' },
      { label: 'Harga sewa', value: `${formatIDR(r.price)} / ${rentTypeUnit(r.rentType)}` },
      ...(r.dpAmount > 0 ? [{ label: 'Uang muka', value: formatIDR(r.dpAmount) }] : []),
      ...(r.depositAmount > 0 ? [{ label: 'Uang jaminan', value: formatIDR(r.depositAmount) }] : []),
      ...(r.paymentDeadline && r.dpAmount > 0
        ? [{ label: 'Batas pelunasan', value: formatDate(r.paymentDeadline, 'long') }]
        : []),
    ],
  }
}

export function formatAddress(a: {
  street?: string; subdistrict?: string; district?: string; city?: string; province?: string; postcode?: string
}) {
  return [
    a.street,
    a.subdistrict && `Kel. ${a.subdistrict}`,
    a.district && `Kec. ${a.district}`,
    a.city,
    [a.province, a.postcode].filter(Boolean).join(' '),
  ]
    .filter((x) => x && String(x).trim())
    .join(', ')
}

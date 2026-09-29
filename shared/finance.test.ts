import { describe, expect, it } from 'vitest'
import { buildAgreementSnapshot, parseAgreement } from './agreement'
import { DEFAULT_AGREEMENT_TEMPLATE, DEFAULT_HOUSE_RULES, defaultBookingPolicy } from './constants'
import { addMonths, daysBetween, todayInTz } from './dates'
import {
  amountDueOn, buildTakeaways, calcLateFee, calcProration, deriveRoomStatus, nextDueOfRental, planFirstInvoice,
  planRecurringInvoices, settleInvoice,
} from './finance'
import { normalizePhone, phoneFromJid, samePhone } from './phone'
import type { Contract, Invoice, LateFee, Rental, Room } from './types'

const fee: LateFee = { enabled: true, type: 'fixed', value: 25_000, graceDays: 3, frequency: 'once' }

const rental = (over: Partial<Rental> = {}): Rental => ({
  id: 'r1', tenantId: 't1', roomId: 'room1', propertyId: 'p1', startDate: '2026-09-10', endDate: null,
  rentType: 'monthly', price: 1_500_000, billingDay: 10, deposit: { amount: 0, paid: false },
  downPayment: { amount: 0, paid: false }, serviceIds: [], status: 'active', paymentDeadline: null,
  lapseResolution: null, createdAt: '2026-09-01T00:00:00Z', version: 1, ...over,
})

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1', number: 'X-1', rentalId: 'r1', tenantId: 't1', roomId: 'room1', propertyId: 'p1',
  periodStart: '2026-09-10', periodEnd: '2026-10-10', dueDate: '2026-09-10', sentDate: null, items: [],
  subtotal: 1_500_000, lateFee: 0, total: 1_500_000, paidAmount: 0, status: 'belum_dibayar', isFirst: false,
  createdAt: '', version: 1, ...over,
})

describe('dates', () => {
  it('counts days across DST-free calendar correctly', () => {
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2)
    expect(daysBetween('2026-03-01', '2026-02-27')).toBe(-2)
  })
  it('clamps month-end when adding months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
  it('computes today in Jakarta, not UTC', () => {
    // 2026-09-23 20:30 UTC is already the 24th in Jakarta (UTC+7).
    expect(todayInTz('Asia/Jakarta', new Date('2026-09-23T20:30:00Z'))).toBe('2026-09-24')
  })
})

describe('proration', () => {
  it('pro-rates the first month up to the billing day', () => {
    const p = calcProration('2026-09-26', 1, 1_350_000, 'monthly')
    expect(p.periodEnd).toBe('2026-10-01')
    expect(p.days).toBe(5)
    expect(p.amount).toBe(225_000)
    expect(p.isProrated).toBe(true)
  })
  it('charges a full month when billing on the move-in day', () => {
    const p = calcProration('2026-09-26', 26, 1_350_000, 'monthly')
    expect(p.periodEnd).toBe('2026-10-26')
    expect(p.amount).toBe(1_350_000)
    expect(p.isProrated).toBe(false)
  })
})

describe('recurring invoices', () => {
  it('plans every missed period up to the horizon (catch-up after downtime)', () => {
    const plans = planRecurringInvoices(rental(), '2026-10-10', '2027-01-15', 'Kamar 1', [])
    expect(plans.map((p) => p.periodStart)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10'])
    expect(plans.every((p) => p.subtotal === 1_500_000)).toBe(true)
  })
  it('pro-rates the last period of a fixed-term lease', () => {
    const plans = planRecurringInvoices(rental({ endDate: '2026-10-25' }), '2026-10-10', '2026-12-31', 'Kamar 1', [])
    expect(plans).toHaveLength(1)
    expect(plans[0].periodEnd).toBe('2026-10-25')
    expect(plans[0].subtotal).toBe(Math.round((1_500_000 / 31) * 15))
  })
  it('makes a DP booking fall due on its payment deadline', () => {
    const p = planFirstInvoice(rental({ status: 'booked', paymentDeadline: '2026-09-12' }), 'Kamar 1', [])
    expect(p.dueDate).toBe('2026-09-12')
  })
})

describe('late fees', () => {
  it('respects the grace period', () => {
    expect(calcLateFee(1_500_000, '2026-09-10', fee, '2026-09-13')).toBe(0)
    expect(calcLateFee(1_500_000, '2026-09-10', fee, '2026-09-14')).toBe(25_000)
  })
  it('does not fine a payment made on time but recorded late', () => {
    const s = settleInvoice(invoice(), [{ date: '2026-09-10', amount: 1_500_000 }], 'active', fee, '2026-10-01')
    expect(s).toMatchObject({ lateFee: 0, total: 1_500_000, status: 'lunas' })
  })
  it('keeps the fee on an invoice settled after the grace period', () => {
    const s = settleInvoice(invoice(), [{ date: '2026-09-20', amount: 1_525_000 }], 'active', fee, '2026-10-01')
    expect(s).toMatchObject({ lateFee: 25_000, total: 1_525_000, status: 'lunas' })
  })
  it('is partially paid when the late payment misses the fee', () => {
    const s = settleInvoice(invoice(), [{ date: '2026-09-20', amount: 1_500_000 }], 'active', fee, '2026-10-01')
    expect(s).toMatchObject({ lateFee: 25_000, status: 'sebagian' })
  })
  it('never fines a DP booking', () => {
    const s = settleInvoice(invoice(), [], 'booked', fee, '2026-10-01')
    expect(s.lateFee).toBe(0)
  })
  it('quotes the amount due for a chosen payment date', () => {
    expect(amountDueOn(invoice(), [], 'active', fee, '2026-09-11')).toBe(1_500_000)
    expect(amountDueOn(invoice(), [], 'active', fee, '2026-09-30')).toBe(1_525_000)
  })
})

describe('room status: DP, full payment, failed payment', () => {
  const today = '2026-09-15'
  const room: Room = {
    id: 'room1', propertyId: 'p1', name: 'Kamar 1', price: { daily: 0, weekly: 0, monthly: 1, yearly: 0 },
    schemes: { daily: false, weekly: false, monthly: true, yearly: false }, condition: 'bersih', note: '', createdAt: '', version: 1,
  }
  it('holds the room while a DP booking is open', () => {
    const r = rental({ status: 'booked', paymentDeadline: '2026-09-17' })
    expect(deriveRoomStatus('room1', [r], [], today)).toBe('dipesan_dp')
  })
  it('is occupied and paid once the first invoice is settled', () => {
    const r = rental({ status: 'active', startDate: '2026-09-10' })
    expect(deriveRoomStatus('room1', [r], [invoice({ status: 'lunas', paidAmount: 1_500_000 })], today)).toBe('disewa')
  })
  it('flags arrears on an occupied room', () => {
    const r = rental({ status: 'active', startDate: '2026-09-10' })
    expect(deriveRoomStatus('room1', [r], [invoice()], today)).toBe('menunggak')
  })
  it('is available again after a booking lapses', () => {
    const r = rental({ status: 'lapsed', paymentDeadline: '2026-09-12' })
    expect(deriveRoomStatus('room1', [r], [], today)).toBe('tersedia')
  })
  it('reports the next due date per room', () => {
    const r = rental({ status: 'active' })
    expect(nextDueOfRental(r, [invoice()])).toMatchObject({ date: '2026-09-10', kind: 'invoice' })
    expect(nextDueOfRental(r, [invoice({ status: 'lunas', paidAmount: 1_500_000 })])).toMatchObject({ date: '2026-10-10', kind: 'scheduled' })
  })
  it('builds the "hari ini" takeaways', () => {
    const t = buildTakeaways({
      rentals: [rental(), rental({ id: 'r2', roomId: 'room2', status: 'booked', paymentDeadline: today })],
      invoices: [invoice({ dueDate: today }), invoice({ id: 'i0', dueDate: '2026-09-01' })],
      rooms: [room, { ...room, id: 'room2' }, { ...room, id: 'room3' }],
      contracts: [{ id: 'c1', propertyId: 'p1', status: 'sent' } as Contract],
      today,
    })
    expect(t.dueToday).toHaveLength(1)
    expect(t.overdue).toHaveLength(1)
    expect(t.dpDeadlines[0]).toMatchObject({ rentalId: 'r2', daysLate: 0 })
    expect(t.unsignedContracts).toHaveLength(1)
    expect(t.vacantRoomIds).toEqual(['room3'])
  })
})

describe('WhatsApp number matching', () => {
  it('treats 0812…, +62 812… and 62812… as the same line', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890')
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890')
    expect(samePhone('081234567890', '6281234567890')).toBe(true)
  })
  it('drops the local trunk 0 typed after the country code', () => {
    // The phone field prefixes +62; people still type their number as 0812…
    expect(normalizePhone('+62081234567890')).toBe('6281234567890')
    expect(normalizePhone('62081234567890')).toBe('6281234567890')
    expect(samePhone('+62 0812 3456 7890', '081234567890')).toBe(true)
  })
  it('rejects a different number', () => {
    expect(samePhone('081234567890', '081234567891')).toBe(false)
  })
  it('reads the phone out of a multi-device JID', () => {
    expect(phoneFromJid('6281234567890:14@s.whatsapp.net')).toBe('6281234567890')
  })
})

describe('agreement + house rules', () => {
  it('parses the template into titled, numbered sections', () => {
    const blocks = parseAgreement('# JUDUL\n\n## Pasal 1\n1. satu\n2. dua\n\nParagraf.')
    expect(blocks.map((b) => b.type)).toEqual(['title', 'heading', 'list', 'para'])
  })
  it('merges agreement and rules into one snapshot with DP and deposit clauses', () => {
    const s = buildAgreementSnapshot({
      number: 'PSK/MLT/2609/001', date: '2026-09-24',
      property: {
        name: 'Kost Melati', address: 'Bandung', phone: '6281200000000', paymentMethods: { cash: true, transfer: true }, paymentInfo: '',
        lateFee: fee, booking: defaultBookingPolicy(),
      },
      agreement: { template: DEFAULT_AGREEMENT_TEMPLATE, ownerName: 'Bu Sri', ownerTitle: 'Pemilik', contactEmail: '' },
      rules: DEFAULT_HOUSE_RULES(),
      tenant: { name: 'Budi', idNumber: '3273', phone: '6281234567890' },
      room: { name: 'Kamar 1' },
      rental: {
        startDate: '2026-10-01', endDate: null, rentType: 'monthly', price: 1_500_000, billingDay: 1,
        depositAmount: 1_500_000, dpAmount: 500_000, paymentDeadline: '2026-09-27', services: [],
      },
    })
    const text = JSON.stringify(s.blocks)
    expect(text).not.toMatch(/\{\{/) // every placeholder filled
    expect(text).toContain('Rp 500.000')
    expect(text).toContain('hangus')
    expect(s.rules.length).toBeGreaterThan(0)
    expect(s.summary.find((x) => x.label === 'Batas pelunasan')?.value).toBe('27 September 2026')
  })
})

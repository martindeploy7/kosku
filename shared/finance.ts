import { RENT_TYPES } from './constants'
import { addDays, daysBetween, daysInMonth, parseISO, toISO } from './dates'
import type {
  Contract, Invoice, InvoiceItem, InvoiceStatus, LateFee, Payment, Rental, RentType, Room,
  RoomStatus, Service, Tenant, TenantStatus,
} from './types'

/* ================================================================== *
 * Billing periods
 * ================================================================== */

export interface ProrationResult {
  amount: number
  days: number
  cycleDays: number
  periodStart: string
  periodEnd: string
  isProrated: boolean
}

/** Next billing cut-off strictly after `from`, on `billingDay` (clamped to month length). */
export function nextBillingDate(from: string, billingDay: number): string {
  const d = parseISO(from)
  const y = d.getFullYear()
  const m = d.getMonth()
  const clamp = (year: number, monthIdx: number) => Math.min(billingDay, daysInMonth(year, monthIdx))

  const thisMonth = new Date(y, m, clamp(y, m))
  if (thisMonth.getTime() > d.getTime()) return toISO(thisMonth)

  const nm = m + 1
  const ny = y + Math.floor(nm / 12)
  const nmi = nm % 12
  return toISO(new Date(ny, nmi, clamp(ny, nmi)))
}

/** The first period of a lease. Monthly leases are pro-rated up to the first billing day. */
export function calcProration(
  startDate: string,
  billingDay: number,
  price: number,
  rentType: RentType,
): ProrationResult {
  if (rentType !== 'monthly') {
    const end = periodAfter(startDate, rentType, billingDay)
    const days = daysBetween(startDate, end)
    return { amount: price, days, cycleDays: days, periodStart: startDate, periodEnd: end, isProrated: false }
  }

  const periodEnd = nextBillingDate(startDate, billingDay)
  const days = daysBetween(startDate, periodEnd)
  const d = parseISO(startDate)
  const cycleDays = daysInMonth(d.getFullYear(), d.getMonth())
  const full = days >= cycleDays

  return {
    amount: full ? price : Math.round((price / cycleDays) * days),
    days,
    cycleDays,
    periodStart: startDate,
    periodEnd,
    isProrated: !full && days > 0,
  }
}

/** End (exclusive) of the period that starts on `start`. */
export function periodAfter(start: string, rentType: RentType, billingDay: number) {
  switch (rentType) {
    case 'daily':
      return addDays(start, 1)
    case 'weekly':
      return addDays(start, 7)
    case 'yearly': {
      const d = parseISO(start)
      return toISO(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()))
    }
    case 'monthly':
    case 'custom':
    default:
      return nextBillingDate(start, billingDay)
  }
}

export function makeInvoiceNumber(propertyCode: string, seq: number, date: string) {
  const d = parseISO(date)
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${propertyCode}-${yy}${mm}-${String(seq).padStart(4, '0')}`
}

export function servicePriceFor(service: Service, rentType: RentType) {
  const key = rentType === 'custom' ? 'monthly' : rentType
  return service.price[key] ?? 0
}

export interface PlannedInvoice {
  periodStart: string
  periodEnd: string
  dueDate: string
  items: InvoiceItem[]
  subtotal: number
  isFirst: boolean
}

/**
 * The first invoice of a lease. For a DP booking it falls due on the payment
 * deadline — that is the date the room is held until.
 */
export function planFirstInvoice(
  rental: Pick<Rental, 'startDate' | 'endDate' | 'billingDay' | 'price' | 'rentType' | 'status' | 'paymentDeadline'>,
  roomName: string,
  services: Service[],
): PlannedInvoice {
  const pro = calcProration(rental.startDate, rental.billingDay, rental.price, rental.rentType)
  let periodEnd = pro.periodEnd
  let amount = pro.amount
  let days = pro.days
  let prorated = pro.isProrated

  // A lease shorter than its first period is billed only for the days it covers.
  if (rental.endDate && rental.endDate < periodEnd) {
    days = daysBetween(rental.startDate, rental.endDate)
    amount = Math.round((rental.price / Math.max(1, pro.cycleDays)) * days)
    periodEnd = rental.endDate
    prorated = true
  }

  const ratio = pro.cycleDays > 0 ? days / pro.cycleDays : 1
  const items: InvoiceItem[] = [
    {
      name: prorated ? `Sewa ${roomName} (prorata ${days} hari)` : `Sewa ${roomName}`,
      amount,
    },
    ...services.map((s) => {
      const full = servicePriceFor(s, rental.rentType)
      return { name: prorated ? `${s.name} (prorata)` : s.name, amount: prorated ? Math.round(full * ratio) : full }
    }),
  ].filter((i) => i.amount > 0 || i.name.startsWith('Sewa'))

  const dueDate = rental.status === 'booked' && rental.paymentDeadline ? rental.paymentDeadline : rental.startDate
  return {
    periodStart: rental.startDate,
    periodEnd,
    dueDate,
    items,
    subtotal: items.reduce((a, i) => a + i.amount, 0),
    isFirst: true,
  }
}

/**
 * Every recurring invoice that should exist by `horizon` (inclusive) after the
 * periods already billed. Pure and idempotent: the caller inserts with
 * ON CONFLICT DO NOTHING on (rental_id, period_start), so a server that was
 * down for a week simply catches up on its next run.
 */
export function planRecurringInvoices(
  rental: Pick<Rental, 'startDate' | 'endDate' | 'billingDay' | 'price' | 'rentType'>,
  lastPeriodEnd: string,
  horizon: string,
  roomName: string,
  services: Service[],
  maxPeriods = 60,
): PlannedInvoice[] {
  const out: PlannedInvoice[] = []
  let start = lastPeriodEnd
  for (let i = 0; i < maxPeriods; i++) {
    if (start > horizon) break
    if (rental.endDate && start >= rental.endDate) break

    let end = periodAfter(start, rental.rentType, rental.billingDay)
    let amount = rental.price
    let prorated = false
    const fullDays = daysBetween(start, end)
    let days = fullDays

    if (rental.endDate && end > rental.endDate) {
      days = daysBetween(start, rental.endDate)
      amount = Math.round((rental.price / Math.max(1, fullDays)) * days)
      end = rental.endDate
      prorated = true
    }

    const ratio = fullDays > 0 ? days / fullDays : 1
    const items: InvoiceItem[] = [
      { name: prorated ? `Sewa ${roomName} (prorata ${days} hari)` : `Sewa ${roomName}`, amount },
      ...services.map((s) => {
        const full = servicePriceFor(s, rental.rentType)
        return { name: prorated ? `${s.name} (prorata)` : s.name, amount: prorated ? Math.round(full * ratio) : full }
      }).filter((it) => it.amount > 0),
    ]
    out.push({
      periodStart: start,
      periodEnd: end,
      dueDate: start,
      items,
      subtotal: items.reduce((a, it) => a + it.amount, 0),
      isFirst: false,
    })
    start = end
  }
  return out
}

/* ================================================================== *
 * Invoice status, late fees
 * ================================================================== */

export function calcLateFee(subtotal: number, dueDate: string, lateFee: LateFee, asOf: string): number {
  if (!lateFee.enabled || lateFee.value <= 0) return 0
  const overdueDays = daysBetween(dueDate, asOf) - lateFee.graceDays
  if (overdueDays <= 0) return 0
  const base = lateFee.type === 'fixed' ? lateFee.value : Math.round((subtotal * lateFee.value) / 100)
  return lateFee.frequency === 'once' ? base : base * overdueDays
}

export interface PaidLine {
  date: string
  amount: number
}

/**
 * Late fee, total and status of an invoice from its payments.
 *
 * The fee is assessed on the date the invoice was actually settled, not on the
 * day someone got round to recording it: a tenant who transferred on the due
 * date and was entered into the system three days later owes no fine. Unpaid
 * invoices accrue as of `asOf`. DP bookings are never fined — missing the
 * deadline releases the room instead.
 */
export function settleInvoice(
  inv: { subtotal: number; dueDate: string; status?: InvoiceStatus },
  payments: PaidLine[],
  rentalStatus: Rental['status'],
  lateFeeCfg: LateFee,
  asOf: string,
): { paidAmount: number; lateFee: number; total: number; status: InvoiceStatus } {
  const paid = payments.reduce((a, p) => a + p.amount, 0)
  const fined = rentalStatus !== 'booked'
  const feeOn = (date: string) => (fined ? calcLateFee(inv.subtotal, inv.dueDate, lateFeeCfg, date) : 0)

  let settledOn: string | null = null
  let cum = 0
  for (const p of [...payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    cum += p.amount
    if (cum >= inv.subtotal + feeOn(p.date)) {
      settledOn = p.date
      break
    }
  }
  const lateFee = feeOn(settledOn ?? asOf)
  const total = inv.subtotal + lateFee
  if (inv.status === 'batal') return { paidAmount: paid, lateFee, total, status: 'batal' }
  return { paidAmount: paid, lateFee, total, status: invoiceStatus({ total, dueDate: inv.dueDate }, paid, asOf) }
}

/** What still has to be paid if the tenant pays on `date` (fee assessed on that date). */
export function amountDueOn(
  inv: { subtotal: number; dueDate: string },
  payments: PaidLine[],
  rentalStatus: Rental['status'],
  lateFeeCfg: LateFee,
  date: string,
) {
  const before = payments.filter((p) => p.date <= date).reduce((a, p) => a + p.amount, 0)
  const after = payments.filter((p) => p.date > date).reduce((a, p) => a + p.amount, 0)
  const fee = rentalStatus === 'booked' ? 0 : calcLateFee(inv.subtotal, inv.dueDate, lateFeeCfg, date)
  return Math.max(0, inv.subtotal + fee - before - after)
}

export function invoiceStatus(
  inv: { total: number; dueDate: string; status?: InvoiceStatus },
  paid: number,
  today: string,
): InvoiceStatus {
  if (inv.status === 'batal') return 'batal'
  if (paid >= inv.total) return 'lunas'
  if (paid > 0) return 'sebagian'
  return inv.dueDate <= today ? 'belum_dibayar' : 'terjadwal'
}

/** Money received against an invoice (refunds and reversals are not linked to invoices). */
export function paidAmount(invoiceId: string, payments: Payment[]) {
  return payments.filter((p) => p.invoiceId === invoiceId).reduce((a, p) => a + p.amount, 0)
}

export function outstanding(invoice: Pick<Invoice, 'total' | 'paidAmount' | 'status'>, _payments?: unknown) {
  if (invoice.status === 'batal') return 0
  return Math.max(0, invoice.total - invoice.paidAmount)
}

export function isOverdue(invoice: Pick<Invoice, 'dueDate' | 'total' | 'paidAmount' | 'status'>, today: string) {
  return invoice.dueDate < today && outstanding(invoice) > 0
}

/** Average settlement time in days (last payment vs due date). Negative = early. */
export function averageSettlementDays(invoices: Invoice[], payments: Payment[]) {
  const settled = invoices
    .filter((inv) => inv.status === 'lunas')
    .map((inv) => {
      const pays = payments.filter((p) => p.invoiceId === inv.id && p.amount > 0)
      if (!pays.length) return null
      const last = pays.map((p) => p.date).sort().at(-1)!
      return daysBetween(inv.dueDate, last)
    })
    .filter((v): v is number => v !== null)
  if (!settled.length) return null
  return Math.round(settled.reduce((a, b) => a + b, 0) / settled.length)
}

export function settlementLabel(days: number | null) {
  if (days === null) return 'Belum ada data'
  if (days <= 0) return 'Tepat Waktu'
  return `Terlambat ${days} hari`
}

/* ================================================================== *
 * Rentals, rooms, tenants — status derivation
 * ================================================================== */

/** A lease that currently holds the room: paid-up, or held by a DP. */
export const isCurrentRental = (r: Pick<Rental, 'status'>) => r.status === 'active' || r.status === 'booked'

export function rentalInvoices(rentalId: string, invoices: Invoice[]) {
  return invoices.filter((i) => i.rentalId === rentalId && i.status !== 'batal')
}

export function hasOverdueInvoice(rentalId: string, invoices: Invoice[], today: string) {
  return rentalInvoices(rentalId, invoices).some((i) => isOverdue(i, today))
}

/** The rental that defines a room's status today, if any. */
export function currentRentalOfRoom(roomId: string, rentals: Rental[], today: string) {
  const current = rentals.filter((r) => r.roomId === roomId && isCurrentRental(r))
  return (
    current.find((r) => r.status === 'active' && r.startDate <= today && (!r.endDate || r.endDate > today)) ??
    current.find((r) => r.status === 'booked') ??
    current.filter((r) => r.status === 'active' && r.startDate > today).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0] ??
    null
  )
}

export function deriveRoomStatus(roomId: string, rentals: Rental[], invoices: Invoice[], today: string): RoomStatus {
  const r = currentRentalOfRoom(roomId, rentals, today)
  if (!r) return 'tersedia'
  if (r.status === 'booked') return 'dipesan_dp'
  if (r.startDate > today) return 'dipesan'
  if (hasOverdueInvoice(r.id, invoices, today)) return 'menunggak'
  if (r.endDate && daysBetween(today, r.endDate) <= 30) return 'akan_tersedia'
  return 'disewa'
}

/** Rooms that count as occupied for occupancy figures. */
export const isOccupiedStatus = (s: RoomStatus) => s === 'disewa' || s === 'menunggak' || s === 'akan_tersedia'

export function deriveTenantStatus(tenantId: string, rentals: Rental[], today: string): TenantStatus {
  const mine = rentals.filter((r) => r.tenantId === tenantId)
  const current = mine.find(isCurrentRental)
  if (current) {
    if (current.status === 'booked' || current.startDate > today) return 'dipesan'
    if (current.endDate && daysBetween(today, current.endDate) <= 30) return 'akan_berakhir'
    return 'berjalan'
  }
  const latest = [...mine].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
  if (!latest) return 'belum_sewa'
  if (latest.status === 'lapsed') return 'gagal_bayar'
  if (latest.status === 'canceled') return 'belum_sewa'
  return 'berakhir'
}

export function getActiveRental(tenantId: string, rentals: Rental[]) {
  return rentals.find((r) => r.tenantId === tenantId && isCurrentRental(r)) ?? null
}

export interface NextDue {
  date: string
  amount: number
  invoiceId: string | null
  /** invoice: an issued unpaid invoice · scheduled: next period not yet invoiced · deadline: DP balance */
  kind: 'invoice' | 'scheduled' | 'deadline'
}

/** The next date money is owed on a rental — what "jatuh tempo" means for a room. */
export function nextDueOfRental(rental: Rental, invoices: Invoice[]): NextDue | null {
  const mine = rentalInvoices(rental.id, invoices)
  const unpaid = mine.filter((i) => outstanding(i) > 0).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0]

  if (rental.status === 'booked') {
    const first = mine.find((i) => i.isFirst)
    return {
      date: rental.paymentDeadline ?? first?.dueDate ?? rental.startDate,
      amount: first ? outstanding(first) : rental.price,
      invoiceId: first?.id ?? null,
      kind: 'deadline',
    }
  }
  if (unpaid) return { date: unpaid.dueDate, amount: outstanding(unpaid), invoiceId: unpaid.id, kind: 'invoice' }

  if (rental.status !== 'active') return null
  const lastEnd = mine.map((i) => i.periodEnd).sort().at(-1) ?? rental.startDate
  if (rental.endDate && lastEnd >= rental.endDate) return null
  return { date: lastEnd, amount: rental.price, invoiceId: null, kind: 'scheduled' }
}

/* ================================================================== *
 * "Hari ini" — what admins need to act on today
 * ================================================================== */

export interface DueItem {
  rentalId: string
  tenantId: string
  roomId: string
  propertyId: string
  invoiceId: string | null
  dueDate: string
  amount: number
  /** Negative = days until due; positive = days late. */
  daysLate: number
}

export interface Takeaways {
  dueToday: DueItem[]
  overdue: DueItem[]
  upcoming: DueItem[]
  dpDeadlines: DueItem[]
  lapsedPending: Rental[]
  unsignedContracts: Contract[]
  endingSoon: Rental[]
  vacantRoomIds: string[]
  totals: { dueToday: number; overdue: number; upcoming: number }
}

export function buildTakeaways(input: {
  rentals: Rental[]
  invoices: Invoice[]
  rooms: Room[]
  contracts: Contract[]
  today: string
  upcomingDays?: number
  propertyId?: string | null
}): Takeaways {
  const { today, upcomingDays = 7 } = input
  const match = (pid: string) => !input.propertyId || pid === input.propertyId
  const rentals = input.rentals.filter((r) => match(r.propertyId))
  const rentalById = new Map(rentals.map((r) => [r.id, r]))

  const dueToday: DueItem[] = []
  const overdue: DueItem[] = []
  const upcoming: DueItem[] = []

  for (const inv of input.invoices) {
    const rental = rentalById.get(inv.rentalId)
    // Booked rentals are tracked by their DP deadline instead.
    if (!rental || rental.status !== 'active') continue
    const amount = outstanding(inv)
    if (amount <= 0) continue
    const item: DueItem = {
      rentalId: rental.id, tenantId: inv.tenantId, roomId: inv.roomId, propertyId: inv.propertyId,
      invoiceId: inv.id, dueDate: inv.dueDate, amount, daysLate: daysBetween(inv.dueDate, today),
    }
    if (inv.dueDate === today) dueToday.push(item)
    else if (inv.dueDate < today) overdue.push(item)
    else if (daysBetween(today, inv.dueDate) <= upcomingDays) upcoming.push(item)
  }

  const dpDeadlines: DueItem[] = rentals
    .filter((r) => r.status === 'booked')
    .map((r) => {
      const nd = nextDueOfRental(r, input.invoices)!
      return {
        rentalId: r.id, tenantId: r.tenantId, roomId: r.roomId, propertyId: r.propertyId,
        invoiceId: nd.invoiceId, dueDate: nd.date, amount: nd.amount, daysLate: daysBetween(nd.date, today),
      }
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))

  const occupiedRoomIds = new Set(
    rentals.filter((r) => isCurrentRental(r) && (!r.endDate || r.endDate > today)).map((r) => r.roomId),
  )
  const vacantRoomIds = input.rooms.filter((r) => match(r.propertyId) && !occupiedRoomIds.has(r.id)).map((r) => r.id)

  const byDate = (a: DueItem, b: DueItem) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)
  const total = (xs: DueItem[]) => xs.reduce((a, x) => a + x.amount, 0)

  return {
    dueToday: dueToday.sort(byDate),
    overdue: overdue.sort(byDate),
    upcoming: upcoming.sort(byDate),
    dpDeadlines,
    lapsedPending: rentals.filter((r) => r.status === 'lapsed' && r.lapseResolution === 'pending'),
    unsignedContracts: input.contracts.filter(
      (c) => match(c.propertyId) && (c.status === 'draft' || c.status === 'sent' || c.status === 'viewed'),
    ),
    endingSoon: rentals.filter(
      (r) => r.status === 'active' && r.endDate && r.endDate >= today && daysBetween(today, r.endDate) <= upcomingDays,
    ),
    vacantRoomIds,
    totals: { dueToday: total(dueToday), overdue: total(overdue), upcoming: total(upcoming) },
  }
}

/* ================================================================== *
 * Accounting — ledger entries derived from payments / expenses
 * ================================================================== */

export type AccountCategory =
  | 'Pendapatan Bisnis'
  | 'Uang Jaminan'
  | 'Uang Muka'
  | 'Pendapatan Lainnya'
  | 'Pengembalian Uang Jaminan'
  | 'Pengembalian DP'
  | string

export interface LedgerEntry {
  id: string
  date: string
  description: string
  propertyId: string
  propertyName: string
  roomName: string
  tenantName: string
  category: AccountCategory
  debit: number // money out
  credit: number // money in
  section: 'aset' | 'liabilitas' | 'ekuitas'
  kind: 'income' | 'expense'
}

export function categoryOfPayment(p: Pick<Payment, 'kind' | 'amount' | 'category'>): AccountCategory {
  if (p.category) return p.category
  if (p.kind === 'deposit') return p.amount < 0 ? 'Pengembalian Uang Jaminan' : 'Uang Jaminan'
  if (p.kind === 'dp') return p.amount < 0 ? 'Pengembalian DP' : 'Uang Muka'
  if (p.kind === 'other') return 'Pendapatan Lainnya'
  return 'Pendapatan Bisnis'
}

/** Deposits and DPs are refundable liabilities; rent is income (equity). */
export function sectionOfCategory(cat: AccountCategory): LedgerEntry['section'] {
  if (cat === 'Uang Jaminan' || cat === 'Pengembalian Uang Jaminan') return 'liabilitas'
  if (cat === 'Uang Muka' || cat === 'Pengembalian DP') return 'liabilitas'
  if (cat === 'Pendapatan Bisnis' || cat === 'Pendapatan Lainnya' || cat === 'DP Hangus' || cat === 'Konversi Uang Jaminan')
    return 'ekuitas'
  return 'aset'
}

export function periodRange(period: string, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const to = toISO(now)
  switch (period) {
    case 'today':
      return { from: to, to }
    case 'week':
      return { from: addDays(to, -6), to }
    case 'month':
      return { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) }
    case 'last-month':
      return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m, 0)) }
    case 'quarter':
      return { from: toISO(new Date(y, m - 2, 1)), to }
    case 'year':
      return { from: toISO(new Date(y, 0, 1)), to: toISO(new Date(y, 11, 31)) }
    case 'all':
    default:
      return { from: '1970-01-01', to: '2999-12-31' }
  }
}

export function inRange(date: string, from: string, to: string) {
  const d = date.slice(0, 10)
  return d >= from && d <= to
}

export { RENT_TYPES }
export type { Tenant }

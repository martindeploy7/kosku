import { useMemo } from 'react'
import { EXPENSE_CATEGORIES } from './constants'
import {
  averageSettlementDays, categoryOfPayment, inRange, outstanding, paidAmount, sectionOfCategory,
  type LedgerEntry,
} from './finance'
import { getActiveRental, getRoomStatus, getTenantStatus, useStore } from './store'
import { isCurrentRental, isOccupiedStatus } from './finance'
import type { Invoice, Payment } from './types'
import { addMonths, monthLabel, parseISO, sum } from './utils'

/** Everything the dashboard and reports need, memoised in one place. */
export function useDerived() {
  const properties = useStore((s) => s.properties)
  const rooms = useStore((s) => s.rooms)
  const tenants = useStore((s) => s.tenants)
  const rentals = useStore((s) => s.rentals)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const expenses = useStore((s) => s.expenses)
  const services = useStore((s) => s.services)
  const today = useStore((s) => s.today)

  return useMemo(() => {
    const activeRentals = rentals.filter(isCurrentRental)
    const activeTenantIds = new Set(activeRentals.map((r) => r.tenantId))
    const activeTenants = tenants.filter((t) => activeTenantIds.has(t.id))
    const waitlist = tenants.filter((t) => t.isWaitlist)

    const occupiedRooms = rooms.filter((r) => isOccupiedStatus(getRoomStatus(r.id, rentals, invoices, today)))
    const occupancyRate = rooms.length ? Math.round((occupiedRooms.length / rooms.length) * 100) : 0

    /* ---- money ---- */
    const rentPayments = payments.filter((p) => p.kind === 'rent')
    const depositPayments = payments.filter((p) => p.kind === 'deposit')
    const dpPayments = payments.filter((p) => p.kind === 'dp')

    const totalIncome = sum(rentPayments, (p) => p.amount)
    const totalDeposit = sum(depositPayments, (p) => p.amount)
    const totalExpense = sum(expenses, (e) => e.total)

    const unpaidInvoices = invoices.filter((i) => outstanding(i) > 0 && i.dueDate <= today)
    const totalOutstanding = sum(unpaidInvoices, (i) => outstanding(i))

    /* ---- this month ---- */
    const monthStart = today.slice(0, 7) + '-01'
    const monthInvoices = invoices.filter((i) => i.status !== 'batal' && i.periodStart.slice(0, 7) === today.slice(0, 7))
    const monthPaidCount = monthInvoices.filter((i) => outstanding(i) <= 0).length
    const monthIncome = sum(
      rentPayments.filter((p) => p.date.slice(0, 7) === today.slice(0, 7)),
      (p) => p.amount,
    )
    const monthExpense = sum(
      expenses.filter((e) => e.date.slice(0, 7) === today.slice(0, 7)),
      (e) => e.total,
    )
    const lastMonthKey = addMonths(monthStart, -1).slice(0, 7)
    const lastMonthIncome = sum(rentPayments.filter((p) => p.date.slice(0, 7) === lastMonthKey), (p) => p.amount)
    const lastMonthExpense = sum(expenses.filter((e) => e.date.slice(0, 7) === lastMonthKey), (e) => e.total)

    /* ---- 12-month series ---- */
    const months = Array.from({ length: 12 }, (_, i) => {
      const iso = addMonths(monthStart, -(11 - i))
      const key = iso.slice(0, 7)
      const d = parseISO(iso)
      return {
        key,
        label: monthLabel(d.getMonth(), d.getFullYear()),
        shortLabel: monthLabel(d.getMonth(), d.getFullYear()).split(' ')[0],
        income: sum(rentPayments.filter((p) => p.date.slice(0, 7) === key), (p) => p.amount),
        deposit: sum(depositPayments.filter((p) => p.date.slice(0, 7) === key && p.amount > 0), (p) => p.amount),
        depositReturn: Math.abs(sum(depositPayments.filter((p) => p.date.slice(0, 7) === key && p.amount < 0), (p) => p.amount)),
        expense: sum(expenses.filter((e) => e.date.slice(0, 7) === key), (e) => e.total),
        invoiceTotal: sum(invoices.filter((i) => i.status !== 'batal' && i.periodStart.slice(0, 7) === key), (i) => i.total),
        invoicePaid: sum(
          invoices.filter((i) => i.status !== 'batal' && i.periodStart.slice(0, 7) === key),
          (i) => Math.min(i.total, i.paidAmount),
        ),
      }
    })

    const profitMonths = months.slice(-4).map((m) => ({
      ...m,
      profit: m.income - m.expense,
    }))

    /* ---- settlement ---- */
    const avgSettlement = averageSettlementDays(invoices, payments)

    const avgDailyRate = activeRentals.length
      ? Math.round(sum(activeRentals, (r) => r.price) / activeRentals.length / 30)
      : 0

    return {
      today,
      activeRentals, activeTenants, waitlist,
      occupiedRooms, occupancyRate,
      totalIncome, totalDeposit, totalExpense, totalOutstanding,
      unpaidInvoices,
      monthInvoices, monthPaidCount, monthIncome, monthExpense,
      lastMonthIncome, lastMonthExpense,
      months, profitMonths,
      avgSettlement, avgDailyRate,
      rentPayments, depositPayments, dpPayments,
      counts: {
        properties: properties.length,
        rooms: rooms.length,
        tenants: activeTenants.length,
        services: services.length,
      },
    }
  }, [properties, rooms, tenants, rentals, invoices, payments, expenses, services, today])
}

/** Build accounting ledger entries out of payments + expenses. */
export function buildLedger(
  payments: Payment[],
  expenses: ReturnType<typeof useStore.getState>['expenses'],
  ctx: {
    propertyName: (id: string) => string
    roomName: (id: string | null) => string
    tenantName: (id: string) => string
    invoiceNumber: (id: string) => string
  },
): LedgerEntry[] {
  const income: LedgerEntry[] = payments.map((p) => {
    const category = p.amount < 0
      ? p.kind === 'deposit' ? 'Pengembalian Uang Jaminan' : 'Pengembalian DP'
      : categoryOfPayment(p)
    return {
      id: p.id,
      date: p.date,
      description: p.invoiceId
        ? `Pembayaran faktur ${ctx.invoiceNumber(p.invoiceId)}`
        : p.note || (p.kind === 'deposit' ? 'Uang jaminan' : 'Penerimaan lain'),
      propertyId: p.propertyId,
      propertyName: ctx.propertyName(p.propertyId),
      roomName: '-',
      tenantName: ctx.tenantName(p.tenantId),
      category,
      debit: p.amount < 0 ? Math.abs(p.amount) : 0,
      credit: p.amount > 0 ? p.amount : 0,
      section: sectionOfCategory(category),
      kind: p.amount < 0 ? 'expense' : 'income',
    }
  })

  const out: LedgerEntry[] = expenses.map((e) => ({
    id: e.id,
    date: e.date,
    description: e.name,
    propertyId: e.propertyId,
    propertyName: ctx.propertyName(e.propertyId),
    roomName: ctx.roomName(e.roomId),
    tenantName: '-',
    category: e.category,
    debit: e.total,
    credit: 0,
    section: 'aset',
    kind: 'expense',
  }))

  return [...income, ...out].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export function useLookups() {
  const properties = useStore((s) => s.properties)
  const rooms = useStore((s) => s.rooms)
  const tenants = useStore((s) => s.tenants)
  const invoices = useStore((s) => s.invoices)
  const rentals = useStore((s) => s.rentals)
  const deleted = useStore((s) => s.deletedNames)
  const today = useStore((s) => s.today)
  return useMemo(() => {
    const propById = new Map(properties.map((p) => [p.id, p]))
    const roomById = new Map(rooms.map((r) => [r.id, r]))
    const tenantById = new Map(tenants.map((t) => [t.id, t]))
    // History can reference something that was deleted since: label it instead of showing '-'.
    const gone = (name?: string) => (name ? `${name} (dihapus)` : '-')
    return {
      propertyName: (id: string) => propById.get(id)?.name ?? gone(deleted.properties[id]),
      property: (id: string) => propById.get(id),
      roomName: (id: string | null) => (id ? roomById.get(id)?.name ?? gone(deleted.rooms[id]) : '-'),
      room: (id: string) => roomById.get(id),
      tenantName: (id: string) => tenantById.get(id)?.name ?? gone(deleted.tenants[id]),
      tenant: (id: string) => tenantById.get(id),
      invoiceNumber: (id: string) => invoices.find((i) => i.id === id)?.number ?? '-',
      activeRental: (tenantId: string) => getActiveRental(tenantId, rentals),
      roomStatus: (roomId: string) => getRoomStatus(roomId, rentals, invoices, today),
      tenantStatus: (tenantId: string) => getTenantStatus(tenantId, rentals, today),
      today,
    }
  }, [properties, rooms, tenants, invoices, rentals, deleted, today])
}

export function expenseCategoryTotals(expenses: ReturnType<typeof useStore.getState>['expenses']) {
  const map = new Map<string, number>()
  EXPENSE_CATEGORIES.forEach((c) => map.set(c, 0))
  expenses.forEach((e) => map.set(e.category, (map.get(e.category) ?? 0) + e.total))
  return Array.from(map.entries())
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

export function filterByPeriod<T extends { date?: string; periodStart?: string }>(
  rows: T[],
  from: string,
  to: string,
  pick: (row: T) => string,
) {
  return rows.filter((r) => inRange(pick(r), from, to))
}

export type { Invoice }

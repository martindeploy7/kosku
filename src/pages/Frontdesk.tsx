import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Banknote, CalendarClock, History, LogOut, Receipt, Send, Users, Wallet,
} from 'lucide-react'
import {
  Badge, Button, Card, EmptyState, Pagination, SearchInput, Table, Td, Th, Tooltip, Tr,
} from '@/components/ui'
import { FilterPopover, PageHeader, StatCard } from '@/components/shared'
import { CheckoutModal } from '@/components/modals/CheckoutModal'
import { ExpenseFormModal } from '@/components/modals/FormModals'
import { PaymentModal } from '@/components/modals/PaymentModal'
import { isCurrentRental, outstanding, paidAmount } from '@/lib/finance'
import { useDerived, useLookups } from '@/lib/selectors'
import { useStore } from '@/lib/store'
import { addDays, cn, formatDate, formatIDR, sum } from '@/lib/utils'


export default function Frontdesk() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { rentals, invoices, payments, tenants, properties, today } = useStore()
  const d = useDerived()
  const lookups = useLookups()

  const [payOpen, setPayOpen] = React.useState(false)
  const [checkoutOpen, setCheckoutOpen] = React.useState(false)
  const [expenseOpen, setExpenseOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [filters, setFilters] = React.useState<Record<string, string[]>>({})
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  React.useEffect(() => {
    const action = params.get('action')
    if (action === 'payment') setPayOpen(true)
    if (action === 'checkout') setCheckoutOpen(true)
    if (action === 'expense') setExpenseOpen(true)
    if (action) { params.delete('action'); setParams(params, { replace: true }) }
  }, [params, setParams])

  const last30 = addDays(today, -30)

  const invoices30 = invoices.filter((i) => i.periodStart >= last30 && i.periodStart <= today)
  const payments30 = payments.filter((p) => p.date >= last30 && p.date <= today && p.amount > 0 && p.kind === 'rent')

  const rows = React.useMemo(() => {
    // DP bookings included: their outstanding balance is exactly what the front desk collects.
    const activeRentals = rentals.filter(isCurrentRental)
    return activeRentals
      .map((r) => {
        const tenant = tenants.find((t) => t.id === r.tenantId)
        const rentalInvoices = invoices.filter((i) => i.rentalId === r.id)
        const overdue = sum(
          rentalInvoices.filter((i) => i.dueDate <= today),
          (i) => outstanding(i, payments),
        )
        const running = sum(
          rentalInvoices.filter((i) => i.dueDate > today),
          (i) => outstanding(i, payments),
        )
        const settled = sum(rentalInvoices, (i) => paidAmount(i.id, payments))
        const nextInvoice = rentalInvoices
          .filter((i) => outstanding(i, payments) > 0)
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0]
        return { rental: r, tenant, overdue, running, settled, nextInvoice }
      })
      .filter((row) => {
        if (!row.tenant) return false
        if (query) {
          const q = query.toLowerCase()
          const hay = `${row.tenant.name} ${lookups.roomName(row.rental.roomId)}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        const status = filters.status ?? []
        if (status.length) {
          const isUnpaid = row.overdue > 0
          const isPartial = row.nextInvoice ? paidAmount(row.nextInvoice.id, payments) > 0 && row.overdue > 0 : false
          const isPaid = row.overdue === 0
          const match =
            (status.includes('unpaid') && isUnpaid && !isPartial) ||
            (status.includes('partial') && isPartial) ||
            (status.includes('paid') && isPaid)
          if (!match) return false
        }
        const props = filters.property ?? []
        if (props.length && !props.includes(row.rental.propertyId)) return false
        return true
      })
  }, [rentals, tenants, invoices, payments, query, filters, today, lookups])

  const paged = rows.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      <PageHeader title="Frontdesk" description="Pusat operasional harian untuk pembayaran dan check-out penyewa." />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <QuickAction
          icon={Banknote}
          title="Selesaikan pembayaran"
          desc="Pembayaran transfer manual / cash"
          tone="success"
          onClick={() => setPayOpen(true)}
        />
        <QuickAction
          icon={LogOut}
          title="Akhiri perjanjian penyewa"
          desc="Proses keluar / check-out penyewa"
          tone="warning"
          onClick={() => setCheckoutOpen(true)}
        />
        <QuickAction
          icon={CalendarClock}
          title="Cek ketersediaan kamar"
          desc="Jadwal sewa & ketersediaan"
          tone="info"
          onClick={() => navigate('/rooms?tab=schedule')}
        />
        <QuickAction
          icon={Wallet}
          title="Catat pengeluaran"
          desc="Pengeluaran properti & kamar"
          tone="danger"
          onClick={() => setExpenseOpen(true)}
        />
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Penyewa aktif"
          value={d.activeTenants.length}
          sublabel={formatDate(today, 'long')}
          icon={Users}
          tone="primary"
        />
        <StatCard
          label="Total tagihan (30 hari)"
          value={formatIDR(sum(invoices30, (i) => i.total), { compact: true })}
          sublabel={`${invoices30.length} tagihan`}
          icon={Receipt}
          tone="info"
        />
        <StatCard
          label="Pembayaran diterima (30 hari)"
          value={formatIDR(sum(payments30, (p) => p.amount), { compact: true })}
          sublabel={`${payments30.length} transaksi`}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label="Belum dibayar (jatuh tempo)"
          value={formatIDR(d.totalOutstanding, { compact: true })}
          sublabel={`${d.unpaidInvoices.length} tagihan`}
          icon={Wallet}
          tone="danger"
        />
      </div>

      <Card>
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-border">
          <SearchInput
            value={query}
            onChange={(v) => { setQuery(v); setPage(1) }}
            placeholder="Cari nama penyewa atau kamar..."
            className="flex-1 min-w-[220px]"
          />
          <FilterPopover
            groups={[
              {
                key: 'status',
                label: 'Status',
                options: [
                  { value: 'unpaid', label: 'Belum dibayar' },
                  { value: 'partial', label: 'Dibayar sebagian' },
                  { value: 'paid', label: 'Lunas' },
                ],
              },
              {
                key: 'property',
                label: 'Properti',
                options: properties.map((p) => ({ value: p.id, label: p.name })),
              },
            ]}
            selected={filters}
            onChange={(key, values) => { setFilters((f) => ({ ...f, [key]: values })); setPage(1) }}
            onReset={() => setFilters({})}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Tidak ada penyewa aktif"
            description="Tambahkan penyewa dan buat perjanjian sewa untuk melihat data di sini."
            action={<Button onClick={() => navigate('/tenants?action=new')}>Tambah penyewa</Button>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-12">#</Th>
                  <Th>Penyewa</Th>
                  <Th>Kamar</Th>
                  <Th>Tanggal penagihan</Th>
                  <Th align="right">Sewa berjalan</Th>
                  <Th align="right">Jatuh tempo</Th>
                  <Th align="right">Penyelesaian</Th>
                  <Th align="center">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row, i) => (
                  <Tr key={row.rental.id}>
                    <Td className="text-muted-foreground tabular-nums">{(page - 1) * pageSize + i + 1}</Td>
                    <Td>
                      <button
                        onClick={() => navigate(`/tenants/${row.tenant!.id}`)}
                        className="font-semibold hover:text-primary transition text-left"
                      >
                        {row.tenant!.name}
                      </button>
                      <p className="text-[11px] text-muted-foreground">{lookups.propertyName(row.rental.propertyId)}</p>
                    </Td>
                    <Td className="text-sm">{lookups.roomName(row.rental.roomId)}</Td>
                    <Td className="whitespace-nowrap text-sm">
                      {row.nextInvoice ? formatDate(row.nextInvoice.dueDate) : '—'}
                    </Td>
                    <Td align="right" className="tabular-nums text-sm">{formatIDR(row.running)}</Td>
                    <Td align="right" className="tabular-nums text-sm">
                      {row.overdue > 0 ? (
                        <span className="font-bold text-danger">{formatIDR(row.overdue)}</span>
                      ) : (
                        <Badge tone="success">Lunas</Badge>
                      )}
                    </Td>
                    <Td align="right" className="tabular-nums text-sm font-semibold text-success">
                      {formatIDR(row.settled)}
                    </Td>
                    <Td align="center">
                      <div className="flex items-center justify-center gap-1">
                        <Tooltip content="Catat pembayaran">
                          <Button size="icon" variant="ghost" onClick={() => setPayOpen(true)} aria-label="Catat pembayaran">
                            <Banknote className="h-4 w-4" />
                          </Button>
                        </Tooltip>
                        <Tooltip content="Riwayat penyewa">
                          <Button
                            size="icon" variant="ghost"
                            onClick={() => navigate(`/tenants/${row.tenant!.id}?tab=invoices`)}
                            aria-label="Riwayat"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                        </Tooltip>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={rows.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </Card>

      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} />
      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
      <ExpenseFormModal open={expenseOpen} onClose={() => setExpenseOpen(false)} />
    </>
  )
}

function QuickAction({
  icon: Icon, title, desc, tone, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  tone: 'success' | 'warning' | 'info' | 'danger'
  onClick: () => void
}) {
  const styles = {
    success: { surface: 'bg-gradient-to-br from-surface via-surface to-success-soft/80', mark: 'text-success' },
    warning: { surface: 'bg-gradient-to-br from-surface via-surface to-warning-soft/80', mark: 'text-warning' },
    info: { surface: 'bg-gradient-to-br from-surface via-surface to-info-soft/80', mark: 'text-info' },
    danger: { surface: 'bg-gradient-to-br from-surface via-surface to-danger-soft/80', mark: 'text-danger' },
  }[tone]

  return (
    <button
      onClick={onClick}
      className={cn('card relative isolate min-h-[112px] overflow-hidden p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-ring group', styles.surface)}
    >
      <Icon aria-hidden="true" className={cn('absolute -bottom-5 -right-3 z-0 h-28 w-28 opacity-[0.12] transition-transform duration-300 group-hover:scale-105', styles.mark)} />
      <span className="relative z-10 block max-w-[78%] min-w-0">
        <span className="block font-bold text-sm leading-tight">{title}</span>
        <span className="block text-[11px] text-muted-foreground mt-1 leading-relaxed">{desc}</span>
      </span>
    </button>
  )
}

import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Calendar, Clock, FileSpreadsheet, LayoutGrid, List, Phone, Plus, UserPlus, Users, Wallet,
} from 'lucide-react'
import {
  Avatar, Badge, Button, Card, EmptyState, Pagination, SearchInput, Table, Td, Th, Tr,
} from '@/components/ui'
import { FilterChips, FilterPopover, PageHeader, ViewToggle } from '@/components/shared'
import { TenantFormModal } from '@/components/modals/FormModals'
import { TENANT_STATUSES, rentTypeLabel } from '@/lib/constants'
import { isCurrentRental, outstanding } from '@/lib/finance'
import { exportToExcel } from '@/lib/export'
import { useLookups } from '@/lib/selectors'
import { companyName, useStore } from '@/lib/store'
import type { Tenant } from '@/lib/types'
import { cn, formatDate, formatIDR, formatPhoneDisplay, sum } from '@/lib/utils'


export default function Tenants() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { tenants, rentals, invoices, payments, properties, today } = useStore()
  const lookups = useLookups()

  const [modalOpen, setModalOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [view, setView] = React.useState<'grid' | 'list'>('grid')
  const [waitlistMode, setWaitlistMode] = React.useState(false)
  const [quickStatus, setQuickStatus] = React.useState<string[]>([])
  const [filters, setFilters] = React.useState<Record<string, string[]>>({})
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(12)

  React.useEffect(() => {
    if (params.get('action') === 'new') {
      setModalOpen(true)
      params.delete('action')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const enriched = React.useMemo(
    () =>
      tenants.map((t) => {
        const rental = rentals.find((r) => r.tenantId === t.id && isCurrentRental(r))
        const status = lookups.tenantStatus(t.id)
        const tenantInvoices = invoices.filter((i) => i.tenantId === t.id)
        const due = sum(tenantInvoices.filter((i) => i.dueDate <= today), (i) => outstanding(i))
        const paid = sum(payments.filter((p) => p.tenantId === t.id && p.amount > 0), (p) => p.amount)
        return { tenant: t, rental, status, due, paid }
      }),
    [tenants, rentals, invoices, payments, lookups, today],
  )

  const filtered = React.useMemo(() => {
    return enriched.filter(({ tenant, rental, status }) => {
      if (waitlistMode && !tenant.isWaitlist) return false
      if (!waitlistMode && tenant.isWaitlist && !quickStatus.includes('belum_sewa') && !(filters.status ?? []).includes('belum_sewa')) {
        // waitlist tenants only show in waitlist mode or when explicitly filtered
        if (quickStatus.length > 0 || (filters.status ?? []).length > 0) return false
      }
      if (query) {
        const q = query.toLowerCase()
        const hay = `${tenant.name} ${tenant.job} ${rental ? lookups.roomName(rental.roomId) : ''} ${tenant.contacts.map((c) => c.phone).join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const statusFilters = [...new Set([...quickStatus, ...(filters.status ?? [])])]
      if (statusFilters.length && !statusFilters.includes(status)) return false
      const propFilters = filters.property ?? []
      if (propFilters.length && (!rental || !propFilters.includes(rental.propertyId))) return false
      const rentFilters = filters.rentType ?? []
      if (rentFilters.length && (!rental || !rentFilters.includes(rental.rentType))) return false
      return true
    })
  }, [enriched, query, quickStatus, filters, waitlistMode, lookups])

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  const handleExport = () => {
    exportToExcel(
      filtered,
      [
        { header: 'Nama', accessor: (r) => r.tenant.name },
        { header: 'Status', accessor: (r) => TENANT_STATUSES.find((s) => s.value === r.status)?.label ?? '-' },
        { header: 'Properti', accessor: (r) => (r.rental ? lookups.propertyName(r.rental.propertyId) : '-') },
        { header: 'Kamar', accessor: (r) => (r.rental ? lookups.roomName(r.rental.roomId) : '-') },
        { header: 'Telepon', accessor: (r) => r.tenant.contacts[0]?.phone ?? '-' },
        { header: 'Email', accessor: (r) => r.tenant.contacts[0]?.email ?? '-' },
        { header: 'Mulai sewa', accessor: (r) => (r.rental ? formatDate(r.rental.startDate) : '-') },
        { header: 'Harga sewa', accessor: (r) => (r.rental ? r.rental.price : 0), align: 'right' },
        { header: 'Tunggakan', accessor: (r) => r.due, align: 'right' },
      ],
      { title: 'Daftar Penyewa', filename: 'daftar-penyewa', company: companyName() },
    )
  }

  return (
    <>
      <PageHeader
        title="Penyewa"
        description={`${enriched.filter((e) => !e.tenant.isWaitlist).length} penyewa terdaftar · ${enriched.filter((e) => e.tenant.isWaitlist).length} di daftar tunggu`}
        actions={
          <>
            <Button variant="outline" onClick={handleExport}>
              <FileSpreadsheet className="h-4 w-4" /> Ekspor Excel
            </Button>
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" /> Tambah penyewa
            </Button>
          </>
        }
      />

      <Card className="mb-6">
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              value={query}
              onChange={(v) => { setQuery(v); setPage(1) }}
              placeholder="Cari nama, kamar, atau nomor telepon..."
              className="flex-1 min-w-[220px]"
            />
            <FilterPopover
              groups={[
                { key: 'status', label: 'Status sewa', options: TENANT_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
                { key: 'property', label: 'Properti', options: properties.map((p) => ({ value: p.id, label: p.name })) },
                {
                  key: 'rentType', label: 'Jenis sewa',
                  options: [
                    { value: 'daily', label: 'Harian' }, { value: 'weekly', label: 'Mingguan' },
                    { value: 'monthly', label: 'Bulanan' }, { value: 'yearly', label: 'Tahunan' },
                  ],
                },
              ]}
              selected={filters}
              onChange={(k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1) }}
              onReset={() => setFilters({})}
            />
            <Button
              variant={waitlistMode ? 'primary' : 'outline'}
              onClick={() => { setWaitlistMode((w) => !w); setQuickStatus([]); setPage(1) }}
            >
              <Clock className="h-4 w-4" />
              Daftar tunggu
              <Badge tone={waitlistMode ? 'muted' : 'primary'} className="ml-1">
                {enriched.filter((e) => e.tenant.isWaitlist).length}
              </Badge>
            </Button>
            <ViewToggle
              value={view}
              onChange={(v) => setView(v as 'grid' | 'list')}
              options={[
                { value: 'grid', icon: LayoutGrid, label: 'Tampilan kartu' },
                { value: 'list', icon: List, label: 'Tampilan tabel' },
              ]}
            />
          </div>

          {!waitlistMode && (
            <FilterChips
              options={TENANT_STATUSES.filter((s) => s.value !== 'berakhir').map((s) => ({ value: s.value, label: s.label }))}
              selected={quickStatus}
              onToggle={(v) => {
                setQuickStatus((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))
                setPage(1)
              }}
            />
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={waitlistMode ? 'Belum ada calon penyewa' : 'Tidak ada penyewa ditemukan'}
            description={
              waitlistMode
                ? 'Pendaftar dari halaman pemasaran akan otomatis muncul di sini.'
                : 'Coba ubah kata kunci pencarian atau filter yang aktif.'
            }
            action={
              !waitlistMode && (
                <Button onClick={() => setModalOpen(true)}>
                  <UserPlus className="h-4 w-4" /> Tambah penyewa
                </Button>
              )
            }
          />
        </Card>
      ) : view === 'grid' ? (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {paged.map(({ tenant, rental, status, due }) => (
              <TenantCard
                key={tenant.id}
                tenant={tenant}
                status={status}
                roomLabel={rental ? `${lookups.propertyName(rental.propertyId)} • ${lookups.roomName(rental.roomId)}` : 'Belum menyewa'}
                price={rental ? `${formatIDR(rental.price)} / ${rentTypeLabel(rental.rentType)}` : '—'}
                since={rental ? formatDate(rental.startDate, 'long') : null}
                due={due}
                onClick={() => navigate(`/tenants/${tenant.id}`)}
              />
            ))}
          </div>
          <div className="mt-4">
            <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizes={[12, 24, 48]} />
          </div>
        </>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Nama</Th>
                <Th>Properti & kamar</Th>
                <Th>Telepon</Th>
                <Th>Mulai sewa</Th>
                <Th>Status</Th>
                <Th align="right">Tunggakan</Th>
                <Th align="right">Sewa</Th>
              </tr>
            </thead>
            <tbody>
              {paged.map(({ tenant, rental, status, due }) => {
                const st = TENANT_STATUSES.find((s) => s.value === status)!
                return (
                  <Tr key={tenant.id} clickable onClick={() => navigate(`/tenants/${tenant.id}`)}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={tenant.name} color={tenant.avatarColor} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{tenant.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{tenant.job || '—'}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-sm">
                      {rental ? (
                        <>
                          <p className="truncate">{lookups.roomName(rental.roomId)}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{lookups.propertyName(rental.propertyId)}</p>
                        </>
                      ) : '—'}
                    </Td>
                    <Td className="text-sm whitespace-nowrap">{formatPhoneDisplay(tenant.contacts[0]?.phone ?? '')}</Td>
                    <Td className="text-sm whitespace-nowrap">{rental ? formatDate(rental.startDate) : '—'}</Td>
                    <Td><Badge tone={st.tone as 'success'}>{st.label}</Badge></Td>
                    <Td align="right" className="tabular-nums text-sm">
                      {due > 0 ? <span className="font-bold text-danger">{formatIDR(due)}</span> : <span className="text-muted-foreground">—</span>}
                    </Td>
                    <Td align="right" className="tabular-nums text-sm font-semibold whitespace-nowrap">
                      {rental ? formatIDR(rental.price) : '—'}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizes={[12, 24, 48]} />
        </Card>
      )}

      <TenantFormModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={(id) => navigate(`/tenants/${id}`)} />
    </>
  )
}

function TenantCard({
  tenant, status, roomLabel, price, since, due, onClick,
}: {
  tenant: Tenant
  status: string
  roomLabel: string
  price: string
  since: string | null
  due: number
  onClick: () => void
}) {
  const st = TENANT_STATUSES.find((s) => s.value === status)!
  return (
    <button
      onClick={onClick}
      className="card p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all focus-ring group"
    >
      <div className="flex items-start gap-3">
        <Avatar name={tenant.name} color={tenant.avatarColor} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="font-bold truncate group-hover:text-primary transition">{tenant.name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{roomLabel}</p>
          <Badge tone={st.tone as 'success'} className="mt-2">{st.label}</Badge>
        </div>
      </div>

      <div className="mt-4 rounded-md bg-muted/50 px-3 py-2.5">
        <p className="text-[11px] text-muted-foreground font-semibold">Sewa</p>
        <p className="font-bold text-success text-sm mt-0.5">{price}</p>
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
        {since && (
          <p className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 shrink-0" /> Sejak {since}
          </p>
        )}
        <p className="flex items-center gap-2 truncate">
          <Phone className="h-3.5 w-3.5 shrink-0" /> {formatPhoneDisplay(tenant.contacts[0]?.phone ?? '')}
        </p>
        <p className={cn('flex items-center gap-2', due > 0 && 'text-danger font-semibold')}>
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          {due > 0 ? `Tunggakan ${formatIDR(due)}` : 'Tidak ada tunggakan'}
        </p>
      </div>
    </button>
  )
}

import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlarmClock, ArrowRight, Banknote, BedDouble, Building2, CalendarRange, DoorOpen, Hourglass, LayoutGrid, List, Pencil,
  Plus, Trash2, UserPlus, UserRound, WalletCards,
  type LucideIcon,
} from 'lucide-react'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Pagination, SearchInput,
  Select, Table, Td, Th, Tooltip, Tr,
} from '@/components/ui'
import { FilterChips, FilterPopover, PageHeader, Tabs, ViewToggle } from '@/components/shared'
import { RoomFormModal } from '@/components/modals/FormModals'
import { PaymentModal } from '@/components/modals/PaymentModal'
import { actions } from '@/lib/actions'
import { currentRentalOfRoom, nextDueOfRental, type NextDue } from '@/lib/finance'
import { ROOM_CONDITIONS, ROOM_STATUSES } from '@/lib/constants'
import { ROOM_CONDITION_ICON } from '@/lib/roomConditionIcon'
import { useLookups } from '@/lib/selectors'
import { useCanDelete, useNeedsApproval, useStore } from '@/lib/store'
import type { Rental, Room, RoomStatus, Tenant } from '@/lib/types'
import { addDays, cn, daysBetween, dueLabel, formatDate, formatIDR, parseISO } from '@/lib/utils'

interface RoomRow {
  room: Room
  status: RoomStatus
  rental: Rental | null
  tenant: Tenant | undefined
  due: NextDue | null
}


export default function Rooms() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const rooms = useStore((s) => s.rooms)
  const properties = useStore((s) => s.properties)
  const rentals = useStore((s) => s.rentals)
  const invoices = useStore((s) => s.invoices)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const canDelete = useCanDelete()
  const needsApproval = useNeedsApproval()
  const approvals = useStore((s) => s.approvals)
  const pendingPrice = (roomId: string) => approvals.find((a) => a.entityId === roomId && a.kind === 'room.update')
  const lookups = useLookups()
  const [payFor, setPayFor] = React.useState<{ tenantId: string; invoiceId?: string } | null>(null)

  const [tab, setTab] = React.useState(params.get('tab') === 'schedule' ? 'schedule' : 'rooms')
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editRoom, setEditRoom] = React.useState<Room | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<Room | null>(null)
  const [query, setQuery] = React.useState('')
  const [view, setView] = React.useState<'grid' | 'list' | 'due'>(params.get('view') === 'due' ? 'due' : 'grid')
  const [quickFilter, setQuickFilter] = React.useState<string[]>([])
  const [filters, setFilters] = React.useState<Record<string, string[]>>({})
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(12)

  React.useEffect(() => {
    const next: Record<string, string> = {}
    if (tab === 'schedule') next.tab = 'schedule'
    if (view === 'due') next.view = 'due'
    setParams(next, { replace: true })
  }, [tab, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const enriched = React.useMemo<RoomRow[]>(
    () =>
      sortRooms(rooms, lookups.propertyName).map((room) => {
        const status = lookups.roomStatus(room.id)
        const rental = currentRentalOfRoom(room.id, rentals, today)
        const tenant = rental ? lookups.tenant(rental.tenantId) : undefined
        const due = rental ? nextDueOfRental(rental, invoices) : null
        return { room, status, rental, tenant, due }
      }),
    [rooms, rentals, invoices, today, lookups],
  )

  const filtered = React.useMemo(
    () =>
      enriched.filter(({ room, status, tenant }) => {
        if (query) {
          const q = query.toLowerCase()
          const hay = `${room.name} ${lookups.propertyName(room.propertyId)} ${tenant?.name ?? ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        const all = [...new Set([...quickFilter, ...(filters.status ?? []), ...(filters.condition ?? [])])]
        const statusSel = all.filter((v) => ROOM_STATUSES.some((s) => s.value === v))
        const condSel = all.filter((v) => ROOM_CONDITIONS.some((c) => c.value === v))
        if (statusSel.length && !statusSel.includes(status)) return false
        if (condSel.length && !condSel.includes(room.condition)) return false
        const props = filters.property ?? []
        if (props.length && !props.includes(room.propertyId)) return false
        return true
      }),
    [enriched, query, quickFilter, filters, lookups],
  )

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)
  const dueTodayCount = enriched.filter((r) => r.due?.date === today).length
  const availableSoonCount = enriched.filter((r) => r.status === 'akan_tersedia').length

  const openCreate = () => { setEditRoom(null); setModalOpen(true) }
  const openEdit = (room: Room) => { setEditRoom(room); setModalOpen(true) }

  return (
    <>
      <PageHeader
        title="Kamar"
        description={`${rooms.length} kamar · ${dueTodayCount} jatuh tempo hari ini · ${availableSoonCount} akan tersedia`}
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Tambah kamar</Button>}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[{ value: 'rooms', label: 'Daftar Kamar' }, { value: 'schedule', label: 'Jadwal Kamar' }]}
      />

      {tab === 'rooms' ? (
        <>
          <Card className="mb-6">
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <SearchInput
                  value={query}
                  onChange={(v) => { setQuery(v); setPage(1) }}
                  placeholder="Cari kamar, properti, atau penyewa..."
                  className="flex-1 min-w-[220px]"
                />
                <FilterPopover
                  groups={[
                    { key: 'status', label: 'Okupansi kamar', options: ROOM_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
                    { key: 'condition', label: 'Kondisi kamar', options: ROOM_CONDITIONS.map((c) => ({ value: c.value, label: `${c.emoji} ${c.label}` })) },
                    { key: 'property', label: 'Properti', options: properties.map((p) => ({ value: p.id, label: p.name })) },
                  ]}
                  selected={filters}
                  onChange={(k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1) }}
                  onReset={() => setFilters({})}
                />
                <ViewToggle
                  value={view}
                  onChange={(v) => setView(v as 'grid' | 'list' | 'due')}
                  options={[
                    { value: 'due', icon: AlarmClock, label: 'Prioritas jatuh tempo' },
                    { value: 'grid', icon: LayoutGrid, label: 'Urut nomor kamar (kartu)' },
                    { value: 'list', icon: List, label: 'Urut nomor kamar (tabel)' },
                  ]}
                />
              </div>
              <FilterChips
                options={[
                  ...ROOM_STATUSES.map((s) => ({ value: s.value, label: s.label })),
                  ...ROOM_CONDITIONS.map((c) => ({ value: c.value, label: c.label, icon: ROOM_CONDITION_ICON[c.value] })),
                ]}
                selected={quickFilter}
                onToggle={(v) => {
                  setQuickFilter((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))
                  setPage(1)
                }}
              />
            </div>
          </Card>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={BedDouble}
                title="Tidak ada kamar ditemukan"
                description="Ubah filter atau tambahkan kamar baru untuk memulai."
                action={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Tambah kamar</Button>}
              />
            </Card>
          ) : view === 'due' ? (
            <DueView rows={filtered} onPay={(tenantId, invoiceId) => setPayFor({ tenantId, invoiceId })} />
          ) : view === 'grid' ? (
            <>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {paged.map(({ room, status, rental, tenant, due }) => {
                  const st = ROOM_STATUSES.find((s) => s.value === status)!
                  const cond = ROOM_CONDITIONS.find((c) => c.value === room.condition)!
                  const CondIcon = ROOM_CONDITION_ICON[cond.value]
                  return (
                    <RoomCard
                      key={room.id}
                      room={room}
                      status={status}
                      rental={rental}
                      tenant={tenant}
                      due={due}
                      today={today}
                      propertyName={lookups.propertyName(room.propertyId)}
                      pendingPrice={pendingPrice(room.id)}
                      onTenant={() => tenant && navigate(`/tenants/${tenant.id}`)}
                      onAddTenant={() => navigate(`/tenants?action=new&roomId=${encodeURIComponent(room.id)}`)}
                      onCondition={(v) => {
                        void run(() => actions.updateRoom(room.id, { condition: v }), { success: `Kondisi ${room.name} diperbarui` })
                      }}
                      onEdit={() => openEdit(room)}
                    />
                  )
                })}
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
                    <Th>Kamar</Th>
                    <Th>Properti</Th>
                    <Th>Penyewa</Th>
                    <Th>Jatuh tempo</Th>
                    <Th>Status</Th>
                    <Th>Kondisi</Th>
                    <Th align="right">Harga/bulan</Th>
                    <Th align="center">Aksi</Th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(({ room, status, tenant, due }) => {
                    const st = ROOM_STATUSES.find((s) => s.value === status)!
                    const cond = ROOM_CONDITIONS.find((c) => c.value === room.condition)!
                    const CondIcon = ROOM_CONDITION_ICON[cond.value]
                    return (
                      <Tr key={room.id}>
                        <Td className="font-semibold">{room.name}</Td>
                        <Td className="text-sm text-muted-foreground">{lookups.propertyName(room.propertyId)}</Td>
                        <Td className="text-sm">
                          {tenant ? (
                            <button onClick={() => navigate(`/tenants/${tenant.id}`)} className="hover:text-primary transition font-medium">
                              {tenant.name}
                            </button>
                          ) : '—'}
                        </Td>
                        <Td className="text-sm whitespace-nowrap">{due ? <DueChip due={due} today={today} /> : '—'}</Td>
                        <Td><Badge tone={st.tone as 'success'}>{st.label}</Badge></Td>
                        <Td><Badge tone={cond.tone as 'info'}><CondIcon className="h-3 w-3" /> {cond.label}</Badge></Td>
                        <Td align="right" className="font-bold tabular-nums whitespace-nowrap">{formatIDR(room.price.monthly)}</Td>
                        <Td align="center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Button size="icon" variant="ghost" onClick={() => openEdit(room)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                            {canDelete && <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(room)} aria-label="Hapus"><Trash2 className="h-4 w-4 text-danger" /></Button>}
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizes={[12, 24, 48]} />
            </Card>
          )}
        </>
      ) : (
        <RoomSchedule />
      )}

      <RoomFormModal open={modalOpen} onClose={() => setModalOpen(false)} editRoom={editRoom} />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(reason) => {
          if (deleteTarget) void run(() => actions.deleteRoom(deleteTarget.id, reason), { success: `${deleteTarget.name} dipindahkan ke tempat sampah` })
        }}
        approval={needsApproval}
        title="Hapus kamar?"
        confirmLabel="Hapus"
        message={`${deleteTarget?.name} dipindahkan ke tempat sampah. Riwayat sewa dan tagihannya tetap tersimpan, dan superadmin dapat memulihkannya.`}
      />
      <PaymentModal open={Boolean(payFor)} onClose={() => setPayFor(null)} presetTenantId={payFor?.tenantId} presetInvoiceId={payFor?.invoiceId} />
    </>
  )
}

type RoomCardProps = RoomRow & {
  today: string
  propertyName: string
  pendingPrice: { changes: { label: string; before: string; after: string }[] } | undefined
  onTenant: () => void
  onAddTenant: () => void
  onCondition: (value: Room['condition']) => void
  onEdit: () => void
}

type RoomCardTheme = {
  Icon: LucideIcon
  card: string
  iconShell: string
  iconColor: string
  tenant: string
  empty: string
  action: string
}

const ROOM_CARD_THEMES: Record<RoomStatus, RoomCardTheme> = {
  tersedia: {
    Icon: DoorOpen,
    card: 'border-info/35 bg-info-soft/35 hover:border-info/65',
    iconShell: 'bg-info text-white shadow-md shadow-info/20',
    iconColor: 'text-info',
    tenant: 'border-info/25 bg-info-soft/70',
    empty: 'border-info/40 bg-info-soft/65 text-info',
    action: 'bg-info text-white hover:bg-info/90 shadow-md shadow-info/20',
  },
  dipesan_dp: {
    Icon: Hourglass,
    card: 'border-warning/40 bg-warning-soft/45 hover:border-warning/70',
    iconShell: 'bg-warning text-accent-foreground shadow-md shadow-warning/20',
    iconColor: 'text-warning',
    tenant: 'border-warning/30 bg-warning-soft/75',
    empty: 'border-warning/45 bg-warning-soft/70 text-accent-foreground',
    action: 'bg-warning text-accent-foreground hover:bg-warning/90 shadow-md shadow-warning/20',
  },
  dipesan: {
    Icon: WalletCards,
    card: 'border-primary/35 bg-primary-soft/35 hover:border-primary/65',
    iconShell: 'bg-primary text-white shadow-md shadow-primary/20',
    iconColor: 'text-primary',
    tenant: 'border-primary/25 bg-primary-soft/70',
    empty: 'border-primary/40 bg-primary-soft/65 text-primary',
    action: 'bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/20',
  },
  disewa: {
    Icon: UserRound,
    card: 'border-success/35 bg-success-soft/40 hover:border-success/65',
    iconShell: 'bg-success text-white shadow-md shadow-success/20',
    iconColor: 'text-success',
    tenant: 'border-success/25 bg-success-soft/75',
    empty: 'border-success/40 bg-success-soft/65 text-success',
    action: 'bg-success text-white hover:bg-success/90 shadow-md shadow-success/20',
  },
  menunggak: {
    Icon: AlarmClock,
    card: 'border-danger/35 bg-danger-soft/40 hover:border-danger/65',
    iconShell: 'bg-danger text-white shadow-md shadow-danger/20',
    iconColor: 'text-danger',
    tenant: 'border-danger/25 bg-danger-soft/75',
    empty: 'border-danger/40 bg-danger-soft/65 text-danger',
    action: 'bg-danger text-white hover:bg-danger/90 shadow-md shadow-danger/20',
  },
  akan_tersedia: {
    Icon: CalendarRange,
    card: 'border-accent/45 bg-accent/10 hover:border-accent/70',
    iconShell: 'bg-accent text-accent-foreground shadow-md shadow-accent/20',
    iconColor: 'text-accent-foreground',
    tenant: 'border-accent/30 bg-accent/15',
    empty: 'border-accent/45 bg-accent/15 text-accent-foreground',
    action: 'bg-accent text-accent-foreground hover:bg-accent/90 shadow-md shadow-accent/20',
  },
}

function RoomCard({
  room, status, rental, tenant, due, today, propertyName, pendingPrice: pending, onTenant, onAddTenant, onCondition, onEdit,
}: RoomCardProps) {
  const cond = ROOM_CONDITIONS.find((c) => c.value === room.condition)!
  const CondIcon = ROOM_CONDITION_ICON[cond.value]
  const st = ROOM_STATUSES.find((s) => s.value === status)!
  const theme = ROOM_CARD_THEMES[status]
  const StatusIcon = theme.Icon
  const isAvailable = status === 'tersedia'

  return (
    <Card className={cn('relative overflow-hidden border-2 p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg', theme.card)}>
      <StatusIcon className={cn('pointer-events-none absolute -right-5 -bottom-7 h-36 w-36 rotate-12 opacity-[.11]', theme.iconColor)} aria-hidden="true" />
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', theme.iconShell)}>
              <StatusIcon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-extrabold tracking-tight">{room.name}</h3>
                <Tooltip content={`Kondisi: ${cond.label}`}>
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-surface/80 shadow-xs">
                    <CondIcon className={cn('h-3.5 w-3.5', theme.iconColor)} aria-hidden="true" />
                  </span>
                </Tooltip>
              </div>
              <p className={cn('mt-1 flex items-center gap-1 text-xs font-semibold', theme.iconColor)}>
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{propertyName}</span>
              </p>
            </div>
          </div>
          <Badge tone={st.tone as 'success'} className="shrink-0 shadow-xs">{st.label}</Badge>
        </div>

        {tenant && rental ? (
          <button
            onClick={onTenant}
            className={cn('focus-ring mt-5 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm', theme.tenant)}
          >
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', theme.iconShell)}>
              <UserRound className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold">{tenant.name}</span>
              <span className="mt-0.5 block text-[11px] font-semibold text-foreground/70">
                {rental.status === 'booked' ? `Masuk ${formatDate(rental.startDate)}` : `Sejak ${formatDate(rental.startDate)}`}
              </span>
            </span>
            {due && <DueChip due={due} today={today} />}
          </button>
        ) : (
          <div className={cn('mt-5 flex items-center gap-3 rounded-xl border-2 border-dashed px-3 py-3', theme.empty)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface/80 shadow-xs">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold">Belum ada penyewa</p>
              <p className="mt-0.5 text-[11px] font-semibold opacity-80">Kamar siap diisi</p>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border/70 bg-surface/75 px-3 py-2.5 shadow-xs">
          <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', theme.tenant)}>
            <WalletCards className={cn('h-4 w-4', theme.iconColor)} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Harga per bulan</p>
            <p className="font-extrabold tabular-nums">{formatIDR(room.price.monthly)}</p>
            {pending && (
              <Tooltip content={pending.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`).join(' · ')}>
                <p className="mt-0.5 text-[11px] font-bold text-warning">Harga baru menunggu persetujuan</p>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {isAvailable ? (
            <Button size="sm" className={cn('min-w-0 flex-1', theme.action)} onClick={onAddTenant}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              <span>Tambah penyewa</span>
              <ArrowRight className="ml-auto h-4 w-4" aria-hidden="true" />
            </Button>
          ) : tenant ? (
            <Button size="sm" variant="outline" className="min-w-0 flex-1 border-foreground/15 bg-surface/75" onClick={onTenant}>
              <UserRound className="h-4 w-4" aria-hidden="true" /> Lihat penyewa
            </Button>
          ) : (
            <span className="flex-1 text-xs font-semibold text-muted-foreground">Belum siap disewakan</span>
          )}
          <Select
            className="h-8 w-[112px] shrink-0 bg-surface/80 text-xs"
            value={room.condition}
            onChange={(v) => onCondition(v as Room['condition'])}
            options={ROOM_CONDITIONS.map((c) => ({ value: c.value, label: `${c.emoji} ${c.label}` }))}
          />
          <Button size="icon" variant="ghost" className="shrink-0" onClick={onEdit} aria-label={`Edit ${room.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ Due-date view */

function DueChip({ due, today }: { due: NextDue; today: string }) {
  const days = daysBetween(today, due.date)
  const tone =
    due.kind === 'deadline' ? 'bg-warning-soft text-warning'
      : days < 0 ? 'bg-danger-soft text-danger'
      : days === 0 ? 'bg-warning-soft text-warning'
      : days <= 3 ? 'bg-info-soft text-info'
      : 'bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-flex flex-col items-end rounded-md px-2 py-1 text-right leading-tight shrink-0', tone)}>
      <span className="text-[11px] font-bold whitespace-nowrap">
        {due.kind === 'deadline' ? 'Batas DP · ' : ''}{dueLabel(due.date, today)}
      </span>
      <span className="text-[10px] opacity-80 whitespace-nowrap">{formatDate(due.date)}</span>
    </span>
  )
}

const DUE_GROUPS: { key: string; title: string; hint: string; tone: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overdue', title: 'Terlambat', hint: 'Lewat jatuh tempo dan belum lunas', tone: 'text-danger', icon: AlarmClock },
  { key: 'today', title: 'Jatuh tempo hari ini', hint: 'Ingatkan penyewa hari ini', tone: 'text-warning', icon: AlarmClock },
  { key: 'dp', title: 'Menunggu pelunasan DP', hint: 'Kamar ditahan sampai batas pelunasan', tone: 'text-warning', icon: Hourglass },
  { key: 'soon', title: '1–7 hari lagi', hint: 'Segera jatuh tempo', tone: 'text-info', icon: CalendarRange },
  { key: 'later', title: 'Lebih dari 7 hari', hint: 'Masih aman', tone: 'text-muted-foreground', icon: CalendarRange },
  { key: 'vacant', title: 'Kamar kosong', hint: 'Tidak ada sewa berjalan', tone: 'text-muted-foreground', icon: DoorOpen },
]

/** Rooms ordered by when money is due — so admins see who to chase first. */
function DueView({ rows, onPay }: { rows: RoomRow[]; onPay: (tenantId: string, invoiceId?: string) => void }) {
  const navigate = useNavigate()
  const today = useStore((s) => s.today)
  const invoices = useStore((s) => s.invoices)
  const lookups = useLookups()

  // Everything already due on the lease — one overdue row may hide several unpaid months.
  const arrearsOf = (rentalId: string) => {
    const due = invoices.filter((i) => i.rentalId === rentalId && i.status !== 'batal' && i.dueDate <= today && i.total > i.paidAmount)
    return { amount: due.reduce((a, i) => a + i.total - i.paidAmount, 0), count: due.length }
  }

  const groupOf = (r: RoomRow) => {
    if (!r.rental || !r.due) return 'vacant'
    if (r.due.kind === 'deadline') return 'dp'
    const d = daysBetween(today, r.due.date)
    if (d < 0) return r.due.kind === 'invoice' ? 'overdue' : 'later'
    if (d === 0) return 'today'
    return d <= 7 ? 'soon' : 'later'
  }
  const grouped = DUE_GROUPS.map((g) => ({
    ...g,
    rows: rows
      .filter((r) => groupOf(r) === g.key)
      .sort((a, b) => (a.due?.date ?? '9999') .localeCompare(b.due?.date ?? '9999') || a.room.name.localeCompare(b.room.name, 'id', { numeric: true })),
  })).filter((g) => g.rows.length)

  return (
    <div className="space-y-6">
      {grouped.map((g) => (
        <section key={g.key}>
          <div className="flex items-baseline gap-2 mb-2.5">
            <g.icon className={cn('h-4 w-4 self-center', g.tone)} />
            <h3 className={cn('font-bold', g.tone)}>{g.title}</h3>
            <span className="text-xs text-muted-foreground">{g.rows.length} kamar · {g.hint}</span>
          </div>
          <Card className="divide-y divide-border">
            {g.rows.map(({ room, status, rental, tenant, due }) => {
              const st = ROOM_STATUSES.find((s) => s.value === status)!
              return (
                <div key={room.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="w-32 shrink-0">
                    <p className="font-bold truncate">{room.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{lookups.propertyName(room.propertyId)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    {tenant ? (
                      <button onClick={() => navigate(`/tenants/${tenant.id}`)} className="font-semibold text-sm hover:text-primary truncate block text-left">
                        {tenant.name}
                      </button>
                    ) : <p className="text-sm text-muted-foreground">—</p>}
                    <Badge tone={st.tone as 'success'} className="mt-1">{st.label}</Badge>
                    {rental?.endDate && status === 'akan_tersedia' && (
                      <p className="mt-1.5 text-[11px] font-semibold text-success">
                        Tersedia {dueLabel(rental.endDate, today)} · {formatDate(rental.endDate)}
                      </p>
                    )}
                  </div>
                  {due && rental && (() => {
                    const arrears = due.kind === 'invoice' ? arrearsOf(rental.id) : null
                    const amount = arrears && arrears.amount > 0 ? arrears.amount : due.amount
                    return (
                      <div className="text-right">
                        <p className="font-bold tabular-nums text-sm">{formatIDR(amount)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {due.kind === 'scheduled' ? 'tagihan berikutnya' : arrears && arrears.count > 1 ? `${arrears.count} tagihan tertunggak` : 'sisa tagihan'}
                        </p>
                      </div>
                    )
                  })()}
                  {due && <DueChip due={due} today={today} />}
                  {rental && due && due.kind !== 'scheduled' && (
                    <Button size="sm" variant="outline" onClick={() => onPay(rental.tenantId, due.invoiceId ?? undefined)}>
                      <Banknote className="h-3.5 w-3.5" /> Bayar
                    </Button>
                  )}
                </div>
              )
            })}
          </Card>
        </section>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Gantt schedule */

/** "Urut nomor kamar": by property, then natural room order (Kamar 2 before Kamar 10). */
function sortRooms(rooms: Room[], propertyName: (id: string) => string) {
  return [...rooms].sort((a, b) =>
    propertyName(a.propertyId).localeCompare(propertyName(b.propertyId), 'id') ||
    a.name.localeCompare(b.name, 'id', { numeric: true }))
}

type ScheduleOrder = 'room' | 'due'

function scheduleDueMeta(due: NextDue | null, today: string) {
  if (!due) return {
    rank: 3,
    label: 'Tanpa jatuh tempo',
    bar: 'bg-muted-foreground/55 text-white',
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
  }
  const days = daysBetween(today, due.date)
  if (days <= 0) return {
    rank: 0,
    label: dueLabel(due.date, today),
    bar: 'bg-danger text-white',
    dot: 'bg-danger',
    text: 'text-danger',
  }
  if (days <= 7) return {
    rank: 1,
    label: dueLabel(due.date, today),
    bar: 'bg-warning text-accent-foreground',
    dot: 'bg-warning',
    text: 'text-warning',
  }
  return {
    rank: 2,
    label: dueLabel(due.date, today),
    bar: 'bg-success text-white',
    dot: 'bg-success',
    text: 'text-success',
  }
}

function RoomSchedule() {
  const rooms = useStore((s) => s.rooms)
  const rentals = useStore((s) => s.rentals)
  const invoices = useStore((s) => s.invoices)
  const properties = useStore((s) => s.properties)
  const today = useStore((s) => s.today)
  const lookups = useLookups()
  const [startDate, setStartDate] = React.useState(today)
  const [days, setDays] = React.useState(14)
  const [propertyId, setPropertyId] = React.useState('')
  const [order, setOrder] = React.useState<ScheduleOrder>('room')

  const dates = React.useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate, days],
  )

  const scheduleRows = React.useMemo(() => {
    const rows = sortRooms(rooms, lookups.propertyName)
      .filter((room) => !propertyId || room.propertyId === propertyId)
      .map((room) => {
        const rental = currentRentalOfRoom(room.id, rentals, today)
        return { room, rental, due: rental ? nextDueOfRental(rental, invoices) : null }
      })
    if (order === 'room') return rows
    return rows.sort((a, b) => {
      const aMeta = scheduleDueMeta(a.due, today)
      const bMeta = scheduleDueMeta(b.due, today)
      return aMeta.rank - bMeta.rank ||
        (a.due?.date ?? '9999-12-31').localeCompare(b.due?.date ?? '9999-12-31') ||
        a.room.name.localeCompare(b.room.name, 'id', { numeric: true })
    })
  }, [rooms, rentals, invoices, today, propertyId, order, lookups])
  const rangeEnd = addDays(startDate, days - 1)

  return (
    <Card>
      <div className="p-5 border-b border-border space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Urutan" className="w-full sm:w-auto">
            <div className="inline-flex w-full sm:w-auto items-center rounded-md border border-border bg-surface p-0.5">
              {([
                { value: 'room' as const, label: 'Nomor kamar', icon: List },
                { value: 'due' as const, label: 'Jatuh tempo', icon: AlarmClock },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={order === option.value}
                  onClick={() => setOrder(option.value)}
                  className={cn(
                    'focus-ring flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] px-3 text-xs font-bold transition sm:flex-none',
                    order === option.value ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <option.icon className="h-4 w-4" /> {option.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Pilih tanggal" className="w-44">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Hari yang tampil" className="w-32">
            <Select
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={[7, 14, 21, 30].map((d) => ({ value: String(d), label: `${d} hari` }))}
            />
          </Field>
          <Field label="Properti" className="w-56">
            <Select
              value={propertyId}
              onChange={setPropertyId}
              placeholder="Semua properti"
              options={[{ value: '', label: 'Semua properti' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <p>{order === 'due' ? 'Baris paling mendesak tampil lebih dulu; panjang bar tetap menunjukkan durasi sewa.' : 'Kamar diurutkan natural per properti; warna menunjukkan status hunian.'}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {order === 'due' ? (
              <>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-danger" /> Hari ini / terlambat</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-warning" /> 1–7 hari lagi</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-success" /> Lebih dari 7 hari</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-muted-foreground/55" /> Tanpa jatuh tempo</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-success" /> Terisi · Lunas</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-danger" /> Menunggak</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-warning" /> Dipesan · DP</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-primary/60" /> Dipesan · Lunas</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded border border-dashed border-border bg-muted" /> Kosong</span>
              </>
            )}
          </div>
        </div>
      </div>

      {scheduleRows.length === 0 ? (
        <EmptyState icon={DoorOpen} title="Belum ada kamar" description="Tambahkan kamar terlebih dahulu untuk melihat jadwal." />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* header */}
            <div className="flex border-b border-border bg-muted/50 sticky top-0 z-10">
              {/* sticky so the room stays identifiable while the timeline is
                  scrolled sideways — the normal case on a phone. */}
              <div className={cn(
                'shrink-0 sticky left-0 z-20 bg-muted px-3 sm:px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border',
                order === 'due' ? 'w-40 sm:w-52' : 'w-28 sm:w-44',
              )}>
                {order === 'due' ? 'Kamar · Jatuh tempo' : 'Kamar'}
              </div>
              {dates.map((d) => {
                const dt = parseISO(d)
                const isToday = d === today
                const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
                return (
                  <div
                    key={d}
                    className={cn(
                      'w-[52px] shrink-0 px-1 py-2 text-center border-r border-border/60',
                      isWeekend && 'bg-muted',
                      isToday && 'bg-primary-soft',
                    )}
                  >
                    <p className={cn('text-[10px] font-semibold', isToday ? 'text-primary' : 'text-muted-foreground')}>
                      {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][dt.getDay()]}
                    </p>
                    <p className={cn('text-xs font-bold tabular-nums mt-0.5', isToday && 'text-primary')}>{dt.getDate()}</p>
                  </div>
                )
              })}
            </div>

            {/* rows */}
            {scheduleRows.map(({ room, due }) => {
              const roomRentals = rentals.filter(
                (r) => r.roomId === room.id && (r.status === 'active' || r.status === 'booked' || r.status === 'ended') &&
                  r.startDate <= rangeEnd && (!r.endDate || r.endDate >= startDate),
              )
              const rowDueMeta = scheduleDueMeta(due, today)
              return (
                <div key={room.id} className="flex border-b border-border/60 hover:bg-muted/20 transition">
                  <div className={cn(
                    'shrink-0 sticky left-0 z-10 bg-surface px-3 sm:px-4 py-3 border-r border-border',
                    order === 'due' ? 'w-40 sm:w-52' : 'w-28 sm:w-44',
                  )}>
                    <p className="font-semibold text-sm truncate">{room.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{lookups.propertyName(room.propertyId)}</p>
                    {order === 'due' && (
                      <div className={cn('mt-1.5 flex items-center gap-1.5 text-[10px] font-bold', rowDueMeta.text)}>
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', rowDueMeta.dot)} />
                        <span className="truncate">{rowDueMeta.label}{due ? ` · ${formatDate(due.date)}` : ''}</span>
                      </div>
                    )}
                  </div>
                  <div className="relative flex">
                    {dates.map((d) => {
                      const dt = parseISO(d)
                      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
                      return (
                        <div
                          key={d}
                          className={cn('w-[52px] shrink-0 border-r border-border/40', order === 'due' ? 'h-[70px]' : 'h-[58px]', isWeekend && 'bg-muted/40')}
                        />
                      )
                    })}
                    {roomRentals.map((r) => {
                      const from = r.startDate < startDate ? startDate : r.startDate
                      const to = r.endDate && r.endDate < rangeEnd ? r.endDate : rangeEnd
                      const offset = Math.max(0, daysBetween(startDate, from))
                      const width = Math.max(1, daysBetween(from, to) + 1)
                      const future = r.startDate > today
                      const late = r.status === 'active' && invoices.some((i) => i.rentalId === r.id && i.status !== 'batal' && i.dueDate < today && i.total > i.paidAmount)
                      const rentalDue = nextDueOfRental(r, invoices)
                      const rentalDueMeta = scheduleDueMeta(rentalDue, today)
                      const title = `${lookups.tenantName(r.tenantId)} · ${formatDate(r.startDate)} — ${r.endDate ? formatDate(r.endDate) : 'sekarang'}`
                      return (
                        <div
                          key={r.id}
                          className={cn(
                            'absolute top-2 h-[42px] rounded-md flex items-center px-2.5 text-xs font-semibold shadow-xs overflow-hidden',
                            order === 'due'
                              ? rentalDueMeta.bar
                              : r.status === 'booked' ? 'bg-warning text-accent-foreground'
                                : r.status === 'ended' ? 'bg-muted-foreground/50 text-white'
                                  : late ? 'bg-danger text-white'
                                    : future ? 'bg-primary/70 text-white' : 'bg-success text-white',
                          )}
                          style={{ left: offset * 52 + 3, width: width * 52 - 6 }}
                          title={order === 'due' ? `${title} · ${rentalDueMeta.label}${rentalDue ? ` (${formatDate(rentalDue.date)})` : ''}` : title}
                        >
                          <span className="truncate">
                            {lookups.tenantName(r.tenantId)}{order === 'due' ? ` · ${rentalDueMeta.label}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

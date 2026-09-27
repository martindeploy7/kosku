import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlarmClock, Banknote, BedDouble, CalendarRange, DoorOpen, Hourglass, LayoutGrid, List, Pencil, Plus, Trash2, User,
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
                  ...ROOM_CONDITIONS.map((c) => ({ value: c.value, label: c.label, emoji: c.emoji })),
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
                  return (
                    <Card key={room.id} className="p-5 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold truncate">{room.name}</h3>
                            <Tooltip content={`Kondisi: ${cond.label}`}>
                              <span className="text-base leading-none cursor-default">{cond.emoji}</span>
                            </Tooltip>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{lookups.propertyName(room.propertyId)}</p>
                        </div>
                        <Badge tone={st.tone as 'success'}>{st.label}</Badge>
                      </div>

                      {tenant && rental ? (
                        <button
                          onClick={() => navigate(`/tenants/${tenant.id}`)}
                          className="mt-4 w-full flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2.5 text-left hover:bg-muted transition"
                        >
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold truncate">{tenant.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {rental.status === 'booked' ? `Masuk ${formatDate(rental.startDate)}` : `Sejak ${formatDate(rental.startDate)}`}
                            </p>
                          </div>
                          {due && <DueChip due={due} today={today} />}
                        </button>
                      ) : (
                        <div className="mt-4 rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground text-center">
                          Belum ada penyewa
                        </div>
                      )}

                      <div className="mt-4 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[11px] text-muted-foreground font-semibold">Harga per bulan</p>
                          <p className="font-extrabold tabular-nums">{formatIDR(room.price.monthly)}</p>
                          {pendingPrice(room.id) && (
                            <Tooltip content={pendingPrice(room.id)!.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`).join(' · ')}>
                              <p className="text-[11px] font-semibold text-warning mt-0.5">Harga baru menunggu persetujuan</p>
                            </Tooltip>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Select
                            className="h-8 w-[118px] text-xs"
                            value={room.condition}
                            onChange={(v) => {
                              void run(() => actions.updateRoom(room.id, { condition: v as Room['condition'] }), { success: `Kondisi ${room.name} diperbarui` })
                            }}
                            options={ROOM_CONDITIONS.map((c) => ({ value: c.value, label: `${c.emoji} ${c.label}` }))}
                          />
                          <Button size="icon" variant="ghost" onClick={() => openEdit(room)} aria-label="Edit kamar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
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
                        <Td><Badge tone={cond.tone as 'info'}>{cond.emoji} {cond.label}</Badge></Td>
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

  const dates = React.useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate, days],
  )

  const visibleRooms = sortRooms(rooms, lookups.propertyName).filter((r) => !propertyId || r.propertyId === propertyId)
  const rangeEnd = addDays(startDate, days - 1)

  return (
    <Card>
      <div className="p-5 border-b border-border flex flex-wrap items-end gap-4">
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
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-success" /> Terisi · Lunas</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-danger" /> Menunggak</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-warning" /> Dipesan · DP</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-primary/60" /> Dipesan · Lunas</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded border border-dashed border-border bg-muted" /> Kosong</span>
        </div>
      </div>

      {visibleRooms.length === 0 ? (
        <EmptyState icon={DoorOpen} title="Belum ada kamar" description="Tambahkan kamar terlebih dahulu untuk melihat jadwal." />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* header */}
            <div className="flex border-b border-border bg-muted/50 sticky top-0 z-10">
              {/* sticky so the room stays identifiable while the timeline is
                  scrolled sideways — the normal case on a phone. */}
              <div className="w-28 sm:w-44 shrink-0 sticky left-0 z-20 bg-muted px-3 sm:px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border">
                Kamar
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
            {visibleRooms.map((room) => {
              const roomRentals = rentals.filter(
                (r) => r.roomId === room.id && (r.status === 'active' || r.status === 'booked' || r.status === 'ended') &&
                  r.startDate <= rangeEnd && (!r.endDate || r.endDate >= startDate),
              )
              return (
                <div key={room.id} className="flex border-b border-border/60 hover:bg-muted/20 transition">
                  <div className="w-28 sm:w-44 shrink-0 sticky left-0 z-10 bg-surface px-3 sm:px-4 py-3 border-r border-border">
                    <p className="font-semibold text-sm truncate">{room.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{lookups.propertyName(room.propertyId)}</p>
                  </div>
                  <div className="relative flex">
                    {dates.map((d) => {
                      const dt = parseISO(d)
                      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
                      return (
                        <div
                          key={d}
                          className={cn('w-[52px] h-[58px] shrink-0 border-r border-border/40', isWeekend && 'bg-muted/40')}
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
                      return (
                        <div
                          key={r.id}
                          className={cn(
                            'absolute top-2 h-[42px] rounded-md flex items-center px-2.5 text-white text-xs font-semibold shadow-xs overflow-hidden',
                            r.status === 'booked' ? 'bg-warning' : r.status === 'ended' ? 'bg-muted-foreground/50' : late ? 'bg-danger' : future ? 'bg-primary/70' : 'bg-success',
                          )}
                          style={{ left: offset * 52 + 3, width: width * 52 - 6 }}
                          title={`${lookups.tenantName(r.tenantId)} · ${formatDate(r.startDate)} — ${r.endDate ? formatDate(r.endDate) : 'sekarang'}`}
                        >
                          <span className="truncate">{lookups.tenantName(r.tenantId)}</span>
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

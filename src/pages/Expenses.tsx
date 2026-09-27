import * as React from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts'
import { FileSpreadsheet, Paperclip, Plus, Repeat, Trash2, Wallet } from 'lucide-react'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState,
  Field, Pagination, SearchInput, Select, Table, Td, Th, Tr,
} from '@/components/ui'
import { PageHeader, StatCard, Tabs } from '@/components/shared'
import { ExpenseFormModal } from '@/components/modals/FormModals'
import { ChartTooltip } from '@/pages/Dashboard'
import { CHART_COLORS, EXPENSE_CATEGORIES } from '@/lib/constants'
import { exportToExcel } from '@/lib/export'
import { expenseCategoryTotals, useLookups } from '@/lib/selectors'
import { actions } from '@/lib/actions'
import { fileUrl } from '@/lib/api'
import { companyName, useCanDelete, useNeedsApproval, useStore } from '@/lib/store'
import type { Expense } from '@/lib/types'
import { formatDate, formatIDR, monthLabel, parseISO, sum } from '@/lib/utils'


export default function Expenses() {
  const { expenses, properties, rooms } = useStore()
  const run = useStore((s) => s.run)
  const canDelete = useCanDelete()
  const needsApproval = useNeedsApproval()
  const lookups = useLookups()

  const [modalOpen, setModalOpen] = React.useState(false)
  const [tab, setTab] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [year, setYear] = React.useState(String(new Date().getFullYear()))
  const [propertyId, setPropertyId] = React.useState('')
  const [month, setMonth] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [roomId, setRoomId] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<Expense | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  const years = React.useMemo(() => {
    const set = new Set(expenses.map((e) => e.date.slice(0, 4)))
    set.add(String(new Date().getFullYear()))
    return [...set].sort().reverse()
  }, [expenses])

  const filtered = React.useMemo(
    () =>
      expenses
        .filter((e) => {
          if (tab === 'recurring' && !e.recurring) return false
          if (year && e.date.slice(0, 4) !== year) return false
          if (month && e.date.slice(5, 7) !== month) return false
          if (propertyId && e.propertyId !== propertyId) return false
          if (category && e.category !== category) return false
          if (roomId && e.roomId !== roomId) return false
          if (query && !`${e.name} ${e.category}`.toLowerCase().includes(query.toLowerCase())) return false
          return true
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [expenses, tab, year, month, propertyId, category, roomId, query],
  )

  const yearExpenses = expenses.filter((e) => e.date.slice(0, 4) === year)
  const total = sum(yearExpenses, (e) => e.total)
  const categoryTotals = expenseCategoryTotals(yearExpenses)
  const topCategory = categoryTotals[0]

  const monthlySeries = React.useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`
      const row: Record<string, string | number> = {
        label: monthLabel(m, Number(year)).split(' ')[0],
      }
      properties.forEach((p) => {
        row[p.name] = sum(
          expenses.filter((e) => e.propertyId === p.id && e.date.slice(0, 7) === key),
          (e) => e.total,
        )
      })
      return row
    })
  }, [expenses, properties, year])

  const propertyTotals = properties
    .map((p) => ({
      name: p.name,
      value: sum(yearExpenses.filter((e) => e.propertyId === p.id), (e) => e.total),
    }))
    .filter((p) => p.value > 0)

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  const handleExport = () => {
    exportToExcel(
      filtered,
      [
        { header: 'Tanggal', accessor: (e) => formatDate(e.date) },
        { header: 'Nama', accessor: (e) => e.name },
        { header: 'Kategori', accessor: (e) => e.category },
        { header: 'Properti', accessor: (e) => lookups.propertyName(e.propertyId) },
        { header: 'Kamar', accessor: (e) => lookups.roomName(e.roomId) },
        { header: 'Berulang', accessor: (e) => e.recurring ? ({ weekly: 'Mingguan', monthly: 'Bulanan', yearly: 'Tahunan' }[e.recurrence ?? 'monthly']) : e.recurrenceParentId ? 'Otomatis' : 'Tidak' },
        { header: 'Jumlah', accessor: (e) => e.total, align: 'right' },
      ],
      { title: 'Laporan Pengeluaran', filename: `pengeluaran-${year}`, period: `Tahun ${year}`, company: companyName() },
    )
  }

  return (
    <>
      <PageHeader
        title="Pengeluaran"
        description="Catat dan analisis seluruh biaya operasional properti Anda."
        actions={
          <>
            <Button variant="outline" onClick={handleExport}>
              <FileSpreadsheet className="h-4 w-4" /> Ekspor Excel
            </Button>
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" /> Tambahkan biaya
            </Button>
          </>
        }
      />

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard label={`Total pengeluaran ${year}`} value={formatIDR(total, { compact: true })} sublabel={`${yearExpenses.length} transaksi`} icon={Wallet} tone="danger" />
        <StatCard
          label="Kategori terbesar"
          value={topCategory?.name ?? '—'}
          sublabel={topCategory ? formatIDR(topCategory.value) : 'Belum ada data'}
          icon={Paperclip}
          tone="warning"
        />
        <StatCard
          label="Pengeluaran berulang"
          value={expenses.filter((e) => e.recurring).length}
          sublabel="transaksi rutin"
          icon={Repeat}
          tone="info"
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 mb-6 items-start">
        <Card>
          <CardHeader><CardTitle>Grafik pengeluaran {year}</CardTitle></CardHeader>
          <CardContent>
            {total === 0 ? (
              <EmptyState icon={Wallet} title="Belum ada pengeluaran" description={`Tidak ada data untuk tahun ${year}.`} />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => formatIDR(v, { compact: true })} tickLine={false} axisLine={false} width={70} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                  <Legend iconType="circle" iconSize={8} />
                  {properties.map((p, i) => (
                    <Bar key={p.id} dataKey={p.name} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={i === properties.length - 1 ? [6, 6, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Proporsi properti</CardTitle></CardHeader>
            <CardContent>
              {propertyTotals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Tidak ada data</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={propertyTotals} dataKey="value" innerRadius={42} outerRadius={64} paddingAngle={2} stroke="none">
                        {propertyTotals.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <RTooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-3">
                    {propertyTotals.map((p, i) => (
                      <div key={p.name} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="truncate text-muted-foreground">{p.name}</span>
                        </span>
                        <span className="font-bold tabular-nums shrink-0">{formatIDR(p.value, { compact: true })}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Perbandingan kategori</CardTitle></CardHeader>
            <CardContent>
              {categoryTotals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Tidak ada data</p>
              ) : (
                <div className="space-y-2.5">
                  {categoryTotals.slice(0, 6).map((c, i) => {
                    const pct = Math.round((c.value / total) * 100)
                    return (
                      <div key={c.name}>
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span className="truncate text-muted-foreground">{c.name}</span>
                          <span className="font-bold tabular-nums shrink-0">{formatIDR(c.value, { compact: true })}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              variant="pill"
              value={tab}
              onChange={(v) => { setTab(v); setPage(1) }}
              tabs={[
                { value: 'all', label: `Semua (${expenses.length})` },
                { value: 'recurring', label: `Berulang (${expenses.filter((e) => e.recurring).length})` },
              ]}
            />
            <SearchInput value={query} onChange={(v) => { setQuery(v); setPage(1) }} placeholder="Cari transaksi..." className="flex-1 min-w-[200px]" />
          </div>

          <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Field label="Tahun">
              <Select value={year} onChange={(v) => { setYear(v); setPage(1) }} options={years.map((y) => ({ value: y, label: y }))} />
            </Field>
            <Field label="Properti">
              <Select
                value={propertyId} onChange={(v) => { setPropertyId(v); setPage(1) }}
                placeholder="Semua properti"
                options={[{ value: '', label: 'Semua properti' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Field>
            <Field label="Bulan">
              <Select
                value={month} onChange={(v) => { setMonth(v); setPage(1) }}
                placeholder="Semua bulan"
                options={[
                  { value: '', label: 'Semua bulan' },
                  ...Array.from({ length: 12 }, (_, i) => ({
                    value: String(i + 1).padStart(2, '0'),
                    label: monthLabel(i, Number(year), false).split(' ')[0],
                  })),
                ]}
              />
            </Field>
            <Field label="Kategori">
              <Select
                value={category} onChange={(v) => { setCategory(v); setPage(1) }}
                placeholder="Semua kategori"
                options={[{ value: '', label: 'Semua kategori' }, ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))]}
              />
            </Field>
            <Field label="Kamar">
              <Select
                value={roomId} onChange={(v) => { setRoomId(v); setPage(1) }}
                placeholder="Semua kamar"
                options={[
                  { value: '', label: 'Semua kamar' },
                  ...rooms.filter((r) => !propertyId || r.propertyId === propertyId).map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </Field>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Tidak ada pengeluaran ditemukan"
            description="Ubah filter atau catat pengeluaran baru."
            action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Tambahkan biaya</Button>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Tanggal</Th>
                  <Th>Nama</Th>
                  <Th>Kategori</Th>
                  <Th>Properti</Th>
                  <Th>Kamar</Th>
                  <Th align="right">Jumlah</Th>
                  <Th align="center">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {paged.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-sm">{formatDate(e.date)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{e.name}</span>
                        {e.recurring && <Badge tone="info"><Repeat className="h-3 w-3" /> {{ weekly: 'Mingguan', monthly: 'Bulanan', yearly: 'Tahunan' }[e.recurrence ?? 'monthly']}</Badge>}
                        {e.recurrenceParentId && <Badge tone="muted"><Repeat className="h-3 w-3" /> Otomatis</Badge>}
                      </div>
                      {e.items.length > 1 && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{e.items.length} item</p>
                      )}
                    </Td>
                    <Td><Badge tone="muted">{e.category}</Badge></Td>
                    <Td className="text-sm text-muted-foreground truncate max-w-[160px]">{lookups.propertyName(e.propertyId)}</Td>
                    <Td className="text-sm text-muted-foreground">{lookups.roomName(e.roomId)}</Td>
                    <Td align="right" className="font-bold tabular-nums text-danger whitespace-nowrap">{formatIDR(e.total)}</Td>
                    <Td align="center">
                      <div className="flex items-center justify-center gap-0.5">
                        {e.attachment && (
                          <a href={fileUrl(e.attachment)} target="_blank" rel="noreferrer">
                            <Button size="icon" variant="ghost" aria-label="Lihat nota"><Paperclip className="h-4 w-4" /></Button>
                          </a>
                        )}
                        {canDelete && (
                          <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(e)} aria-label="Hapus">
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={5} className="font-bold text-sm">Total ditampilkan</Td>
                  <Td align="right" className="font-extrabold tabular-nums text-danger">{formatIDR(sum(filtered, (e) => e.total))}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}
      </Card>

      <ExpenseFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(reason) => {
          if (deleteTarget) void run(() => actions.deleteExpense(deleteTarget.id, reason), { success: 'Pengeluaran dipindahkan ke tempat sampah' })
        }}
        approval={needsApproval}
        title="Hapus pengeluaran?"
        confirmLabel="Hapus"
        message={`"${deleteTarget?.name}" dipindahkan ke tempat sampah dan dapat dipulihkan superadmin.`}
      />
    </>
  )
}

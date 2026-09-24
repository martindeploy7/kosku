import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts'
import { AlertTriangle, FileDown, FileSpreadsheet, Send } from 'lucide-react'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field,
  Pagination, Select, Table, Td, Th, Tr,
} from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { ChartTooltip } from '@/pages/Dashboard'
import { CHART_COLORS, INVOICE_STATUSES, PERIOD_OPTIONS, REPORT_CATALOGUE, rentTypeLabel } from '@/lib/constants'
import { exportToExcel, exportToPDF, type ExportColumn } from '@/lib/export'
import {
  inRange, outstanding, paidAmount, periodRange, averageSettlementDays, type LedgerEntry,
} from '@/lib/finance'
import { buildLedger, useLookups } from '@/lib/selectors'
import { companyName, useStore } from '@/lib/store'
import { isCurrentRental, isOccupiedStatus } from '@/lib/finance'
import { ROOM_STATUSES } from '@/lib/constants'
import { daysBetween, formatDate, formatIDR, sum, todayISO } from '@/lib/utils'

interface Column<T> {
  header: string
  cell: (row: T) => React.ReactNode
  value: (row: T) => string | number
  align?: 'left' | 'right' | 'center'
}

export default function ReportDetail() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const store = useStore()
  const lookups = useLookups()

  const meta = REPORT_CATALOGUE.flatMap((g) => g.items).find((i) => i.slug === slug)
  const [period, setPeriod] = React.useState('month')
  const [propertyId, setPropertyId] = React.useState('')
  const [submitted, setSubmitted] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  React.useEffect(() => {
    setSubmitted(false)
    setPage(1)
  }, [slug])

  if (!meta) {
    return (
      <Card>
        <EmptyState
          icon={AlertTriangle}
          title="Laporan tidak ditemukan"
          action={<Button onClick={() => navigate('/reports')}>Kembali ke daftar laporan</Button>}
        />
      </Card>
    )
  }

  const noPeriod = slug === 'occupancy'
  const { from, to } = periodRange(period)
  const periodLabel = noPeriod
    ? 'Kondisi saat ini'
    : period === 'all'
      ? 'Semua waktu'
      : `${formatDate(from, 'long')} — ${formatDate(to, 'long')}`

  const matchProperty = (pid: string) => !propertyId || pid === propertyId

  /* ------------------------------------------------------------------ data */

  const ledger = React.useMemo(
    () =>
      buildLedger(store.payments, store.expenses, {
        propertyName: lookups.propertyName,
        roomName: lookups.roomName,
        tenantName: lookups.tenantName,
        invoiceNumber: lookups.invoiceNumber,
      }).filter((e) => matchProperty(e.propertyId) && inRange(e.date, from, to)),
    [store.payments, store.expenses, from, to, propertyId, lookups], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const report = React.useMemo(() => buildReport(slug, { store, lookups, ledger, from, to, propertyId, matchProperty }), // eslint-disable-line react-hooks/exhaustive-deps
    [slug, store, ledger, from, to, propertyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = report.rows as Record<string, unknown>[]
  const columns = report.columns as Column<Record<string, unknown>>[]
  const paged = rows.slice((page - 1) * pageSize, page * pageSize)

  const exportColumns: ExportColumn<Record<string, unknown>>[] = columns.map((c) => ({
    header: c.header,
    accessor: c.value,
    align: c.align,
  }))

  const exportMeta = {
    title: meta.title,
    company: companyName(),
    period: periodLabel,
    filename: `${slug}-${todayISO()}`,
  }

  return (
    <>
      <PageHeader
        title={meta.title}
        description={meta.desc}
        breadcrumb={[{ label: 'Laporan', to: '/reports' }, { label: meta.title }]}
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end gap-4">
            {!noPeriod && (
              <Field label="Periode" className="w-48">
                <Select value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
              </Field>
            )}
            <Field label="Properti" className="w-56">
              <Select
                value={propertyId}
                onChange={setPropertyId}
                placeholder="Semua properti"
                options={[{ value: '', label: 'Semua properti' }, ...store.properties.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Field>
            <Button onClick={() => { setSubmitted(true); setPage(1) }} className="mb-[1px]">
              <Send className="h-4 w-4" /> Tampilkan laporan
            </Button>
          </div>
        </CardContent>
      </Card>

      {!submitted ? (
        <Card>
          <EmptyState
            icon={FileDown}
            title="Atur filter lalu tampilkan laporan"
            description="Pilih periode dan properti yang ingin dianalisis, kemudian klik Tampilkan laporan."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* summary cards */}
          {report.summary && report.summary.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {report.summary.map((s) => (
                <Card key={s.label} className="p-5">
                  <p className="text-xs font-semibold text-muted-foreground truncate">{s.label}</p>
                  <p className={`text-xl font-extrabold tracking-tight mt-1.5 tabular-nums truncate ${s.tone ?? ''}`}>{s.value}</p>
                </Card>
              ))}
            </div>
          )}

          {/* charts */}
          {report.charts && report.charts.length > 0 && (
            <div className={`grid gap-6 ${report.charts.length > 1 ? 'lg:grid-cols-2' : ''}`}>
              {report.charts.map((chart) => (
                <Card key={chart.title}>
                  <CardHeader><CardTitle>{chart.title}</CardTitle></CardHeader>
                  <CardContent>{chart.render()}</CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* table */}
          <Card>
            <div className="p-5 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">{meta.title}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {companyName()} · {periodLabel} · {rows.length} baris
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="dark" size="sm" onClick={() => exportToPDF(rows, exportColumns, exportMeta)}>
                  <FileDown className="h-3.5 w-3.5" /> Export PDF
                </Button>
                <Button variant="success" size="sm" onClick={() => exportToExcel(rows, exportColumns, exportMeta)}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
                </Button>
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState icon={AlertTriangle} title="Tidak ada data" description="Tidak ada transaksi pada periode dan properti yang dipilih." />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <Th key={c.header} align={c.align}>{c.header}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((row, i) => (
                      <Tr key={i}>
                        {columns.map((c) => (
                          <Td key={c.header} align={c.align}>{c.cell(row)}</Td>
                        ))}
                      </Tr>
                    ))}
                  </tbody>
                  {report.footer && (
                    <tfoot>
                      <tr>
                        {report.footer.map((f, i) => (
                          <Td key={i} align={f.align} className="font-extrabold">{f.content}</Td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </Table>
                <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
              </>
            )}
          </Card>

          {/* extra sections (balance sheet) */}
          {report.sections?.map((section) => (
            <Card key={section.title}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{section.title}</CardTitle>
                <Badge tone={section.tone as 'success'}>{formatIDR(section.total)}</Badge>
              </CardHeader>
              {section.rows.length === 0 ? (
                <EmptyState icon={AlertTriangle} title="Tidak ada data" className="py-8" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Tanggal</Th>
                      <Th>Deskripsi</Th>
                      <Th>Kategori</Th>
                      <Th>Properti</Th>
                      <Th align="right">Debit</Th>
                      <Th align="right">Kredit</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((r) => (
                      <Tr key={r.id}>
                        <Td className="text-sm whitespace-nowrap">{formatDate(r.date)}</Td>
                        <Td className="text-sm">{r.description}</Td>
                        <Td><Badge tone="muted">{r.category}</Badge></Td>
                        <Td className="text-sm text-muted-foreground truncate max-w-[150px]">{r.propertyName}</Td>
                        <Td align="right" className="tabular-nums text-sm">{r.debit ? formatIDR(r.debit) : '—'}</Td>
                        <Td align="right" className="tabular-nums text-sm">{r.credit ? formatIDR(r.credit) : '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ report builders */

interface BuildCtx {
  store: ReturnType<typeof useStore.getState>
  lookups: ReturnType<typeof useLookups>
  ledger: LedgerEntry[]
  from: string
  to: string
  propertyId: string
  matchProperty: (pid: string) => boolean
}

interface ReportResult {
  rows: unknown[]
  columns: Column<never>[]
  summary?: { label: string; value: string; tone?: string }[]
  charts?: { title: string; render: () => React.ReactNode }[]
  footer?: { content: React.ReactNode; align?: 'left' | 'right' | 'center' }[]
  sections?: { title: string; rows: LedgerEntry[]; total: number; tone: string }[]
}

function buildReport(slug: string, ctx: BuildCtx): ReportResult {
  const { store, lookups, ledger, from, to, propertyId, matchProperty } = ctx
  const { payments, invoices, expenses, tenants, rentals, rooms, properties } = store

  const money = (v: number) => <span className="tabular-nums">{formatIDR(v)}</span>

  switch (slug) {
    /* ---------------- Keuangan ---------------- */
    case 'cash-flow': {
      const rows = ledger
      const inflow = sum(rows, (r) => r.credit)
      const outflow = sum(rows, (r) => r.debit)
      return {
        rows,
        columns: [
          { header: 'Tanggal', cell: (r: LedgerEntry) => formatDate(r.date), value: (r: LedgerEntry) => formatDate(r.date) },
          { header: 'Deskripsi', cell: (r: LedgerEntry) => r.description, value: (r: LedgerEntry) => r.description },
          { header: 'Properti', cell: (r: LedgerEntry) => r.propertyName, value: (r: LedgerEntry) => r.propertyName },
          { header: 'Penyewa', cell: (r: LedgerEntry) => r.tenantName, value: (r: LedgerEntry) => r.tenantName },
          {
            header: 'Tipe',
            cell: (r: LedgerEntry) => (
              <Badge tone={r.kind === 'income' ? 'success' : 'danger'}>
                {r.kind === 'income' ? 'Uang Masuk' : 'Uang Keluar'}
              </Badge>
            ),
            value: (r: LedgerEntry) => (r.kind === 'income' ? 'Uang Masuk' : 'Uang Keluar'),
          },
          {
            header: 'Jumlah', align: 'right',
            cell: (r: LedgerEntry) => (
              <span className={r.credit ? 'text-success font-bold tabular-nums' : 'text-danger font-bold tabular-nums'}>
                {formatIDR(r.credit || r.debit)}
              </span>
            ),
            value: (r: LedgerEntry) => r.credit || r.debit,
          },
        ] as Column<never>[],
        summary: [
          { label: 'Uang masuk', value: formatIDR(inflow), tone: 'text-success' },
          { label: 'Uang keluar', value: formatIDR(outflow), tone: 'text-danger' },
          { label: 'Arus kas bersih', value: formatIDR(inflow - outflow), tone: inflow - outflow >= 0 ? 'text-success' : 'text-danger' },
          { label: 'Jumlah transaksi', value: String(rows.length) },
        ],
        charts: [
          {
            title: 'Uang masuk vs uang keluar',
            render: () => (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={[{ name: 'Uang Masuk', value: inflow }, { name: 'Uang Keluar', value: outflow }]}
                    dataKey="value" innerRadius={52} outerRadius={80} paddingAngle={3} stroke="none"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <RTooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            ),
          },
          {
            title: 'Transaksi per properti',
            render: () => {
              const data = properties.filter((p) => matchProperty(p.id)).map((p) => ({
                name: p.name,
                masuk: sum(ledger.filter((l) => l.propertyId === p.id), (l) => l.credit),
                keluar: sum(ledger.filter((l) => l.propertyId === p.id), (l) => l.debit),
              }))
              return (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => formatIDR(v, { compact: true })} tickLine={false} axisLine={false} width={64} />
                    <RTooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                    <Legend iconType="circle" iconSize={8} />
                    <Bar dataKey="masuk" name="Uang masuk" fill="#10b981" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="keluar" name="Uang keluar" fill="#ef4444" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )
            },
          },
        ],
      }
    }

    case 'profit-loss': {
      // Revenue only: deposits and unearned DP are money held for tenants (liabilities), not profit.
      const incomeRows = ledger.filter((l) => l.kind === 'income' && l.section === 'ekuitas')
      const expenseRows = ledger.filter((l) => l.kind === 'expense')
      const byCat = (list: LedgerEntry[]) => {
        const map = new Map<string, number>()
        list.forEach((l) => map.set(l.category, (map.get(l.category) ?? 0) + (l.credit || l.debit)))
        return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      }
      const incomeCats = byCat(incomeRows)
      const expenseCats = byCat(expenseRows)
      const totalIncome = sum(incomeRows, (l) => l.credit)
      const totalExpense = sum(expenseRows, (l) => l.debit)

      const rows = [
        ...incomeCats.map((c) => ({ section: 'Pendapatan', name: c.name, amount: c.value })),
        { section: 'Pendapatan', name: 'Total Pemasukan', amount: totalIncome, isTotal: true },
        ...expenseCats.map((c) => ({ section: 'Pengeluaran', name: c.name, amount: c.value })),
        { section: 'Pengeluaran', name: 'Total Pengeluaran', amount: totalExpense, isTotal: true },
        { section: 'Ringkasan', name: 'Laba Bersih', amount: totalIncome - totalExpense, isTotal: true },
      ]

      return {
        rows,
        columns: [
          { header: 'Bagian', cell: (r: { section: string }) => <Badge tone="muted">{r.section}</Badge>, value: (r: { section: string }) => r.section },
          {
            header: 'Kategori',
            cell: (r: { name: string; isTotal?: boolean }) => <span className={r.isTotal ? 'font-extrabold' : ''}>{r.name}</span>,
            value: (r: { name: string }) => r.name,
          },
          {
            header: 'Jumlah', align: 'right',
            cell: (r: { amount: number; isTotal?: boolean; name: string }) => (
              <span className={`tabular-nums ${r.isTotal ? 'font-extrabold' : ''} ${r.name === 'Laba Bersih' ? (r.amount >= 0 ? 'text-success' : 'text-danger') : ''}`}>
                {formatIDR(r.amount)}
              </span>
            ),
            value: (r: { amount: number }) => r.amount,
          },
        ] as Column<never>[],
        summary: [
          { label: 'Total pemasukan', value: formatIDR(totalIncome), tone: 'text-success' },
          { label: 'Total pengeluaran', value: formatIDR(totalExpense), tone: 'text-danger' },
          { label: 'Laba bersih', value: formatIDR(totalIncome - totalExpense), tone: totalIncome - totalExpense >= 0 ? 'text-success' : 'text-danger' },
          { label: 'Margin', value: totalIncome ? `${Math.round(((totalIncome - totalExpense) / totalIncome) * 100)}%` : '—' },
        ],
        charts: [
          {
            title: 'Pendapatan per kategori',
            render: () => <CategoryPie data={incomeCats} />,
          },
          {
            title: 'Pengeluaran per kategori',
            render: () => <CategoryPie data={expenseCats} />,
          },
        ],
      }
    }

    case 'ledger': {
      let balance = 0
      const rows = ledger.map((l) => {
        balance += l.credit - l.debit
        return { ...l, balance }
      })
      return {
        rows,
        columns: [
          { header: 'Tanggal', cell: (r: LedgerEntry & { balance: number }) => formatDate(r.date), value: (r: LedgerEntry) => formatDate(r.date) },
          { header: 'Deskripsi', cell: (r: LedgerEntry) => r.description, value: (r: LedgerEntry) => r.description },
          { header: 'Properti', cell: (r: LedgerEntry) => r.propertyName, value: (r: LedgerEntry) => r.propertyName },
          { header: 'Kategori', cell: (r: LedgerEntry) => <Badge tone="muted">{r.category}</Badge>, value: (r: LedgerEntry) => r.category },
          { header: 'Debit', align: 'right', cell: (r: LedgerEntry) => (r.debit ? money(r.debit) : '—'), value: (r: LedgerEntry) => r.debit },
          { header: 'Kredit', align: 'right', cell: (r: LedgerEntry) => (r.credit ? money(r.credit) : '—'), value: (r: LedgerEntry) => r.credit },
          {
            header: 'Saldo', align: 'right',
            cell: (r: { balance: number }) => <span className="font-bold tabular-nums">{formatIDR(r.balance)}</span>,
            value: (r: { balance: number }) => r.balance,
          },
        ] as Column<never>[],
        summary: [
          { label: 'Total debit', value: formatIDR(sum(ledger, (l) => l.debit)), tone: 'text-danger' },
          { label: 'Total kredit', value: formatIDR(sum(ledger, (l) => l.credit)), tone: 'text-success' },
          { label: 'Saldo akhir', value: formatIDR(balance), tone: balance >= 0 ? 'text-success' : 'text-danger' },
          { label: 'Jumlah entri', value: String(rows.length) },
        ],
        charts: [
          {
            title: 'Grafik saldo dari waktu ke waktu',
            render: () => (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={rows.map((r) => ({ date: formatDate(r.date), balance: r.balance }))} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v) => formatIDR(v, { compact: true })} tickLine={false} axisLine={false} width={70} />
                  <RTooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="balance" name="Saldo" stroke="#6366f1" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ),
          },
        ],
      }
    }

    case 'balance-sheet': {
      const aset = ledger.filter((l) => l.section === 'aset')
      const liabilitas = ledger.filter((l) => l.section === 'liabilitas')
      const ekuitas = ledger.filter((l) => l.section === 'ekuitas')
      const tot = (list: LedgerEntry[]) => sum(list, (l) => l.credit - l.debit)

      return {
        rows: ledger,
        columns: [
          { header: 'Tanggal', cell: (r: LedgerEntry) => formatDate(r.date), value: (r: LedgerEntry) => formatDate(r.date) },
          { header: 'Deskripsi', cell: (r: LedgerEntry) => r.description, value: (r: LedgerEntry) => r.description },
          {
            header: 'Bagian',
            cell: (r: LedgerEntry) => <Badge tone={r.section === 'aset' ? 'info' : r.section === 'liabilitas' ? 'warning' : 'success'}>{r.section}</Badge>,
            value: (r: LedgerEntry) => r.section,
          },
          { header: 'Kategori', cell: (r: LedgerEntry) => r.category, value: (r: LedgerEntry) => r.category },
          { header: 'Debit', align: 'right', cell: (r: LedgerEntry) => (r.debit ? money(r.debit) : '—'), value: (r: LedgerEntry) => r.debit },
          { header: 'Kredit', align: 'right', cell: (r: LedgerEntry) => (r.credit ? money(r.credit) : '—'), value: (r: LedgerEntry) => r.credit },
        ] as Column<never>[],
        summary: [
          { label: 'Total aset', value: formatIDR(Math.abs(tot(aset))), tone: 'text-info' },
          { label: 'Total liabilitas', value: formatIDR(tot(liabilitas)), tone: 'text-warning' },
          { label: 'Total ekuitas', value: formatIDR(tot(ekuitas)), tone: 'text-success' },
          { label: 'Selisih', value: formatIDR(tot(aset) + tot(liabilitas) + tot(ekuitas)) },
        ],
        sections: [
          { title: 'Aset', rows: aset, total: Math.abs(tot(aset)), tone: 'info' },
          { title: 'Liabilitas', rows: liabilitas, total: tot(liabilitas), tone: 'warning' },
          { title: 'Ekuitas', rows: ekuitas, total: tot(ekuitas), tone: 'success' },
        ],
      }
    }

    /* ---------------- Pembayaran ---------------- */
    case 'income': {
      const rows = payments.filter((p) => p.amount > 0 && matchProperty(p.propertyId) && inRange(p.date, from, to))
      const total = sum(rows, (p) => p.amount)
      return {
        rows,
        columns: [
          { header: 'Tanggal', cell: (p: typeof rows[0]) => formatDate(p.date), value: (p: typeof rows[0]) => formatDate(p.date) },
          { header: 'ID Transaksi', cell: (p: typeof rows[0]) => <span className="font-mono text-xs">{p.transactionId}</span>, value: (p: typeof rows[0]) => p.transactionId },
          { header: 'Penyewa', cell: (p: typeof rows[0]) => lookups.tenantName(p.tenantId), value: (p: typeof rows[0]) => lookups.tenantName(p.tenantId) },
          { header: 'Properti', cell: (p: typeof rows[0]) => lookups.propertyName(p.propertyId), value: (p: typeof rows[0]) => lookups.propertyName(p.propertyId) },
          {
            header: 'Metode',
            cell: (p: typeof rows[0]) => <Badge tone={p.method === 'cash' ? 'accent' : 'info'}>{p.method === 'cash' ? 'Tunai' : 'Transfer'}</Badge>,
            value: (p: typeof rows[0]) => (p.method === 'cash' ? 'Tunai' : 'Transfer'),
          },
          { header: 'Jenis', cell: (p: typeof rows[0]) => <Badge tone="muted">{p.kind === 'rent' ? 'Sewa' : p.kind === 'deposit' ? 'Jaminan' : 'DP'}</Badge>, value: (p: typeof rows[0]) => p.kind },
          { header: 'Jumlah', align: 'right', cell: (p: typeof rows[0]) => <span className="font-bold text-success tabular-nums">{formatIDR(p.amount)}</span>, value: (p: typeof rows[0]) => p.amount },
        ] as Column<never>[],
        summary: [
          { label: 'Total pendapatan', value: formatIDR(total), tone: 'text-success' },
          { label: 'Jumlah transaksi', value: String(rows.length) },
          { label: 'Tunai', value: formatIDR(sum(rows.filter((p) => p.method === 'cash'), (p) => p.amount)) },
          { label: 'Transfer', value: formatIDR(sum(rows.filter((p) => p.method === 'transfer'), (p) => p.amount)) },
        ],
        footer: [
          { content: 'Total' }, { content: '' }, { content: '' }, { content: '' }, { content: '' }, { content: '' },
          { content: formatIDR(total), align: 'right' },
        ],
      }
    }

    case 'expense': {
      const rows = expenses.filter((e) => matchProperty(e.propertyId) && inRange(e.date, from, to))
      const total = sum(rows, (e) => e.total)
      return {
        rows,
        columns: [
          { header: 'Tanggal', cell: (e: typeof rows[0]) => formatDate(e.date), value: (e: typeof rows[0]) => formatDate(e.date) },
          { header: 'Nama', cell: (e: typeof rows[0]) => e.name, value: (e: typeof rows[0]) => e.name },
          { header: 'Kategori', cell: (e: typeof rows[0]) => <Badge tone="muted">{e.category}</Badge>, value: (e: typeof rows[0]) => e.category },
          { header: 'Properti', cell: (e: typeof rows[0]) => lookups.propertyName(e.propertyId), value: (e: typeof rows[0]) => lookups.propertyName(e.propertyId) },
          { header: 'Kamar', cell: (e: typeof rows[0]) => lookups.roomName(e.roomId), value: (e: typeof rows[0]) => lookups.roomName(e.roomId) },
          { header: 'Berulang', cell: (e: typeof rows[0]) => (e.recurring ? <Badge tone="info">Ya</Badge> : '—'), value: (e: typeof rows[0]) => (e.recurring ? 'Ya' : 'Tidak') },
          { header: 'Jumlah', align: 'right', cell: (e: typeof rows[0]) => <span className="font-bold text-danger tabular-nums">{formatIDR(e.total)}</span>, value: (e: typeof rows[0]) => e.total },
        ] as Column<never>[],
        summary: [
          { label: 'Total pengeluaran', value: formatIDR(total), tone: 'text-danger' },
          { label: 'Jumlah transaksi', value: String(rows.length) },
          { label: 'Rata-rata', value: formatIDR(rows.length ? total / rows.length : 0) },
          { label: 'Berulang', value: String(rows.filter((e) => e.recurring).length) },
        ],
      }
    }

    case 'deposit': {
      const rows = payments.filter((p) => p.kind === 'deposit' && matchProperty(p.propertyId) && inRange(p.date, from, to))
      const held = sum(rows.filter((p) => p.amount > 0), (p) => p.amount)
      const returned = Math.abs(sum(rows.filter((p) => p.amount < 0), (p) => p.amount))
      return {
        rows,
        columns: [
          { header: 'Tanggal', cell: (p: typeof rows[0]) => formatDate(p.date), value: (p: typeof rows[0]) => formatDate(p.date) },
          { header: 'Penyewa', cell: (p: typeof rows[0]) => lookups.tenantName(p.tenantId), value: (p: typeof rows[0]) => lookups.tenantName(p.tenantId) },
          { header: 'Properti', cell: (p: typeof rows[0]) => lookups.propertyName(p.propertyId), value: (p: typeof rows[0]) => lookups.propertyName(p.propertyId) },
          {
            header: 'Jenis',
            cell: (p: typeof rows[0]) => <Badge tone={p.amount > 0 ? 'success' : 'warning'}>{p.amount > 0 ? 'Diterima' : 'Dikembalikan'}</Badge>,
            value: (p: typeof rows[0]) => (p.amount > 0 ? 'Diterima' : 'Dikembalikan'),
          },
          { header: 'Catatan', cell: (p: typeof rows[0]) => p.note || '—', value: (p: typeof rows[0]) => p.note },
          { header: 'Jumlah', align: 'right', cell: (p: typeof rows[0]) => money(Math.abs(p.amount)), value: (p: typeof rows[0]) => Math.abs(p.amount) },
        ] as Column<never>[],
        summary: [
          { label: 'Jaminan diterima', value: formatIDR(held), tone: 'text-success' },
          { label: 'Jaminan dikembalikan', value: formatIDR(returned), tone: 'text-warning' },
          { label: 'Saldo jaminan', value: formatIDR(held - returned), tone: 'text-info' },
          { label: 'Jumlah transaksi', value: String(rows.length) },
        ],
      }
    }

    case 'invoices': {
      const rows = invoices.filter((i) => matchProperty(i.propertyId) && inRange(i.periodStart, from, to))
      const total = sum(rows, (i) => i.total)
      const paid = sum(rows, (i) => paidAmount(i.id, payments))
      return {
        rows,
        columns: [
          { header: 'Nomor Faktur', cell: (i: typeof rows[0]) => <span className="font-mono text-xs font-bold">{i.number}</span>, value: (i: typeof rows[0]) => i.number },
          { header: 'Penyewa', cell: (i: typeof rows[0]) => lookups.tenantName(i.tenantId), value: (i: typeof rows[0]) => lookups.tenantName(i.tenantId) },
          { header: 'Kamar', cell: (i: typeof rows[0]) => lookups.roomName(i.roomId), value: (i: typeof rows[0]) => lookups.roomName(i.roomId) },
          { header: 'Periode', cell: (i: typeof rows[0]) => `${formatDate(i.periodStart)} — ${formatDate(i.periodEnd)}`, value: (i: typeof rows[0]) => `${formatDate(i.periodStart)} — ${formatDate(i.periodEnd)}` },
          { header: 'Jatuh Tempo', cell: (i: typeof rows[0]) => formatDate(i.dueDate), value: (i: typeof rows[0]) => formatDate(i.dueDate) },
          {
            header: 'Status',
            cell: (i: typeof rows[0]) => {
              const st = INVOICE_STATUSES.find((s) => s.value === i.status)!
              return <Badge tone={st.tone as 'success'}>{st.label}</Badge>
            },
            value: (i: typeof rows[0]) => INVOICE_STATUSES.find((s) => s.value === i.status)?.label ?? i.status,
          },
          { header: 'Total', align: 'right', cell: (i: typeof rows[0]) => <span className="font-bold tabular-nums">{formatIDR(i.total)}</span>, value: (i: typeof rows[0]) => i.total },
        ] as Column<never>[],
        summary: [
          { label: 'Total tagihan', value: formatIDR(total) },
          { label: 'Sudah dibayar', value: formatIDR(paid), tone: 'text-success' },
          { label: 'Belum dibayar', value: formatIDR(total - paid), tone: 'text-danger' },
          { label: 'Jumlah faktur', value: String(rows.length) },
        ],
      }
    }

    case 'settlement-time': {
      const rows = invoices
        .filter((i) => matchProperty(i.propertyId) && inRange(i.periodStart, from, to))
        .map((i) => {
          const pays = payments.filter((p) => p.invoiceId === i.id)
          const lastPay = pays.map((p) => p.date).sort().at(-1)
          return {
            invoice: i,
            lastPay,
            days: lastPay ? daysBetween(i.dueDate, lastPay) : null,
          }
        })
        .filter((r) => r.lastPay)
      const avg = averageSettlementDays(
        invoices.filter((i) => matchProperty(i.propertyId)),
        payments,
      )
      return {
        rows,
        columns: [
          { header: 'Nomor Faktur', cell: (r: typeof rows[0]) => <span className="font-mono text-xs">{r.invoice.number}</span>, value: (r: typeof rows[0]) => r.invoice.number },
          { header: 'Penyewa', cell: (r: typeof rows[0]) => lookups.tenantName(r.invoice.tenantId), value: (r: typeof rows[0]) => lookups.tenantName(r.invoice.tenantId) },
          { header: 'Jatuh Tempo', cell: (r: typeof rows[0]) => formatDate(r.invoice.dueDate), value: (r: typeof rows[0]) => formatDate(r.invoice.dueDate) },
          { header: 'Tanggal Bayar', cell: (r: typeof rows[0]) => formatDate(r.lastPay!), value: (r: typeof rows[0]) => formatDate(r.lastPay!) },
          {
            header: 'Selisih Hari', align: 'right',
            cell: (r: typeof rows[0]) => (
              <Badge tone={(r.days ?? 0) <= 0 ? 'success' : (r.days ?? 0) <= 3 ? 'warning' : 'danger'}>
                {(r.days ?? 0) <= 0 ? `${Math.abs(r.days ?? 0)} hari lebih awal` : `Telat ${r.days} hari`}
              </Badge>
            ),
            value: (r: typeof rows[0]) => r.days ?? 0,
          },
        ] as Column<never>[],
        summary: [
          { label: 'Rata-rata pelunasan', value: avg === null ? '—' : avg <= 0 ? `${Math.abs(avg)} hari lebih awal` : `Telat ${avg} hari`, tone: (avg ?? 0) <= 0 ? 'text-success' : 'text-warning' },
          { label: 'Faktur terbayar', value: String(rows.length) },
          { label: 'Tepat waktu', value: String(rows.filter((r) => (r.days ?? 0) <= 0).length), tone: 'text-success' },
          { label: 'Terlambat', value: String(rows.filter((r) => (r.days ?? 0) > 0).length), tone: 'text-danger' },
        ],
      }
    }

    case 'overdue': {
      const today = todayISO()
      const rows = rentals
        .filter((r) => r.status === 'active' && matchProperty(r.propertyId))
        .map((r) => {
          const invs = invoices.filter((i) => i.rentalId === r.id && i.dueDate <= today)
          const due = sum(invs, (i) => outstanding(i, payments))
          const oldest = invs.filter((i) => outstanding(i, payments) > 0).map((i) => i.dueDate).sort()[0]
          return { rental: r, due, oldest, count: invs.filter((i) => outstanding(i, payments) > 0).length }
        })
        .filter((r) => r.due > 0)
        .sort((a, b) => b.due - a.due)
      return {
        rows,
        columns: [
          { header: 'Penyewa', cell: (r: typeof rows[0]) => lookups.tenantName(r.rental.tenantId), value: (r: typeof rows[0]) => lookups.tenantName(r.rental.tenantId) },
          { header: 'Kamar', cell: (r: typeof rows[0]) => lookups.roomName(r.rental.roomId), value: (r: typeof rows[0]) => lookups.roomName(r.rental.roomId) },
          { header: 'Properti', cell: (r: typeof rows[0]) => lookups.propertyName(r.rental.propertyId), value: (r: typeof rows[0]) => lookups.propertyName(r.rental.propertyId) },
          { header: 'Faktur Menunggak', align: 'center', cell: (r: typeof rows[0]) => <Badge tone="danger">{r.count}</Badge>, value: (r: typeof rows[0]) => r.count },
          {
            header: 'Terlambat Sejak',
            cell: (r: typeof rows[0]) => (r.oldest ? `${formatDate(r.oldest)} (${daysBetween(r.oldest, today)} hari)` : '—'),
            value: (r: typeof rows[0]) => (r.oldest ? formatDate(r.oldest) : '—'),
          },
          { header: 'Total Tunggakan', align: 'right', cell: (r: typeof rows[0]) => <span className="font-bold text-danger tabular-nums">{formatIDR(r.due)}</span>, value: (r: typeof rows[0]) => r.due },
        ] as Column<never>[],
        summary: [
          { label: 'Total tunggakan', value: formatIDR(sum(rows, (r) => r.due)), tone: 'text-danger' },
          { label: 'Penyewa menunggak', value: String(rows.length) },
          { label: 'Faktur menunggak', value: String(sum(rows, (r) => r.count)) },
          { label: 'Rata-rata tunggakan', value: formatIDR(rows.length ? sum(rows, (r) => r.due) / rows.length : 0) },
        ],
      }
    }

    /* ---------------- Penyewa ---------------- */
    case 'tenants': {
      const rows = tenants.filter((t) => {
        const rental = rentals.find((r) => r.tenantId === t.id)
        if (propertyId && (!rental || rental.propertyId !== propertyId)) return false
        return inRange(t.createdAt.slice(0, 10), from, to) || Boolean(rental)
      })
      return {
        rows,
        columns: [
          { header: 'Nama', cell: (t: typeof rows[0]) => <span className="font-semibold">{t.name}</span>, value: (t: typeof rows[0]) => t.name },
          {
            header: 'Status',
            cell: (t: typeof rows[0]) => {
              const s = lookups.tenantStatus(t.id)
              return <Badge tone={s === 'berjalan' ? 'success' : s === 'belum_sewa' ? 'info' : 'muted'}>{s.replace('_', ' ')}</Badge>
            },
            value: (t: typeof rows[0]) => lookups.tenantStatus(t.id),
          },
          {
            header: 'Kamar',
            cell: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? lookups.roomName(r.roomId) : '—'
            },
            value: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? lookups.roomName(r.roomId) : '—'
            },
          },
          { header: 'Telepon', cell: (t: typeof rows[0]) => t.contacts[0]?.phone ?? '—', value: (t: typeof rows[0]) => t.contacts[0]?.phone ?? '—' },
          { header: 'Pekerjaan', cell: (t: typeof rows[0]) => t.job || '—', value: (t: typeof rows[0]) => t.job },
          {
            header: 'Mulai Sewa',
            cell: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? formatDate(r.startDate) : '—'
            },
            value: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? formatDate(r.startDate) : '—'
            },
          },
        ] as Column<never>[],
        summary: [
          { label: 'Total penyewa', value: String(rows.length) },
          { label: 'Sewa berjalan', value: String(rows.filter((t) => lookups.tenantStatus(t.id) === 'berjalan').length), tone: 'text-success' },
          { label: 'Daftar tunggu', value: String(rows.filter((t) => t.isWaitlist).length), tone: 'text-info' },
          { label: 'Sewa berakhir', value: String(rows.filter((t) => lookups.tenantStatus(t.id) === 'berakhir').length) },
        ],
      }
    }

    case 'tenant-detail': {
      const rows = tenants.filter((t) => {
        const rental = rentals.find((r) => r.tenantId === t.id && isCurrentRental(r))
        return rental && matchProperty(rental.propertyId)
      })
      return {
        rows,
        columns: [
          { header: 'Nama', cell: (t: typeof rows[0]) => <span className="font-semibold">{t.name}</span>, value: (t: typeof rows[0]) => t.name },
          { header: 'No. Identitas', cell: (t: typeof rows[0]) => t.idNumber || '—', value: (t: typeof rows[0]) => t.idNumber },
          { header: 'Gender', cell: (t: typeof rows[0]) => (t.gender === 'male' ? 'Laki-laki' : t.gender === 'female' ? 'Perempuan' : '—'), value: (t: typeof rows[0]) => t.gender },
          { header: 'Tgl Lahir', cell: (t: typeof rows[0]) => (t.dob ? formatDate(t.dob) : '—'), value: (t: typeof rows[0]) => (t.dob ? formatDate(t.dob) : '—') },
          { header: 'Pekerjaan', cell: (t: typeof rows[0]) => t.job || '—', value: (t: typeof rows[0]) => t.job },
          { header: 'Kontak Darurat', cell: (t: typeof rows[0]) => t.emergencyContact || '—', value: (t: typeof rows[0]) => t.emergencyContact },
          { header: 'Email', cell: (t: typeof rows[0]) => t.contacts[0]?.email || '—', value: (t: typeof rows[0]) => t.contacts[0]?.email ?? '' },
          { header: 'Telepon', cell: (t: typeof rows[0]) => t.contacts[0]?.phone ?? '—', value: (t: typeof rows[0]) => t.contacts[0]?.phone ?? '' },
        ] as Column<never>[],
        summary: [
          { label: 'Penyewa aktif', value: String(rows.length) },
          { label: 'Laki-laki', value: String(rows.filter((t) => t.gender === 'male').length) },
          { label: 'Perempuan', value: String(rows.filter((t) => t.gender === 'female').length) },
          { label: 'Data KTP lengkap', value: `${rows.filter((t) => t.idNumber).length}/${rows.length}` },
        ],
      }
    }

    case 'occupancy': {
      const rows = rooms
        .filter((r) => matchProperty(r.propertyId))
        .map((room) => {
          const status = lookups.roomStatus(room.id)
          const rental = rentals.find((r) => r.roomId === room.id && isCurrentRental(r))
          return { room, status, rental }
        })
      const occupied = rows.filter((r) => isOccupiedStatus(r.status)).length
      const available = rows.filter((r) => r.status === 'tersedia').length
      const booked = rows.filter((r) => r.status === 'dipesan' || r.status === 'dipesan_dp').length
      return {
        rows,
        columns: [
          { header: 'Kamar', cell: (r: typeof rows[0]) => <span className="font-semibold">{r.room.name}</span>, value: (r: typeof rows[0]) => r.room.name },
          { header: 'Properti', cell: (r: typeof rows[0]) => lookups.propertyName(r.room.propertyId), value: (r: typeof rows[0]) => lookups.propertyName(r.room.propertyId) },
          {
            header: 'Status',
            cell: (r: typeof rows[0]) => (
              <Badge tone={ROOM_STATUSES.find((s) => s.value === r.status)!.tone as 'success'}>
                {ROOM_STATUSES.find((s) => s.value === r.status)!.label}
              </Badge>
            ),
            value: (r: typeof rows[0]) => ROOM_STATUSES.find((s) => s.value === r.status)!.label,
          },
          { header: 'Kondisi', cell: (r: typeof rows[0]) => r.room.condition, value: (r: typeof rows[0]) => r.room.condition },
          { header: 'Penyewa', cell: (r: typeof rows[0]) => (r.rental ? lookups.tenantName(r.rental.tenantId) : '—'), value: (r: typeof rows[0]) => (r.rental ? lookups.tenantName(r.rental.tenantId) : '—') },
          { header: 'Harga/bulan', align: 'right', cell: (r: typeof rows[0]) => money(r.room.price.monthly), value: (r: typeof rows[0]) => r.room.price.monthly },
        ] as Column<never>[],
        summary: [
          { label: 'Tingkat hunian', value: rows.length ? `${Math.round((occupied / rows.length) * 100)}%` : '0%', tone: 'text-success' },
          { label: 'Kamar terisi', value: `${occupied} / ${rows.length}` },
          { label: 'Kamar tersedia', value: String(available), tone: 'text-info' },
          { label: 'Sudah dipesan', value: String(booked), tone: 'text-warning' },
        ],
        charts: [
          {
            title: 'Distribusi status kamar',
            render: () => (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Sudah disewa', value: occupied },
                      { name: 'Tersedia', value: available },
                      { name: 'Sudah dipesan', value: booked },
                    ].filter((d) => d.value > 0)}
                    dataKey="value" innerRadius={52} outerRadius={80} paddingAngle={3} stroke="none"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#0ea5e9" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <RTooltip />
                  <Legend iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            ),
          },
        ],
      }
    }

    case 'lease-duration': {
      const today = todayISO()
      const rows = rentals
        .filter((r) => matchProperty(r.propertyId))
        .map((r) => {
          const end = r.endDate ?? today
          return { rental: r, days: Math.max(0, daysBetween(r.startDate, end)) }
        })
      const avgDays = rows.length ? Math.round(sum(rows, (r) => r.days) / rows.length) : 0
      return {
        rows,
        columns: [
          { header: 'Penyewa', cell: (r: typeof rows[0]) => lookups.tenantName(r.rental.tenantId), value: (r: typeof rows[0]) => lookups.tenantName(r.rental.tenantId) },
          { header: 'Kamar', cell: (r: typeof rows[0]) => lookups.roomName(r.rental.roomId), value: (r: typeof rows[0]) => lookups.roomName(r.rental.roomId) },
          { header: 'Mulai', cell: (r: typeof rows[0]) => formatDate(r.rental.startDate), value: (r: typeof rows[0]) => formatDate(r.rental.startDate) },
          { header: 'Berakhir', cell: (r: typeof rows[0]) => (r.rental.endDate ? formatDate(r.rental.endDate) : 'Berjalan'), value: (r: typeof rows[0]) => (r.rental.endDate ? formatDate(r.rental.endDate) : 'Berjalan') },
          { header: 'Jenis Sewa', cell: (r: typeof rows[0]) => rentTypeLabel(r.rental.rentType), value: (r: typeof rows[0]) => rentTypeLabel(r.rental.rentType) },
          {
            header: 'Durasi', align: 'right',
            cell: (r: typeof rows[0]) => <span className="font-bold tabular-nums">{r.days} hari</span>,
            value: (r: typeof rows[0]) => r.days,
          },
        ] as Column<never>[],
        summary: [
          { label: 'Rata-rata durasi', value: `${avgDays} hari`, tone: 'text-primary' },
          { label: 'Setara bulan', value: `${(avgDays / 30).toFixed(1)} bulan` },
          { label: 'Sewa aktif', value: String(rows.filter((r) => isCurrentRental(r.rental)).length), tone: 'text-success' },
          { label: 'Sewa berakhir', value: String(rows.filter((r) => r.rental.status === 'ended').length) },
        ],
      }
    }

    case 'vehicles': {
      const rows = tenants
        .filter((t) => {
          if (!t.vehiclePlate) return false
          const rental = rentals.find((r) => r.tenantId === t.id && isCurrentRental(r))
          return !propertyId || (rental && rental.propertyId === propertyId)
        })
      return {
        rows,
        columns: [
          { header: 'Penyewa', cell: (t: typeof rows[0]) => <span className="font-semibold">{t.name}</span>, value: (t: typeof rows[0]) => t.name },
          { header: 'Nomor Plat', cell: (t: typeof rows[0]) => <span className="font-mono font-bold">{t.vehiclePlate}</span>, value: (t: typeof rows[0]) => t.vehiclePlate },
          {
            header: 'Kamar',
            cell: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? lookups.roomName(r.roomId) : '—'
            },
            value: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? lookups.roomName(r.roomId) : '—'
            },
          },
          {
            header: 'Properti',
            cell: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? lookups.propertyName(r.propertyId) : '—'
            },
            value: (t: typeof rows[0]) => {
              const r = lookups.activeRental(t.id)
              return r ? lookups.propertyName(r.propertyId) : '—'
            },
          },
          { header: 'Telepon', cell: (t: typeof rows[0]) => t.contacts[0]?.phone ?? '—', value: (t: typeof rows[0]) => t.contacts[0]?.phone ?? '' },
        ] as Column<never>[],
        summary: [
          { label: 'Total kendaraan', value: String(rows.length) },
          { label: 'Penyewa terdaftar', value: String(tenants.filter((t) => !t.isWaitlist).length) },
          { label: 'Tanpa kendaraan', value: String(tenants.filter((t) => !t.isWaitlist && !t.vehiclePlate).length) },
          { label: 'Rasio', value: tenants.length ? `${Math.round((rows.length / tenants.filter((t) => !t.isWaitlist).length) * 100)}%` : '0%' },
        ],
      }
    }

    default:
      return { rows: [], columns: [] }
  }
}

function CategoryPie({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-10">Tidak ada data</p>
  }
  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={48} outerRadius={76} paddingAngle={2} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <RTooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 mt-3">
        {data.slice(0, 6).map((d, i) => (
          <div key={d.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="truncate text-muted-foreground">{d.name}</span>
            </span>
            <span className="font-bold tabular-nums shrink-0">{formatIDR(d.value, { compact: true })}</span>
          </div>
        ))}
      </div>
    </>
  )
}

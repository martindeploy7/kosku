import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts'
import {
  Banknote, Building2, CalendarClock, ChevronDown, DoorOpen, LogOut, Plus,
  Receipt, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, Td, Th, Tr,
} from '@/components/ui'
import { PageHeader, StatCard } from '@/components/shared'
import { INVOICE_STATUSES } from '@/lib/constants'
import { settlementLabel } from '@/lib/finance'
import { ApprovalsPanel } from '@/components/shared/ApprovalsPanel'
import { TodayPanel } from '@/components/shared/TodayPanel'
import { useDerived, useLookups } from '@/lib/selectors'
import { useStore } from '@/lib/store'
import { cn, formatDate, formatIDR } from '@/lib/utils'


export default function Dashboard() {
  const navigate = useNavigate()
  const d = useDerived()
  const lookups = useLookups()
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const rooms = useStore((s) => s.rooms)
  const properties = useStore((s) => s.properties)
  const me = useStore((s) => s.me)
  const [vacantOpen, setVacantOpen] = React.useState(true)

  const recentPayments = React.useMemo(
    () => [...payments].filter((p) => p.amount > 0).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5),
    [payments],
  )
  const recentInvoices = React.useMemo(
    () => [...invoices].filter((i) => i.status !== 'batal').sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)).slice(0, 5),
    [invoices],
  )
  const vacantRooms = React.useMemo(
    () => rooms.filter((r) => lookups.roomStatus(r.id) === 'tersedia'),
    [rooms, lookups],
  )

  const paidRatio = d.monthInvoices.length
    ? Math.round((d.monthPaidCount / d.monthInvoices.length) * 100)
    : 0

  const donutData = [
    { name: 'Sudah lunas', value: d.monthPaidCount, color: '#10b981' },
    { name: 'Belum lunas', value: Math.max(0, d.monthInvoices.length - d.monthPaidCount), color: '#e2e8f0' },
  ]

  const profit = d.monthIncome - d.monthExpense
  const lastProfit = d.lastMonthIncome - d.lastMonthExpense
  const profitDelta = lastProfit === 0 ? (profit > 0 ? 100 : 0) : Math.round(((profit - lastProfit) / Math.abs(lastProfit)) * 100)

  const quickActions = [
    { icon: Banknote, label: 'Selesaikan pembayaran', desc: 'Catat pembayaran cash atau transfer', to: '/frontdesk?action=payment' },
    { icon: LogOut, label: 'Akhiri perjanjian penyewa', desc: 'Proses check-out penyewa aktif', to: '/frontdesk?action=checkout' },
    { icon: Building2, label: 'Tambahkan properti baru', desc: 'Masukkan informasi detail properti', to: '/properties?action=new' },
    { icon: UserPlus, label: 'Tambahkan penyewa baru', desc: 'Masukkan detail penyewa baru', to: '/tenants?action=new' },
    { icon: CalendarClock, label: 'Cek jadwal kamar', desc: 'Lihat ketersediaan & timeline sewa', to: '/rooms?tab=schedule' },
  ]

  return (
    <>
      <PageHeader
        title={`Halo, ${me?.name.split(' ')[0] ?? ''} 👋`}
        description="Berikut ringkasan bisnis kos Anda hari ini."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/reports')}>
              <Receipt className="h-4 w-4" /> Lihat laporan
            </Button>
            <Button onClick={() => navigate('/tenants?action=new')}>
              <Plus className="h-4 w-4" /> Penyewa baru
            </Button>
          </>
        }
      />

      <div className="grid xl:grid-cols-[1fr_340px] gap-6 items-start">
        {/* ---------------- Main column ---------------- */}
        <div className="space-y-6 min-w-0">
          <ApprovalsPanel />
          <TodayPanel />

          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard
              label="Penyewa aktif"
              value={`${d.activeTenants.length} orang`}
              sublabel={`${d.waitlist.length} calon di daftar tunggu`}
              icon={Users}
              tone="primary"
              appearance="watermark"
              onClick={() => navigate('/tenants')}
            />
            <StatCard
              label="Total properti"
              value={`${d.counts.properties} properti`}
              sublabel={`${d.counts.rooms} kamar dikelola`}
              icon={Building2}
              tone="info"
              appearance="watermark"
              onClick={() => navigate('/properties')}
            />
            <StatCard
              label="Tingkat hunian"
              value={`${d.occupancyRate}%`}
              sublabel={`${d.occupiedRooms.length} dari ${d.counts.rooms} kamar terisi`}
              icon={DoorOpen}
              tone="success"
              appearance="watermark"
              onClick={() => navigate('/rooms')}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Payment donut */}
            <Card>
              <CardHeader>
                <CardTitle>Pembayaran sewa bulan ini</CardTitle>
              </CardHeader>
              <CardContent>
                {d.monthInvoices.length === 0 ? (
                  <EmptyState icon={Receipt} title="Belum ada tagihan bulan ini" />
                ) : (
                  <div className="flex items-center gap-6">
                    <div className="relative h-[140px] w-[140px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donutData}
                            dataKey="value"
                            innerRadius={48}
                            outerRadius={68}
                            startAngle={90}
                            endAngle={-270}
                            paddingAngle={2}
                            stroke="none"
                          >
                            {donutData.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 grid place-items-center pointer-events-none">
                        <span className="text-2xl font-extrabold tabular-nums">{paidRatio}%</span>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-2.5">
                      <p className="text-sm font-semibold">
                        {d.monthPaidCount} dari {d.monthInvoices.length} sewa sudah lunas
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="h-2.5 w-2.5 rounded-full bg-success" />
                          <span className="text-muted-foreground">Sudah lunas</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="h-2.5 w-2.5 rounded-full bg-border" />
                          <span className="text-muted-foreground">Belum lunas</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        *dibayar sebagian tidak dihitung sebagai lunas
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Profit 4 months */}
            <Card>
              <CardHeader>
                <CardTitle>Laba/Rugi 4 bulan terakhir</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={d.profitMonths} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="shortLabel" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => formatIDR(v, { compact: true })} tickLine={false} axisLine={false} width={64} />
                    <RTooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                    <Bar dataKey="profit" name="Laba bersih" radius={[6, 6, 0, 0]}>
                      {d.profitMonths.map((m, i) => (
                        <Cell key={i} fill={m.profit >= 0 ? '#6366f1' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* 12 month recap */}
          <Card>
            <CardHeader>
              <CardTitle>Rekap keuangan 12 bulan terakhir</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={d.months} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v) => formatIDR(v, { compact: true })} tickLine={false} axisLine={false} width={70} />
                  <RTooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} />
                  <Area type="monotone" dataKey="income" name="Pendapatan" stroke="#6366f1" strokeWidth={2.5} fill="url(#gIncome)" />
                  <Area type="monotone" dataKey="expense" name="Pengeluaran" stroke="#ef4444" strokeWidth={2.5} fill="url(#gExpense)" />
                  <Area type="monotone" dataKey="deposit" name="Uang jaminan" stroke="#f59e0b" strokeWidth={2} fillOpacity={0} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Recent tables */}
          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Pendapatan terbaru</CardTitle>
                <Link to="/reports/income" className="text-xs font-semibold text-primary hover:underline">Lihat semua</Link>
              </CardHeader>
              {recentPayments.length === 0 ? (
                <EmptyState icon={Wallet} title="Belum ada pembayaran" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Tanggal</Th>
                      <Th>Penyewa</Th>
                      <Th>Metode</Th>
                      <Th align="right">Masuk</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPayments.map((p) => (
                      <Tr key={p.id}>
                        <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(p.date)}</Td>
                        <Td>
                          <p className="font-semibold truncate max-w-[140px]">{lookups.tenantName(p.tenantId)}</p>
                          <p className="text-[11px] text-muted-foreground truncate max-w-[140px]">{lookups.propertyName(p.propertyId)}</p>
                        </Td>
                        <Td><Badge tone={p.method === 'cash' ? 'accent' : 'info'}>{p.method === 'cash' ? 'Tunai' : 'Transfer'}</Badge></Td>
                        <Td align="right" className="font-bold text-success tabular-nums whitespace-nowrap">{formatIDR(p.amount)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Faktur terbaru</CardTitle>
                <Link to="/reports/invoices" className="text-xs font-semibold text-primary hover:underline">Lihat semua</Link>
              </CardHeader>
              {recentInvoices.length === 0 ? (
                <EmptyState icon={Receipt} title="Belum ada faktur" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Jatuh tempo</Th>
                      <Th>Faktur</Th>
                      <Th>Status</Th>
                      <Th align="right">Total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((inv) => {
                      const st = INVOICE_STATUSES.find((s) => s.value === inv.status)!
                      return (
                        <Tr key={inv.id} clickable onClick={() => navigate(`/tenants/${inv.tenantId}?tab=invoices`)}>
                          <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(inv.dueDate)}</Td>
                          <Td>
                            <p className="font-semibold text-xs font-mono truncate max-w-[130px]">{inv.number}</p>
                            <p className="text-[11px] text-muted-foreground truncate max-w-[130px]">{lookups.tenantName(inv.tenantId)}</p>
                          </Td>
                          <Td><Badge tone={st.tone as 'success'}>{st.label}</Badge></Td>
                          <Td align="right" className="font-bold tabular-nums whitespace-nowrap">{formatIDR(inv.total)}</Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          {/* Rent payment heatmap */}
          <Card>
            <CardHeader>
              <CardTitle>Pembayaran sewa 12 bulan terakhir</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={d.months} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v) => formatIDR(v, { compact: true })} tickLine={false} axisLine={false} width={70} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                  <Legend iconType="circle" iconSize={8} />
                  <Bar dataKey="invoicePaid" name="Sewa sudah dibayar" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar
                    dataKey={(row: { invoiceTotal: number; invoicePaid: number }) => Math.max(0, row.invoiceTotal - row.invoicePaid)}
                    name="Belum dibayar"
                    stackId="a"
                    fill="#fbbf24"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* ---------------- Activity sidebar ---------------- */}
        <aside className="space-y-4 xl:sticky xl:top-24">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-primary to-violet-600 text-white p-5">
              <p className="text-xs font-semibold text-white/80">Laba bulan ini</p>
              <p className="text-3xl font-extrabold tracking-tight mt-1 tabular-nums">{formatIDR(profit)}</p>
              <div className="flex items-center gap-2 mt-2 text-xs">
                <span className={cn('inline-flex items-center gap-1 font-bold rounded-full px-2 py-0.5 bg-white/20')}>
                  <TrendingUp className={cn('h-3 w-3', profitDelta < 0 && 'rotate-180')} />
                  {profitDelta >= 0 ? '+' : ''}{profitDelta}%
                </span>
                <span className="text-white/70">vs bulan lalu ({formatIDR(lastProfit, { compact: true })})</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Aksi cepat</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {quickActions.map((a) => {
                const Icon = a.icon
                return (
                  <button
                    key={a.label}
                    onClick={() => navigate(a.to)}
                    className="w-full flex items-start gap-3 p-3 rounded-md hover:bg-muted transition text-left focus-ring group"
                  >
                    <span className="h-9 w-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0 group-hover:scale-105 transition">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight">{a.label}</span>
                      <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{a.desc}</span>
                    </span>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <button
              onClick={() => setVacantOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-3 p-5 text-left focus-ring rounded-lg"
            >
              <div className="min-w-0">
                <p className="font-bold text-[15px]">Kamar kosong</p>
                <p className="text-xs text-muted-foreground mt-0.5">{vacantRooms.length} kamar siap disewakan</p>
              </div>
              <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', vacantOpen && 'rotate-180')} />
            </button>
            {vacantOpen && (
              <div className="border-t border-border">
                {vacantRooms.length === 0 ? (
                  <EmptyState icon={DoorOpen} title="Semua kamar terisi" description="Kerja bagus! Tidak ada kamar kosong saat ini." className="py-8" />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Kamar</Th>
                        <Th align="right">Harga/bulan</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {vacantRooms.slice(0, 6).map((r) => (
                        <Tr key={r.id} clickable onClick={() => navigate('/rooms')}>
                          <Td>
                            <p className="font-semibold text-sm">{r.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{lookups.propertyName(r.propertyId)}</p>
                          </Td>
                          <Td align="right" className="font-bold tabular-nums text-sm whitespace-nowrap">
                            {formatIDR(r.price.monthly, { compact: true })}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Total pemasukan" value={formatIDR(d.totalIncome, { compact: true })} tone="success" />
            <MiniStat label="Total pengeluaran" value={formatIDR(d.totalExpense, { compact: true })} tone="danger" />
            <MiniStat label="Uang jaminan" value={formatIDR(d.totalDeposit, { compact: true })} tone="info" />
            <MiniStat label="Belum dibayar" value={formatIDR(d.totalOutstanding, { compact: true })} tone="warning" />
            <MiniStat label="Waktu pelunasan" value={settlementLabel(d.avgSettlement)} tone="primary" className="col-span-2" />
            <MiniStat label="Rata-rata tarif harian" value={formatIDR(d.avgDailyRate)} tone="accent" className="col-span-2" />
          </div>
        </aside>
      </div>
    </>
  )
}

function MiniStat({
  label, value, tone, className,
}: {
  label: string
  value: string
  tone: 'success' | 'danger' | 'info' | 'warning' | 'primary' | 'accent'
  className?: string
}) {
  const tones = {
    success: 'text-success', danger: 'text-danger', info: 'text-info',
    warning: 'text-warning', primary: 'text-primary', accent: 'text-accent',
  }
  return (
    <div className={cn('card p-4', className)}>
      <p className="text-[11px] font-semibold text-muted-foreground truncate">{label}</p>
      <p className={cn('text-lg font-extrabold tracking-tight mt-1 tabular-nums truncate', tones[tone])}>{value}</p>
    </div>
  )
}

export function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-pop text-xs">
      {label && <p className="font-bold mb-1.5">{label}</p>}
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-bold tabular-nums">{formatIDR(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

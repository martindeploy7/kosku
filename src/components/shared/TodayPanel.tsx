import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlarmClock, Banknote, CalendarCheck, CalendarClock, ChevronDown, CircleAlert, FileSignature, Hourglass, MessageCircle,
  PartyPopper, Undo2,
} from 'lucide-react'
import { Avatar, Badge, Button, Card, Select } from '@/components/ui'
import { PaymentModal } from '@/components/modals/PaymentModal'
import { actions } from '@/lib/actions'
import { buildTakeaways, type DueItem } from '@/lib/finance'
import { useLookups } from '@/lib/selectors'
import { useStore } from '@/lib/store'
import { cn, dueLabel, formatDate, formatIDR, parseISO } from '@/lib/utils'

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

type Kind = 'overdue' | 'today' | 'dp' | 'upcoming'

const KIND_STYLE: Record<Kind, { tone: 'danger' | 'warning' | 'primary' | 'info'; label: (d: DueItem) => string }> = {
  overdue: { tone: 'danger', label: (d) => `Terlambat ${d.daysLate} hari` },
  today: { tone: 'warning', label: () => 'Jatuh tempo hari ini' },
  dp: {
    tone: 'warning',
    label: (d) => (d.daysLate > 0 ? `DP lewat batas ${d.daysLate} hari` : d.daysLate === 0 ? 'Batas DP hari ini' : `Batas DP ${d.daysLate === -1 ? 'besok' : `${-d.daysLate} hari lagi`}`),
  },
  upcoming: { tone: 'info', label: (d) => dueLabel(d.dueDate, '') },
}

/**
 * "Hari ini" — what an admin must act on today, before anything else:
 * payments due today, arrears, DP bookings about to lapse, agreements still
 * unsigned. Each row has the next action one tap away.
 */
export function TodayPanel() {
  const navigate = useNavigate()
  const lookups = useLookups()
  const rentals = useStore((s) => s.rentals)
  const invoices = useStore((s) => s.invoices)
  const rooms = useStore((s) => s.rooms)
  const contracts = useStore((s) => s.contracts)
  const properties = useStore((s) => s.properties)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const [propertyId, setPropertyId] = React.useState('')
  const [showUpcoming, setShowUpcoming] = React.useState(false)
  const [pay, setPay] = React.useState<{ tenantId: string; invoiceId?: string } | null>(null)

  const t = React.useMemo(
    () => buildTakeaways({ rentals, invoices, rooms, contracts, today, propertyId: propertyId || null }),
    [rentals, invoices, rooms, contracts, today, propertyId],
  )

  const d = parseISO(today)
  const dpUrgent = t.dpDeadlines.filter((x) => x.daysLate >= -1)
  const actionable: { kind: Kind; item: DueItem }[] = [
    ...t.overdue.map((item) => ({ kind: 'overdue' as const, item })),
    ...dpUrgent.map((item) => ({ kind: 'dp' as const, item })),
    ...t.dueToday.map((item) => ({ kind: 'today' as const, item })),
  ]
  const nothing = !actionable.length && !t.unsignedContracts.length && !t.lapsedPending.length && !t.endingSoon.length

  const remind = (item: DueItem) =>
    item.invoiceId
      ? run(() => actions.sendInvoice(item.invoiceId!), { success: 'Pengingat dikirim via WhatsApp', refresh: false })
      : undefined

  const tiles = [
    { label: 'Jatuh tempo hari ini', count: t.dueToday.length, amount: t.totals.dueToday, icon: CalendarCheck, tone: 'text-warning bg-warning-soft' },
    { label: 'Terlambat', count: t.overdue.length, amount: t.totals.overdue, icon: CircleAlert, tone: 'text-danger bg-danger-soft' },
    { label: 'DP harus lunas', count: dpUrgent.length, amount: dpUrgent.reduce((a, x) => a + x.amount, 0), icon: Hourglass, tone: 'text-warning bg-warning-soft' },
    { label: 'Perjanjian belum ditandatangani', count: t.unsignedContracts.length, icon: FileSignature, tone: 'text-info bg-info-soft' },
  ]

  const Row = ({ kind, item }: { kind: Kind; item: DueItem }) => {
    const tenant = lookups.tenant(item.tenantId)
    const st = KIND_STYLE[kind]
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
        <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => navigate(`/tenants/${item.tenantId}`)}>
          <Avatar name={tenant?.name ?? '?'} color={tenant?.avatarColor} size="sm" />
          <span className="min-w-0">
            <span className="block font-semibold text-sm truncate">{tenant?.name ?? lookups.tenantName(item.tenantId)}</span>
            <span className="block text-xs text-muted-foreground truncate">
              {lookups.roomName(item.roomId)} · {lookups.propertyName(item.propertyId)}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <div className="text-right">
            <p className="font-bold text-sm tabular-nums">{formatIDR(item.amount)}</p>
            <Badge tone={st.tone} className="mt-0.5">{kind === 'upcoming' ? dueLabel(item.dueDate, today) : st.label(item)}</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => setPay({ tenantId: item.tenantId, invoiceId: item.invoiceId ?? undefined })}>
            <Banknote className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Catat</span> bayar
          </Button>
          {item.invoiceId && (
            <Button size="icon" variant="ghost" aria-label="Kirim pengingat WhatsApp" onClick={() => void remind(item)}>
              <MessageCircle className="h-4 w-4" />
            </Button>
          )}
        </div>
      </li>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-gradient-to-r from-primary-soft/70 to-transparent">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Hari ini</p>
          <h2 className="text-lg font-extrabold tracking-tight">{DAYS[d.getDay()]}, {formatDate(today, 'long')}</h2>
        </div>
        {properties.length > 1 && (
          <div className="w-56">
            <Select
              value={propertyId}
              onChange={setPropertyId}
              placeholder="Semua properti"
              options={[{ value: '', label: 'Semua properti' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className={cn('h-7 w-7 rounded-lg grid place-items-center', tile.tone)}><tile.icon className="h-4 w-4" /></span>
              <span className="text-2xl font-extrabold tabular-nums">{tile.count}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-tight">{tile.label}</p>
            {tile.amount !== undefined && tile.count > 0 && <p className="text-xs font-bold mt-0.5 tabular-nums">{formatIDR(tile.amount)}</p>}
          </div>
        ))}
      </div>

      <div className="px-5">
        {nothing ? (
          <div className="py-8 flex flex-col items-center text-center">
            <PartyPopper className="h-8 w-8 text-success" />
            <p className="font-bold mt-2">Tidak ada yang perlu ditindaklanjuti hari ini</p>
            <p className="text-xs text-muted-foreground mt-1">Semua tagihan jatuh tempo sudah lunas.</p>
          </div>
        ) : (
          <>
            {actionable.length > 0 && (
              <ul className="divide-y divide-border">
                {actionable.map(({ kind, item }) => <Row key={`${kind}-${item.rentalId}-${item.invoiceId}`} kind={kind} item={item} />)}
              </ul>
            )}

            {t.lapsedPending.length > 0 && (
              <div className="py-3 border-t border-border">
                <p className="text-xs font-bold text-danger flex items-center gap-1.5 mb-2"><Undo2 className="h-3.5 w-3.5" /> Gagal bayar — tentukan nasib DP</p>
                {t.lapsedPending.map((r) => (
                  <button key={r.id} onClick={() => navigate(`/tenants/${r.tenantId}?tab=rental`)} className="w-full flex items-center justify-between gap-3 py-1.5 text-sm hover:text-primary">
                    <span className="truncate">{lookups.tenantName(r.tenantId)} · {lookups.roomName(r.roomId)}</span>
                    <span className="text-xs font-semibold shrink-0">{formatIDR(r.downPayment.amount)}</span>
                  </button>
                ))}
              </div>
            )}

            {t.unsignedContracts.length > 0 && (
              <div className="py-3 border-t border-border">
                <p className="text-xs font-bold text-info flex items-center gap-1.5 mb-2"><FileSignature className="h-3.5 w-3.5" /> Perjanjian menunggu tanda tangan</p>
                {t.unsignedContracts.slice(0, 5).map((c) => (
                  <button key={c.id} onClick={() => navigate(`/tenants/${c.tenantId}?tab=contract`)} className="w-full flex items-center justify-between gap-3 py-1.5 text-sm hover:text-primary">
                    <span className="truncate">{lookups.tenantName(c.tenantId)}</span>
                    <Badge tone={c.status === 'viewed' ? 'info' : c.status === 'sent' ? 'primary' : 'muted'}>
                      {c.status === 'viewed' ? 'Sudah dibuka' : c.status === 'sent' ? 'Terkirim' : 'Belum terkirim'}
                    </Badge>
                  </button>
                ))}
              </div>
            )}

            {t.endingSoon.length > 0 && (
              <div className="py-3 border-t border-border">
                <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 mb-2"><CalendarClock className="h-3.5 w-3.5" /> Sewa berakhir ≤ 7 hari</p>
                {t.endingSoon.map((r) => (
                  <button key={r.id} onClick={() => navigate(`/tenants/${r.tenantId}`)} className="w-full flex items-center justify-between gap-3 py-1.5 text-sm hover:text-primary">
                    <span className="truncate">{lookups.tenantName(r.tenantId)} · {lookups.roomName(r.roomId)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(r.endDate)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {t.upcoming.length > 0 && (
          <div className="border-t border-border">
            <button onClick={() => setShowUpcoming((v) => !v)} className="w-full flex items-center justify-between py-3 text-xs font-bold text-muted-foreground">
              <span className="flex items-center gap-1.5"><AlarmClock className="h-3.5 w-3.5" /> 7 hari ke depan · {t.upcoming.length} tagihan · {formatIDR(t.totals.upcoming)}</span>
              <ChevronDown className={cn('h-4 w-4 transition', showUpcoming && 'rotate-180')} />
            </button>
            {showUpcoming && (
              <ul className="divide-y divide-border border-t border-border">
                {t.upcoming.map((item) => <Row key={`up-${item.invoiceId}`} kind="upcoming" item={item} />)}
              </ul>
            )}
          </div>
        )}
      </div>

      <PaymentModal open={Boolean(pay)} onClose={() => setPay(null)} presetTenantId={pay?.tenantId} presetInvoiceId={pay?.invoiceId} />
    </Card>
  )
}

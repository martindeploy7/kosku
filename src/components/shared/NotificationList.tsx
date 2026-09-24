import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, BellOff, CheckCheck, CheckCircle2, Info, Loader2, OctagonAlert,
} from 'lucide-react'
import { Button, EmptyState } from '@/components/ui'
import { actions } from '@/lib/actions'
import { useStore } from '@/lib/store'
import type { AppNotification } from '@/lib/types'
import { cn, relativeTime } from '@/lib/utils'

const ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
}
const TONE = {
  info: 'text-info bg-info-soft',
  success: 'text-success bg-success-soft',
  warning: 'text-warning bg-warning-soft',
  danger: 'text-danger bg-danger-soft',
}

/** Notification feed — the bell dropdown (compact) and the full page. */
export function NotificationList({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const rev = useStore((s) => s.rev)
  const properties = useStore((s) => s.properties)
  const sync = useStore((s) => s.sync)
  const [items, setItems] = React.useState<AppNotification[] | null>(null)
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all')

  const load = React.useCallback(async () => {
    try {
      setItems(await actions.notifications())
    } catch {
      setItems((x) => x ?? [])
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load, rev])

  const open = async (n: AppNotification) => {
    if (!n.read) {
      setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null)
      void actions.markNotificationsRead([n.id]).then(() => sync())
    }
    onNavigate?.()
    if (n.link) navigate(n.link)
  }

  const markAll = async () => {
    setItems((xs) => xs?.map((x) => ({ ...x, read: true })) ?? null)
    await actions.markNotificationsRead('all')
    await sync()
  }

  const shown = (items ?? []).filter((n) => filter === 'all' || !n.read).slice(0, compact ? 12 : 200)
  const unread = (items ?? []).filter((n) => !n.read).length
  const propName = (id: string | null) => properties.find((p) => p.id === id)?.name

  return (
    <div className={cn('flex flex-col', compact && 'max-h-[min(560px,75dvh)]')}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1 rounded-md bg-muted p-0.5 text-xs font-semibold">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn('px-2.5 py-1 rounded transition', filter === f ? 'bg-surface shadow-xs' : 'text-muted-foreground')}
            >
              {f === 'all' ? 'Semua' : `Belum dibaca${unread ? ` (${unread})` : ''}`}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={markAll} disabled={!unread}>
          <CheckCheck className="h-3.5 w-3.5" /> Tandai dibaca
        </Button>
      </div>

      <div className="overflow-y-auto overscroll-contain">
        {items === null ? (
          <div className="py-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : shown.length === 0 ? (
          <EmptyState icon={BellOff} title={filter === 'unread' ? 'Semua sudah dibaca' : 'Belum ada notifikasi'} className="py-10" />
        ) : (
          shown.map((n) => {
            const Icon = ICON[n.severity]
            return (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={cn(
                  'w-full text-left flex gap-3 px-4 py-3 border-b border-border/60 transition hover:bg-muted/60',
                  !n.read && 'bg-primary-soft/40',
                )}
              >
                <span className={cn('h-8 w-8 rounded-lg grid place-items-center shrink-0', TONE[n.severity])}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className={cn('text-sm leading-snug', !n.read ? 'font-bold' : 'font-medium')}>{n.title}</span>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </span>
                  {n.body && <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-3">{n.body}</span>}
                  <span className="block text-[11px] text-muted-foreground mt-1">
                    {relativeTime(n.createdAt)}{propName(n.propertyId) ? ` · ${propName(n.propertyId)}` : ''}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>

      {compact && (
        <button
          onClick={() => { onNavigate?.(); navigate('/notifications') }}
          className="px-4 py-2.5 text-xs font-semibold text-primary border-t border-border hover:bg-muted transition shrink-0"
        >
          Lihat semua notifikasi
        </button>
      )}
    </div>
  )
}

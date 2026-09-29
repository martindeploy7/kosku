import * as React from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, Filter,
  Info, RotateCcw, X, XCircle, type LucideIcon,
} from 'lucide-react'
import { Badge, Button, Checkbox, Popover, SearchInput, SectionTitle, Tabs } from '@/components/ui'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ Toaster */

export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  const icons = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
  }
  const tones = {
    success: 'text-success',
    error: 'text-danger',
    warning: 'text-warning',
    info: 'text-info',
  }

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]">
      {toasts.map((t) => {
        const Icon = icons[t.variant]
        return (
          <div
            key={t.id}
            role="status"
            className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5 shadow-pop animate-slide-up"
          >
            <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', tones[t.variant])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{t.title}</p>
              {t.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="p-1 -m-1 rounded hover:bg-muted transition shrink-0" aria-label="Tutup">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ PageHeader */

export function PageHeader({
  title, description, breadcrumb, actions, className,
}: {
  title: string
  description?: string
  breadcrumb?: { label: string; to?: string }[]
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4 mb-6', className)}>
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            {breadcrumb.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                {b.to ? (
                  <Link to={b.to} className="hover:text-foreground transition font-medium">{b.label}</Link>
                ) : (
                  <span className="text-foreground font-medium truncate">{b.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-extrabold tracking-tight truncate">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</p>}
      </div>
      {/* Full width on phones so the buttons wrap inside the viewport instead of
          being held at their intrinsic width by shrink-0. */}
      {actions && <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0">{actions}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ StatCard */

export function StatCard({
  label, value, sublabel, icon: Icon, tone = 'primary', trend, onClick, className, appearance = 'watermark',
}: {
  label: string
  value: React.ReactNode
  sublabel?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent'
  trend?: { value: number; label?: string }
  onClick?: () => void
  className?: string
  appearance?: 'default' | 'watermark'
}) {
  const tones = {
    primary: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
    accent: 'bg-accent/15 text-accent',
  }
  const watermarkTones = {
    primary: 'bg-gradient-to-br from-surface via-surface to-primary-soft/80 text-primary',
    success: 'bg-gradient-to-br from-surface via-surface to-success-soft/80 text-success',
    warning: 'bg-gradient-to-br from-surface via-surface to-warning-soft/80 text-warning',
    danger: 'bg-gradient-to-br from-surface via-surface to-danger-soft/80 text-danger',
    info: 'bg-gradient-to-br from-surface via-surface to-info-soft/80 text-info',
    accent: 'bg-gradient-to-br from-surface via-surface to-accent/15 text-accent',
  }

  const Comp = onClick ? 'button' : 'div'
  const watermark = appearance === 'watermark'

  return (
    <Comp
      onClick={onClick}
      className={cn(
        'card p-5 text-left w-full transition-all',
        watermark && 'relative isolate overflow-hidden min-h-[142px]',
        watermark && watermarkTones[tone],
        onClick && 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer focus-ring',
        className,
      )}
    >
      {watermark && Icon && (
        <Icon aria-hidden="true" className="absolute -z-0 -right-4 -bottom-7 h-32 w-32 opacity-[0.11] sm:h-36 sm:w-36" />
      )}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className={cn('min-w-0', watermark && 'max-w-[78%]')}>
          <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
          <p className="text-[26px] leading-tight font-extrabold tracking-tight mt-1.5 tabular-nums truncate">{value}</p>
        </div>
        {Icon && !watermark && (
          <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0', tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {(sublabel || trend) && (
        <div className="relative z-10 flex items-center gap-2 mt-3 text-xs">
          {trend && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-bold',
                trend.value >= 0 ? 'text-success' : 'text-danger',
              )}
            >
              {trend.value >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {Math.abs(trend.value)}%
            </span>
          )}
          {sublabel && <span className="text-muted-foreground truncate">{sublabel}</span>}
        </div>
      )}
    </Comp>
  )
}

/* ------------------------------------------------------------------ FilterPopover */

export interface FilterGroup {
  key: string
  label: string
  options: { value: string; label: string }[]
}

export function FilterPopover({
  groups, selected, onChange, onReset,
}: {
  groups: FilterGroup[]
  selected: Record<string, string[]>
  onChange: (key: string, values: string[]) => void
  onReset: () => void
}) {
  const [activeTab, setActiveTab] = React.useState(groups[0]?.key ?? '')
  const [query, setQuery] = React.useState('')
  const activeCount = Object.values(selected).reduce((a, v) => a + v.length, 0)
  const group = groups.find((g) => g.key === activeTab) ?? groups[0]
  const options = (group?.options ?? []).filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <Popover
      width="w-[min(560px,calc(100vw-2rem))]"
      trigger={({ toggle, open }) => (
        <Button variant="outline" onClick={toggle} className={cn('relative', open && 'border-primary')}>
          <Filter className="h-4 w-4" />
          Filter
          {activeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </Button>
      )}
    >
      {() => (
        <div className="flex flex-col sm:flex-row max-h-[70dvh]">
          <div className="sm:w-44 shrink-0 border-b sm:border-b-0 sm:border-r border-border p-2 overflow-x-auto">
            <div className="flex sm:flex-col gap-1">
              {groups.map((g) => {
                const count = selected[g.key]?.length ?? 0
                return (
                  <button
                    key={g.key}
                    onClick={() => { setActiveTab(g.key); setQuery('') }}
                    className={cn(
                      'flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs font-semibold transition whitespace-nowrap w-full text-left',
                      activeTab === g.key ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {g.label}
                    {count > 0 && <Badge tone="primary" className="px-1.5 py-0">{count}</Badge>}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="p-3 border-b border-border">
              <SearchInput value={query} onChange={setQuery} placeholder={`Cari ${group?.label.toLowerCase()}...`} />
            </div>
            <div className="p-3 space-y-2.5 overflow-y-auto grow max-h-64">
              {options.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">Tidak ada opsi</p>}
              {options.map((o) => {
                const values = selected[group.key] ?? []
                const checked = values.includes(o.value)
                return (
                  <Checkbox
                    key={o.value}
                    checked={checked}
                    label={o.label}
                    onChange={(v) =>
                      onChange(group.key, v ? [...values, o.value] : values.filter((x) => x !== o.value))
                    }
                  />
                )
              })}
            </div>
            <div className="p-3 border-t border-border flex justify-between items-center">
              <Button variant="ghost" size="sm" onClick={onReset}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Filter
              </Button>
              <span className="text-xs text-muted-foreground">{activeCount} filter aktif</span>
            </div>
          </div>
        </div>
      )}
    </Popover>
  )
}

/** Quick filter chips that mirror the filter popover state. */
export function FilterChips({
  options, selected, onToggle,
}: {
  options: { value: string; label: string; tone?: string; icon?: LucideIcon }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => {
        const active = selected.includes(o.value)
        return (
          <button
            key={o.value}
            onClick={() => onToggle(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-semibold transition-all focus-ring',
              active
                ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                : 'bg-surface border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {o.icon && <o.icon className="h-3.5 w-3.5" />}
            {o.label}
            {active && <X className="h-3 w-3" />}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ View toggle */

export function ViewToggle({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; icon: React.ComponentType<{ className?: string }>; label: string }[]
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-surface">
      {options.map((o) => {
        const Icon = o.icon
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.label}
            aria-label={o.label}
            aria-pressed={value === o.value}
            className={cn(
              'h-8 w-8 rounded-[10px] inline-flex items-center justify-center transition focus-ring',
              value === o.value ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ Misc display */

export function KeyValue({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="text-sm font-semibold mt-1 truncate">{value}</div>
    </div>
  )
}

export { Tabs, SectionTitle }

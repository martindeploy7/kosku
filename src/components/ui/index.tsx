import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'
import { cn, formatIDR, parseIDR } from '@/lib/utils'

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'dark'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs',
  secondary: 'bg-accent text-accent-foreground hover:bg-accent/90 shadow-xs',
  outline: 'border border-input bg-surface hover:bg-muted text-foreground',
  ghost: 'hover:bg-muted text-foreground',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-xs',
  success: 'bg-success text-white hover:bg-success/90 shadow-xs',
  dark: 'bg-foreground text-background hover:bg-foreground/90 shadow-xs',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-md',
  lg: 'h-11 px-6 text-sm gap-2 rounded-md',
  icon: 'h-9 w-9 rounded-md',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-all focus-ring',
        'disabled:opacity-50 disabled:pointer-events-none active:scale-[.98]',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

/* ------------------------------------------------------------------ Card */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-bold text-[15px] tracking-tight', className)} {...props} />
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground mt-0.5', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

/* ------------------------------------------------------------------ Field + Input */

export function Field({
  label, hint, error, required, children, className, htmlFor,
}: {
  /** Explicit control id when the child is a wrapper rather than the input itself. */
  htmlFor?: string
  label?: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  // Tie the label to its control so screen readers announce it and tapping the
  // label focuses the input (a single child element gets the generated id).
  const autoId = React.useId()
  const single = !htmlFor && React.isValidElement<{ id?: string }>(children) ? children : null
  const controlId = htmlFor ?? (single ? single.props.id ?? autoId : undefined)
  const control = single && !single.props.id ? React.cloneElement(single, { id: autoId }) : children

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={controlId} className="block text-xs font-semibold text-muted-foreground">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <p className="text-xs text-danger font-medium">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>
      ) : null}
    </div>
  )
}

export const inputClass =
  'w-full h-10 px-3 rounded-md border border-input bg-surface text-sm text-foreground placeholder:text-muted-foreground/70 transition focus-ring disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(inputClass, className)} {...props} />,
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputClass, 'h-auto min-h-[88px] py-2.5 leading-relaxed resize-y', className)}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

/** Currency input that formats to "Rp 1.500.000" while typing. */
export function CurrencyInput({
  value, onChange, className, disabled, ...props
}: {
  value: number
  onChange: (v: number) => void
  className?: string
  disabled?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      {...props}
      disabled={disabled}
      inputMode="numeric"
      value={formatIDR(value)}
      onChange={(e) => onChange(parseIDR(e.target.value))}
      className={cn(inputClass, 'font-semibold tabular-nums', className)}
    />
  )
}

/**
 * Phone input with an explicit country selector.
 * Fixes SuperKos bug #1: once the user picks a country it is NEVER
 * re-derived from the typed digits.
 */
const COUNTRIES = [
  { code: 'ID', dial: '+62', flag: '🇮🇩', name: 'Indonesia' },
  { code: 'MY', dial: '+60', flag: '🇲🇾', name: 'Malaysia' },
  { code: 'SG', dial: '+65', flag: '🇸🇬', name: 'Singapura' },
  { code: 'AU', dial: '+61', flag: '🇦🇺', name: 'Australia' },
  { code: 'US', dial: '+1', flag: '🇺🇸', name: 'Amerika Serikat' },
  { code: 'GB', dial: '+44', flag: '🇬🇧', name: 'Inggris' },
  { code: 'JP', dial: '+81', flag: '🇯🇵', name: 'Jepang' },
  { code: 'KR', dial: '+82', flag: '🇰🇷', name: 'Korea Selatan' },
]

export function PhoneInput({
  value: rawValue, onChange, disabled, className, id,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
}) {
  // Stored numbers are E.164 digits ("628…"); the input works with a leading +.
  const value = rawValue && !rawValue.startsWith('+') ? '+' + rawValue.replace(/\D/g, '') : rawValue || '+62'
  const country = React.useMemo(() => {
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
    return sorted.find((c) => value.startsWith(c.dial)) ?? COUNTRIES[0]
  }, [value])

  const local = value.startsWith(country.dial) ? value.slice(country.dial.length) : ''

  return (
    <div className={cn('flex gap-2', className)}>
      <div className="relative shrink-0">
        <select
          disabled={disabled}
          aria-label="Kode negara"
          value={country.code}
          onChange={(e) => {
            const next = COUNTRIES.find((c) => c.code === e.target.value)!
            onChange(next.dial + local)
          }}
          className={cn(inputClass, 'w-[104px] pr-7 appearance-none cursor-pointer font-medium')}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.dial}
            </option>
          ))}
        </select>
        <ChevronDown className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
      </div>
      <Input
        id={id}
        disabled={disabled}
        inputMode="tel"
        placeholder="81234567890"
        value={local}
        onChange={(e) => {
          // People type local numbers ("0812…") or paste full ones ("+62 812…"): keep only the national part.
          let digits = e.target.value.replace(/[^\d]/g, '')
          const dial = country.dial.replace('+', '')
          if (digits.startsWith(dial) && digits.length > dial.length + 8) digits = digits.slice(dial.length)
          onChange(country.dial + digits.replace(/^0+/, ''))
        }}
      />
    </div>
  )
}

/** Date input in DD/MM/YYYY presentation backed by a native date picker. */
export function DateInput({
  value, onChange, disabled, className, min, max, id,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  min?: string
  max?: string
}) {
  return (
    <input
      id={id}
      type="date"
      disabled={disabled}
      min={min}
      max={max}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, 'cursor-pointer', className)}
    />
  )
}

/* ------------------------------------------------------------------ Select */

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function Select({
  value, onChange, options, placeholder = 'Pilih...', disabled, className, id,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}) {
  return (
    <div className="relative">
      <select
        id={id}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, 'appearance-none pr-9 cursor-pointer', !value && 'text-muted-foreground', className)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
    </div>
  )
}

/* ------------------------------------------------------------------ Checkbox / Switch / Radio */

export function Checkbox({
  checked, onChange, label, description, disabled, className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: React.ReactNode
  description?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-2.5 cursor-pointer select-none group',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <span className="relative flex items-center justify-center mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={cn(
            'h-[18px] w-[18px] rounded-[5px] border-2 border-input bg-surface transition-all',
            'peer-checked:bg-primary peer-checked:border-primary',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2',
            !disabled && 'group-hover:border-primary/60',
          )}
        />
        <Check className="h-3 w-3 text-primary-foreground absolute opacity-0 peer-checked:opacity-100 transition pointer-events-none stroke-[3]" />
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium leading-tight">{label}</span>}
          {description && <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</span>}
        </span>
      )}
    </label>
  )
}

export function Switch({
  checked, onChange, label, description, disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: React.ReactNode
  description?: string
  disabled?: boolean
}) {
  return (
    <label className={cn('flex items-center justify-between gap-4 cursor-pointer select-none', disabled && 'opacity-50 cursor-not-allowed')}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-semibold">{label}</span>}
          {description && <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</span>}
        </span>
      )}
      <span className="relative shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-6 w-11 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

export function RadioCard({
  checked, onChange, title, description, badge, className,
}: {
  checked: boolean
  onChange: () => void
  title: React.ReactNode
  description?: React.ReactNode
  badge?: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'relative text-left rounded-lg border-2 p-4 transition-all focus-ring w-full',
        checked ? 'border-primary bg-primary-soft/60 shadow-xs' : 'border-border bg-surface hover:border-primary/40',
        className,
      )}
    >
      {badge}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 h-[18px] w-[18px] rounded-full border-2 shrink-0 flex items-center justify-center transition',
            checked ? 'border-primary' : 'border-input',
          )}
        >
          {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
        </span>
        <span className="min-w-0">
          <span className="block font-bold text-sm">{title}</span>
          {description && <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">{description}</span>}
        </span>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ Badge */

type BadgeTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'accent'

const badgeTones: Record<BadgeTone, string> = {
  primary: 'bg-primary-soft text-primary border-primary/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
  muted: 'bg-muted text-muted-foreground border-border',
  accent: 'bg-accent/15 text-accent-foreground border-accent/30 dark:text-accent',
}

export function Badge({
  tone = 'muted', className, children, dot,
}: {
  tone?: BadgeTone
  className?: string
  children: React.ReactNode
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        badgeTones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ Avatar */

export function Avatar({
  name, color = 'bg-indigo-500', size = 'md', className,
}: {
  name: string
  color?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizes = {
    sm: 'h-7 w-7 text-[10px]',
    md: 'h-10 w-10 text-xs',
    lg: 'h-12 w-12 text-sm',
    xl: 'h-20 w-20 text-xl',
  }
  const text = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold text-white shrink-0',
        color, sizes[size], className,
      )}
    >
      {text}
    </span>
  )
}

/* ------------------------------------------------------------------ Modal */

export function Modal({
  open, onClose, title, description, children, footer, size = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative w-full bg-surface shadow-pop rounded-t-2xl sm:rounded-lg border border-border',
          // dvh, not vh: mobile browsers size vh against the *expanded* viewport,
          // so a vh-capped sheet hides its own footer behind the URL bar.
          'max-h-[92dvh] flex flex-col animate-slide-up sm:animate-scale-in',
          sizes[size],
        )}
      >
        {(title || description) && (
          <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-border shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {title && <h2 className="text-lg font-bold tracking-tight">{title}</h2>}
                {description && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>}
              </div>
              <button onClick={onClose} className="p-1.5 -mr-1.5 -mt-1 rounded-md hover:bg-muted transition focus-ring shrink-0" aria-label="Tutup">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        <div className="px-5 sm:px-6 py-5 overflow-y-auto grow">{children}</div>
        {footer && (
          <div className="px-5 sm:px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-border bg-muted/30 flex flex-wrap items-center justify-end gap-2 shrink-0 rounded-b-2xl sm:rounded-b-lg [&>*]:flex-1 sm:[&>*]:flex-none">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Ya, lanjutkan', cancelLabel = 'Batal', tone = 'danger', approval = false,
}: {
  open: boolean
  onClose: () => void
  /** `reason` is what the admin typed when `approval` is on. */
  onConfirm: (reason?: string) => void
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  /** The action needs a superadmin's approval: say so and ask for a reason. */
  approval?: boolean
}) {
  const [reason, setReason] = React.useState('')
  const reasonId = React.useId()
  React.useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' && !approval ? 'danger' : 'primary'} onClick={() => { onConfirm(approval ? reason.trim() || undefined : undefined); onClose() }}>
            {approval ? 'Kirim permintaan' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted-foreground leading-relaxed">{message}</div>
      {approval && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-info/30 bg-info-soft p-3 text-xs leading-relaxed text-foreground">
            Tindakan ini perlu <strong>persetujuan superadmin</strong>. Permintaan akan dikirim, dan data tidak berubah sampai disetujui.
          </div>
          <div>
            <label htmlFor={reasonId} className="text-xs font-semibold text-foreground">Alasan (opsional)</label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Contoh: data ganda, salah input"
              className="mt-1.5 w-full resize-none rounded-md border border-input bg-surface px-3 py-2 text-sm focus-ring"
            />
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ Popover */

export function Popover({
  trigger, children, align = 'end', className, width = 'w-80',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'start' | 'end'
  className?: string
  width?: string
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ top: number; left: number; maxHeight: number } | null>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  // Anchored popovers are portalled and positioned against the viewport, then
  // clamped inside it. Plain `absolute right-0` let wide panels (the filter
  // panel is up to 560px) hang off the left edge on phones, putting half their
  // controls out of reach.
  React.useLayoutEffect(() => {
    if (!open) return
    const GUTTER = 8

    const place = () => {
      const trigger = ref.current?.firstElementChild ?? ref.current
      const panel = panelRef.current
      if (!trigger || !panel) return

      const t = trigger.getBoundingClientRect()
      // offsetWidth/Height, not getBoundingClientRect: the panel's open
      // animation is a transform, and a transformed rect would report the
      // mid-animation size and place the panel a dozen-odd pixels off.
      const pw = (panel as HTMLElement).offsetWidth
      const ph = (panel as HTMLElement).offsetHeight
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight

      let left = align === 'end' ? t.right - pw : t.left
      left = Math.min(Math.max(left, GUTTER), Math.max(GUTTER, vw - pw - GUTTER))

      const below = vh - t.bottom - GUTTER * 2
      const above = t.top - GUTTER * 2
      const flip = ph > below && above > below
      const maxHeight = Math.max(160, flip ? above : below)
      const top = flip ? Math.max(GUTTER, t.top - GUTTER - Math.min(ph, maxHeight)) : t.bottom + GUTTER

      setPos({ top, left, maxHeight })
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align])

  React.useEffect(() => {
    if (!open) setPos(null)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              maxHeight: pos?.maxHeight,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={cn(
              'fixed z-40 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface shadow-pop animate-scale-in origin-top',
              width,
              className,
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  )
}

/* ------------------------------------------------------------------ Tabs */

export function Tabs({
  tabs, value, onChange, className, variant = 'underline',
}: {
  tabs: { value: string; label: React.ReactNode; badge?: React.ReactNode }[]
  value: string
  onChange: (v: string) => void
  className?: string
  variant?: 'underline' | 'pill'
}) {
  if (variant === 'pill') {
    return (
      <div className={cn('inline-flex items-center gap-1 p-1 rounded-md bg-muted', className)} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'px-3 h-8 rounded-[10px] text-xs font-semibold transition-all focus-ring inline-flex items-center gap-1.5',
              value === t.value ? 'bg-surface text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.badge}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('border-b border-border overflow-x-auto', className)} role="tablist">
      <div className="flex gap-1 min-w-max">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative px-4 py-3 text-sm font-semibold transition-colors focus-ring rounded-t-md inline-flex items-center gap-2 whitespace-nowrap',
              value === t.value ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.badge}
            {value === t.value && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Table */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full text-sm border-collapse', className)} {...props} />
    </div>
  )
}

export function Th({
  className, sortable, sorted, onSort, children, align = 'left', ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  sortable?: boolean
  sorted?: 'asc' | 'desc' | false
  onSort?: () => void
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 whitespace-nowrap border-b border-border first:rounded-tl-lg last:rounded-tr-lg',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          onClick={onSort}
          className={cn('inline-flex items-center gap-1 hover:text-foreground transition', sorted && 'text-primary')}
        >
          {children}
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', sorted === 'asc' && 'rotate-180', !sorted && 'opacity-30')}
          />
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export function Td({
  className, align = 'left', ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'px-4 py-3 border-b border-border/70 align-middle',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  )
}

export function Tr({ className, clickable, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { clickable?: boolean }) {
  return (
    <tr
      className={cn('transition-colors', clickable && 'cursor-pointer hover:bg-muted/50', className)}
      {...props}
    />
  )
}

/* ------------------------------------------------------------------ Pagination */

export function Pagination({
  page, pageSize, total, onPageChange, onPageSizeChange, pageSizes = [10, 25, 50, 100],
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange?: (s: number) => void
  pageSizes?: number[]
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <>
            <span>Baris per halaman</span>
            <select
              value={pageSize}
              onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1) }}
              className="h-7 rounded-md border border-input bg-surface px-2 text-xs font-semibold focus-ring cursor-pointer"
            >
              {pageSizes.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular-nums font-medium">{from}-{to} dari {total}</span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Halaman sebelumnya">
            <ChevronDown className="h-3.5 w-3.5 rotate-90" />
          </Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)} aria-label="Halaman berikutnya">
            <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Search / Empty */

export function SearchInput({
  value, onChange, placeholder = 'Cari...', className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClass, 'pl-9', value && 'pr-9')}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted transition"
          aria-label="Bersihkan pencarian"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  icon: Icon, title, description, action, className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-14 px-6', className)}>
      {Icon && (
        <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <p className="font-bold text-sm">{title}</p>
      {description && <p className="text-xs text-muted-foreground mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ Misc */

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-muted overflow-hidden', className)}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

export function Divider({ className, label }: { className?: string; label?: string }) {
  if (label) {
    return (
      <div className={cn('flex items-center gap-3 my-4', className)}>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    )
  }
  return <hr className={cn('border-border my-4', className)} />
}

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="block whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background shadow-md max-w-xs">
          {content}
        </span>
      </span>
    </span>
  )
}

export function SectionTitle({
  title, description, action, className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3 mb-4', className)}>
      <div>
        <h3 className="font-bold text-base tracking-tight">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>}
      </div>
      {action}
    </div>
  )
}

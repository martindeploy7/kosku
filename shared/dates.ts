/* Date & money helpers shared by the web app and the server.
 *
 * Every business date (due dates, rental periods, "today") is a plain
 * `YYYY-MM-DD` string. Never round-trip one through `Date#toISOString()`:
 * that converts to UTC and silently shifts the day for anyone east of
 * Greenwich — which is all of Indonesia. */

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const MONTHS_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des']

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar date of `d` (not UTC). */
export function toISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today in the device's local timezone. */
export const todayISO = () => toISO(new Date())

/** Today in an explicit IANA timezone — what the server uses for billing. */
export function todayInTz(tz: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function parseISO(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(iso: string, days: number) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function addMonths(iso: string, months: number) {
  const d = parseISO(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())))
  return toISO(d)
}

/** Whole days from `a` to `b` (positive when b is later). DST-safe. */
export function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number)
  const [by, bm, bd] = b.slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

export function daysInMonth(year: number, monthIdx: number) {
  return new Date(year, monthIdx + 1, 0).getDate()
}

export function formatDate(iso: string | null | undefined, style: 'short' | 'long' | 'input' = 'short') {
  if (!iso) return '-'
  const d = parseISO(iso.slice(0, 10))
  if (Number.isNaN(d.getTime())) return '-'
  if (style === 'input') return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
  if (style === 'long') return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS_SHORT_ID[d.getMonth()]} ${d.getFullYear()}`
}

export function formatMonthYear(iso: string) {
  const d = parseISO(iso.slice(0, 10))
  return `${MONTHS_SHORT_ID[d.getMonth()]} ${d.getFullYear()}`
}

export function monthLabel(monthIdx: number, year: number, short = true) {
  return `${(short ? MONTHS_SHORT_ID : MONTHS_ID)[monthIdx]} ${year}`
}

/** "Hari ini", "Besok", "3 hari lagi", "Terlambat 2 hari". */
export function dueLabel(dueDate: string, today: string) {
  const d = daysBetween(today, dueDate)
  if (d === 0) return 'Hari ini'
  if (d === 1) return 'Besok'
  if (d > 1) return `${d} hari lagi`
  return `Terlambat ${-d} hari`
}

/* ---------- money (integer rupiah, never floats) ---------- */

export function formatIDR(value: number, opts?: { compact?: boolean }) {
  if (!Number.isFinite(value)) value = 0
  if (opts?.compact && Math.abs(value) >= 1_000_000) {
    const m = value / 1_000_000
    return `Rp ${m % 1 === 0 ? m : m.toFixed(1)}jt`
  }
  if (opts?.compact && Math.abs(value) >= 1_000) {
    return `Rp ${Math.round(value / 1000)}rb`
  }
  const sign = value < 0 ? '-' : ''
  return `${sign}Rp ${Math.abs(Math.round(value)).toLocaleString('id-ID')}`
}

export function parseIDR(text: string) {
  const digits = String(text).replace(/[^\d-]/g, '')
  return digits === '' || digits === '-' ? 0 : parseInt(digits, 10)
}

export function sum<T>(arr: T[], pick: (item: T) => number) {
  return arr.reduce((acc, it) => acc + (pick(it) || 0), 0)
}

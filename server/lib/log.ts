/* Minimal structured logger: one JSON line per event in production, readable
 * lines in development. Docker captures stdout; nothing else is needed. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

const threshold = LEVELS[(process.env.LOG_LEVEL as Level) || 'info'] ?? LEVELS.info
const pretty = process.env.NODE_ENV !== 'production'

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return
  const out = level === 'error' || level === 'warn' ? console.error : console.log
  if (pretty) {
    const extra = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''
    out(`${new Date().toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${extra}`)
  } else {
    out(JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }))
  }
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
}

export function errMeta(e: unknown) {
  return e instanceof Error ? { error: e.message, stack: e.stack?.split('\n').slice(0, 4).join(' | ') } : { error: String(e) }
}

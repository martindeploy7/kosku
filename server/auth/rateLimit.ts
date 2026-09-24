/* Fixed-window limiter kept in memory. One app instance, so this is exact;
 * a restart forgets it, which the per-account lockout in the DB covers. */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count += 1
  return { ok: b.count <= limit, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) }
}

export function clear(key: string) {
  buckets.delete(key)
}

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}, 60_000).unref()

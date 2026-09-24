import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from './schema'

/* One small pool is plenty for an internal app; pg-boss keeps its own. */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  onnotice: () => {},
  // Timestamps are exchanged in UTC; business dates are plain `date` columns.
  connection: { TimeZone: 'UTC' },
  types: {
    // COUNT(*) and other int8 results come back as numbers, not strings.
    bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
  },
})

export const db = drizzle(sql, { schema })

export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** Either the pool or an open transaction — services accept both. */
export type Executor = Db | Tx

/** Postgres renders timestamptz as `2026-09-24 03:38:40.6+00`, which Safari
 *  cannot parse. Everything leaving the API goes through this. */
export function iso(ts: string | Date | null | undefined): string | null {
  if (!ts) return null
  const d = ts instanceof Date ? ts : new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export { schema }

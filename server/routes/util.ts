import { and, eq, isNull, sql as dsql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { SessionUser } from '../auth/session'
import type { Executor } from '../db/client'
import { badRequest, notFound, staleVersion } from '../lib/errors'
import type { Actor } from '../services/billing'

export { z }

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const first = r.error.issues[0]
    const where = first.path.length ? `${first.path.join('.')}: ` : ''
    throw badRequest(`${where}${first.message}`, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
  return r.data
}

export async function jsonBody(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json()
  } catch {
    throw badRequest('Body JSON tidak valid.')
  }
}

export const actorOf = (u: SessionUser): Actor => ({ id: u.id, username: u.username, name: u.name })

/* ---------- common field schemas ---------- */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal harus YYYY-MM-DD')
export const uuid = z.string().uuid('ID tidak valid')
export const money = z.number().int('nominal harus bilangan bulat rupiah').min(0).max(1_000_000_000_000)
export const version = z.number().int().min(1)
export const priceSet = z.object({ daily: money, weekly: money, monthly: money, yearly: money })
export const schemes = z.object({ daily: z.boolean(), weekly: z.boolean(), monthly: z.boolean(), yearly: z.boolean() })
export const address = z.object({
  street: z.string().max(300), postcode: z.string().max(10), province: z.string().max(100), city: z.string().max(100),
  district: z.string().max(100), subdistrict: z.string().max(100), lat: z.number(), lng: z.number(),
})
export const items = z.array(z.object({ name: z.string().min(1).max(200), amount: money })).min(1).max(50)

/**
 * UPDATE … WHERE id = ? AND version = ? — the write only lands if nobody else
 * changed the row since this admin loaded it. Otherwise: 409 stale_version.
 */
export async function updateVersioned<T extends PgTable>(
  exec: Executor,
  table: T,
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
) {
  const t = table as unknown as {
    id: never; version: never; deletedAt: never; updatedAt: never
  }
  const rows = await exec
    .update(table)
    .set({ ...patch, updatedAt: new Date().toISOString(), version: dsql`${t.version} + 1` } as never)
    .where(and(eq(t.id, id as never), eq(t.version, expectedVersion as never), isNull(t.deletedAt)))
    .returning()
  if (rows.length) return (rows as unknown[])[0] as T['$inferSelect']
  const exists = await exec
    .select({ v: t.version })
    .from(table as never)
    .where(and(eq(t.id, id as never), isNull(t.deletedAt)))
  if (!exists.length) throw notFound('Data')
  throw staleVersion()
}


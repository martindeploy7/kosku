import { and, eq, lt, ne, or, sql as dsql } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Role } from '@shared/types'
import { db, schema } from '../db/client'
import { env } from '../env'
import { randomToken, sha256 } from '../lib/crypto'

export const SESSION_COOKIE = 'kosku_session'

export interface SessionUser {
  id: string
  username: string
  name: string
  role: Role
  allProperties: boolean
  propertyIds: string[]
  mustChangePassword: boolean
}

const idleMs = () => env.SESSION_IDLE_HOURS * 3600_000
const maxMs = () => env.SESSION_MAX_DAYS * 86400_000

export async function createSession(c: Context, userId: string, ip: string) {
  const token = randomToken(32)
  const now = new Date()
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    expiresAt: new Date(now.getTime() + maxMs()).toISOString(),
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 300),
    ip,
  })
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(maxMs() / 1000),
  })
}

/** Resolve the cookie to a live session. Idle and absolute expiry both apply. */
export async function readSession(c: Context): Promise<{ sessionId: string; user: SessionUser } | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token || token.length > 200) return null
  const id = sha256(token)

  const rows = await db
    .select({ s: schema.sessions, u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const now = Date.now()
  const expired =
    new Date(row.s.expiresAt).getTime() <= now || new Date(row.s.lastSeenAt).getTime() + idleMs() <= now
  if (expired || !row.u.isActive || row.u.deletedAt) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id))
    return null
  }

  // Sliding idle window; only write when it moved meaningfully.
  if (now - new Date(row.s.lastSeenAt).getTime() > 5 * 60_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date(now).toISOString() }).where(eq(schema.sessions.id, id))
  }

  const u = row.u
  return {
    sessionId: id,
    user: {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      allProperties: u.role === 'superadmin' || u.allProperties,
      propertyIds: u.propertyIds,
      mustChangePassword: u.mustChangePassword,
    },
  }
}

export async function destroySession(c: Context, sessionId: string | null) {
  if (sessionId) await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/** Sign a user out everywhere — optionally keeping the current device. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  await db
    .delete(schema.sessions)
    .where(
      exceptSessionId
        ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, exceptSessionId))
        : eq(schema.sessions.userId, userId),
    )
}

export async function purgeExpiredSessions() {
  const cutoff = new Date(Date.now() - idleMs()).toISOString()
  await db
    .delete(schema.sessions)
    .where(or(lt(schema.sessions.expiresAt, dsql`now()`), lt(schema.sessions.lastSeenAt, cutoff)))
}


import { and, desc, eq, isNull, lt, ne, notInArray, or, sql as dsql } from 'drizzle-orm'
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
  /** As configured on the account: every property of the workspace (incl. ones added later). */
  allProperties: boolean
  /**
   * The properties this user may touch right now — always resolved, never "all":
   * the workspace owner's live properties, narrowed to the account's own list if it has one.
   */
  propertyIds: string[]
  /** Workspace: the superadmin (or developer) whose data this account works on. */
  ownerId: string
  /** Developer sandbox: dummy data only, WhatsApp always simulated. */
  sandbox: boolean
  mustChangePassword: boolean
}

type UserRow = typeof schema.users.$inferSelect

/** Superadmins and developers run their own workspace; everyone else works inside their owner's. */
export const workspaceOf = (u: Pick<UserRow, 'id' | 'role' | 'ownerId'>) =>
  u.role === 'superadmin' || u.role === 'developer' ? u.id : (u.ownerId ?? u.id)

/** Build the request identity: workspace + the exact properties it may access. */
export async function toSessionUser(u: UserRow): Promise<SessionUser> {
  const ownerId = workspaceOf(u)
  const owned = await db
    .select({ id: schema.properties.id })
    .from(schema.properties)
    .where(and(eq(schema.properties.ownerId, ownerId), isNull(schema.properties.deletedAt)))
  const all = u.role === 'superadmin' || u.role === 'developer' || u.allProperties
  const ownedIds = owned.map((p) => p.id)
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    allProperties: all,
    propertyIds: all ? ownedIds : u.propertyIds.filter((id) => ownedIds.includes(id)),
    ownerId,
    sandbox: u.role === 'developer',
    mustChangePassword: u.mustChangePassword,
  }
}

const idleMs = () => env.SESSION_IDLE_HOURS * 3600_000
const maxMs = () => env.SESSION_MAX_DAYS * 86400_000

/** Cap how many devices "Perangkat yang masuk" can accumulate per account. */
export const MAX_SESSIONS_PER_USER = 10

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
  // Prune oldest devices beyond the cap so a burst of logins can't grow this unbounded.
  const keep = await db.select({ id: schema.sessions.id }).from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(desc(schema.sessions.lastSeenAt))
    .limit(MAX_SESSIONS_PER_USER)
  if (keep.length === MAX_SESSIONS_PER_USER) {
    await db.delete(schema.sessions).where(and(
      eq(schema.sessions.userId, userId),
      notInArray(schema.sessions.id, keep.map((s) => s.id)),
    ))
  }
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

  return { sessionId: id, user: await toSessionUser(row.u) }
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


import { and, desc, eq, isNull, sql as dsql } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AppEnv, requireUser } from '../auth/context'
import { burnVerifyTime, hashPassword, passwordProblem, verifyPassword } from '../auth/password'
import { clear, hit } from '../auth/rateLimit'
import { createSession, destroySession, revokeUserSessions } from '../auth/session'
import { db, iso, schema } from '../db/client'
import { badRequest, HttpError, unauthorized } from '../lib/errors'
import { writeAudit } from '../services/audit'
import { jsonBody, parse, z } from './util'

export const authRoutes = new Hono<AppEnv>()

const MAX_FAILS = 8
const LOCK_MINUTES = 15

/** Identical message for unknown username and wrong password. */
const BAD_LOGIN = 'Username atau password salah.'

authRoutes.post('/login', async (c) => {
  const body = parse(
    z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }),
    await jsonBody(c),
  )
  const ip = c.get('ip')
  const username = body.username.toLowerCase()

  const byIp = hit(`login:ip:${ip}`, 20, 15 * 60_000)
  const byUser = hit(`login:user:${username}`, 10, 15 * 60_000)
  if (!byIp.ok || !byUser.ok) {
    c.header('Retry-After', String(Math.max(byIp.retryAfterSec, byUser.retryAfterSec)))
    throw new HttpError(429, 'Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.', 'rate_limited')
  }

  const user = await db.query.users.findFirst({
    where: and(dsql`lower(${schema.users.username}) = ${username}`, isNull(schema.users.deletedAt)),
  })
  if (!user) {
    await burnVerifyTime(body.password)
    throw unauthorized(BAD_LOGIN)
  }
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    throw new HttpError(423, 'Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti atau minta superadmin membuka kunci.', 'locked')
  }
  const ok = await verifyPassword(user.passwordHash, body.password)
  if (!ok || !user.isActive) {
    const fails = user.failedAttempts + 1
    await db.update(schema.users).set({
      failedAttempts: fails,
      lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
    }).where(eq(schema.users.id, user.id))
    await writeAudit({ id: user.id, username: user.username }, ip, {
      action: 'auth.login_failed', entityType: 'user', entityId: user.id,
      summary: !user.isActive ? 'Percobaan masuk ke akun nonaktif' : `Percobaan masuk gagal (${fails}x)`,
    })
    throw unauthorized(!user.isActive && ok ? 'Akun Anda dinonaktifkan. Hubungi superadmin.' : BAD_LOGIN)
  }

  await db.update(schema.users)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() })
    .where(eq(schema.users.id, user.id))
  clear(`login:user:${username}`)
  await createSession(c, user.id, ip)
  await writeAudit({ id: user.id, username: user.username }, ip, {
    action: 'auth.login', entityType: 'user', entityId: user.id, summary: 'Masuk',
  })
  return c.json({
    user: {
      id: user.id, username: user.username, name: user.name, role: user.role,
      allProperties: user.role === 'superadmin' || user.allProperties, propertyIds: user.propertyIds,
      mustChangePassword: user.mustChangePassword,
    },
  })
})

authRoutes.post('/logout', async (c) => {
  const u = c.get('user')
  await destroySession(c, c.get('sessionId'))
  if (u) await writeAudit(u, c.get('ip'), { action: 'auth.logout', entityType: 'user', entityId: u.id, summary: 'Keluar' })
  return c.json({ ok: true })
})

/** Works even while a password change is pending — the client needs it to route. */
authRoutes.get('/me', (c) => {
  const u = c.get('user')
  if (!u) throw unauthorized()
  return c.json({ user: u })
})

authRoutes.post('/change-password', async (c) => {
  const u = c.get('user')
  if (!u) throw unauthorized()
  const body = parse(
    z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }),
    await jsonBody(c),
  )
  const limited = hit(`pwchange:${u.id}`, 10, 15 * 60_000)
  if (!limited.ok) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi nanti.', 'rate_limited')

  const row = await db.query.users.findFirst({ where: eq(schema.users.id, u.id) })
  if (!row || !(await verifyPassword(row.passwordHash, body.currentPassword))) {
    throw badRequest('Password saat ini salah.')
  }
  if (body.newPassword === body.currentPassword) throw badRequest('Password baru harus berbeda dari password saat ini.')
  const problem = passwordProblem(body.newPassword, row.username)
  if (problem) throw badRequest(problem)

  await db.update(schema.users).set({
    passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, updatedAt: new Date().toISOString(),
  }).where(eq(schema.users.id, u.id))
  // Every other device must sign in again with the new password.
  await revokeUserSessions(u.id, c.get('sessionId') ?? undefined)
  await writeAudit(u, c.get('ip'), {
    action: 'auth.change_password', entityType: 'user', entityId: u.id, summary: 'Ganti password',
  })
  return c.json({ ok: true })
})

authRoutes.get('/sessions', async (c) => {
  const u = requireUser(c)
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id)).orderBy(desc(schema.sessions.lastSeenAt))
  return c.json({
    sessions: rows.map((s) => ({
      id: s.id.slice(0, 12),
      current: s.id === c.get('sessionId'),
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: iso(s.createdAt),
      lastSeenAt: iso(s.lastSeenAt),
    })),
  })
})

authRoutes.post('/logout-others', async (c) => {
  const u = requireUser(c)
  await revokeUserSessions(u.id, c.get('sessionId') ?? undefined)
  await writeAudit(u, c.get('ip'), {
    action: 'auth.logout_others', entityType: 'user', entityId: u.id, summary: 'Keluar dari semua perangkat lain',
  })
  return c.json({ ok: true })
})

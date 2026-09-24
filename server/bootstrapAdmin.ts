import { and, eq, isNull, sql as dsql } from 'drizzle-orm'
import { hashPassword } from './auth/password'
import { db, schema } from './db/client'
import { temporaryPassword } from './lib/crypto'
import { log } from './lib/log'

/**
 * First boot on an empty database: create one superadmin with a temporary
 * password and print it once to the server log. It must be changed at first
 * login. No email is involved anywhere.
 */
export async function ensureInitialSuperadmin() {
  const count = await db.select({ c: dsql<number>`count(*)` }).from(schema.users).where(isNull(schema.users.deletedAt))
  if (Number(count[0].c) > 0) return

  const username = (process.env.INITIAL_ADMIN_USERNAME || 'admin').toLowerCase()
  const temp = temporaryPassword()
  await db.insert(schema.users).values({
    username,
    name: process.env.INITIAL_ADMIN_NAME || 'Superadmin',
    role: 'superadmin',
    allProperties: true,
    passwordHash: await hashPassword(temp),
    mustChangePassword: true,
  })
  const bar = '='.repeat(64)
  console.log(`\n${bar}\n  AKUN SUPERADMIN PERTAMA DIBUAT\n  Username : ${username}\n  Password : ${temp}\n  Password ini sementara — Anda wajib menggantinya saat login pertama.\n${bar}\n`)
  log.info('Superadmin awal dibuat', { username })
}

/** CLI helper: reset (or create) a user's password and return the temporary one. */
export async function resetPasswordFor(username: string) {
  const user = await db.query.users.findFirst({
    where: and(dsql`lower(${schema.users.username}) = ${username.toLowerCase()}`, isNull(schema.users.deletedAt)),
  })
  if (!user) return null
  const temp = temporaryPassword()
  await db.update(schema.users).set({
    passwordHash: await hashPassword(temp), mustChangePassword: true, failedAttempts: 0, lockedUntil: null, isActive: true,
  }).where(eq(schema.users.id, user.id))
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id))
  return { user, temp }
}

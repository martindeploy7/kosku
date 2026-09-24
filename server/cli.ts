/* Operator commands, run on the server:
 *   node dist-server/cli.js reset-password <username>
 *   node dist-server/cli.js create-superadmin <username> [nama]
 *   node dist-server/cli.js unlock <username>
 *   node dist-server/cli.js seed-demo [--force]
 *   node dist-server/cli.js run-daily
 *   node dist-server/cli.js migrate
 * In Docker: docker compose exec app node dist-server/cli.js <command> */

import { and, eq, isNull, sql as dsql } from 'drizzle-orm'
import { hashPassword } from './auth/password'
import { resetPasswordFor } from './bootstrapAdmin'
import { db, schema, sql } from './db/client'
import { runMigrations } from './db/migrate'
import { jobDailyBilling, jobDailyDigest, jobTenantReminders } from './jobs/daily'
import { temporaryPassword } from './lib/crypto'
import { seedDemo } from './seed'

const [cmd, ...args] = process.argv.slice(2)

function box(lines: string[]) {
  const bar = '='.repeat(60)
  console.log(`\n${bar}\n${lines.map((l) => '  ' + l).join('\n')}\n${bar}\n`)
}

async function main() {
  switch (cmd) {
    case 'migrate':
      await runMigrations()
      break

    case 'reset-password': {
      const username = args[0]
      if (!username) throw new Error('Pakai: reset-password <username>')
      await runMigrations()
      const r = await resetPasswordFor(username)
      if (!r) throw new Error(`Pengguna "${username}" tidak ditemukan.`)
      box([`Password sementara untuk @${r.user.username}:`, r.temp, 'Semua sesi pengguna ini sudah dikeluarkan. Wajib ganti password saat login.'])
      break
    }

    case 'create-superadmin': {
      const [username, ...nameParts] = args
      if (!username) throw new Error('Pakai: create-superadmin <username> [nama]')
      await runMigrations()
      const exists = await db.query.users.findFirst({
        where: and(dsql`lower(${schema.users.username}) = ${username.toLowerCase()}`, isNull(schema.users.deletedAt)),
      })
      if (exists) throw new Error(`Username "${username}" sudah dipakai. Gunakan reset-password.`)
      const temp = temporaryPassword()
      await db.insert(schema.users).values({
        username: username.toLowerCase(), name: nameParts.join(' ') || username, role: 'superadmin',
        allProperties: true, passwordHash: await hashPassword(temp), mustChangePassword: true,
      })
      box([`Superadmin @${username.toLowerCase()} dibuat.`, `Password sementara: ${temp}`])
      break
    }

    case 'unlock': {
      const username = args[0]
      if (!username) throw new Error('Pakai: unlock <username>')
      const res = await db.update(schema.users).set({ failedAttempts: 0, lockedUntil: null })
        .where(dsql`lower(${schema.users.username}) = ${username.toLowerCase()}`).returning({ id: schema.users.id })
      console.log(res.length ? `Akun @${username} dibuka kuncinya.` : 'Pengguna tidak ditemukan.')
      break
    }

    case 'seed-demo': {
      await runMigrations()
      const admins = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, 'superadmin'))
      if (!admins.length) {
        const { ensureInitialSuperadmin } = await import('./bootstrapAdmin')
        await ensureInitialSuperadmin()
      }
      console.log(await seedDemo({ force: args.includes('--force') }))
      break
    }

    case 'run-daily':
      console.log('billing', await jobDailyBilling())
      console.log('digest', await jobDailyDigest())
      console.log('reminders', await jobTenantReminders(undefined, { force: true }))
      break

    default:
      console.log('Perintah: migrate | reset-password <username> | create-superadmin <username> [nama] | unlock <username> | seed-demo [--force] | run-daily')
      process.exitCode = cmd ? 1 : 0
  }
}

main()
  .catch((e) => {
    const cause = (e as { cause?: { message?: string; detail?: string } })?.cause
    console.error('Gagal:', cause?.message ? `${cause.message}${cause.detail ? ' — ' + cause.detail : ''}` : e instanceof Error ? e.message.slice(0, 500) : e)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))

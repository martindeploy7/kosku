import { eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { db, schema } from '../db/client'
import { env } from '../env'
import { errMeta, log } from '../lib/log'
import { notify } from '../services/notify'
import { jobDailyBilling, jobDailyDigest, jobRecurringExpenses, jobTenantReminders } from './daily'

/* Scheduled work runs on pg-boss (Postgres-backed queue): schedules survive
 * restarts, and `missed: 'once'` replays a run that fell inside downtime.
 * Every job is idempotent, so a replay never double-bills or double-sends. */

let boss: PgBoss | null = null

async function recordRun<T extends Record<string, unknown>>(name: string, fn: () => Promise<T>): Promise<T> {
  const [run] = await db.insert(schema.jobRuns).values({ name, status: 'running' }).returning()
  try {
    const result = await fn()
    await db.update(schema.jobRuns).set({ status: 'ok', finishedAt: new Date().toISOString(), result }).where(eq(schema.jobRuns.id, run.id))
    log.info(`Job ${name} selesai`, result)
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.update(schema.jobRuns).set({ status: 'error', finishedAt: new Date().toISOString(), error: message }).where(eq(schema.jobRuns.id, run.id))
    log.error(`Job ${name} gagal`, errMeta(e))
    await notify(db, {
      type: 'job_failed', severity: 'danger', audience: 'superadmin',
      title: `Tugas otomatis gagal: ${name}`, body: message.slice(0, 300), link: '/settings?tab=system',
      dedupeKey: `job_failed:${name}:${new Date().toISOString().slice(0, 13)}`,
    }).catch(() => {})
    throw e
  }
}

async function pingHealthcheck(suffix = '') {
  if (!env.HEALTHCHECK_URL) return
  try {
    await fetch(env.HEALTHCHECK_URL + suffix, { signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    log.warn('Ping healthcheck gagal', errMeta(e))
  }
}

export async function runDailyNow() {
  const expenses = await recordRun('recurring-expenses', () => jobRecurringExpenses() as Promise<Record<string, unknown>>)
  const billing = await recordRun('daily-billing', () => jobDailyBilling() as unknown as Promise<Record<string, unknown>>)
  const digest = await recordRun('daily-digest', () => jobDailyDigest())
  const reminders = await recordRun('tenant-reminders', () => jobTenantReminders(undefined, { force: true }) as Promise<Record<string, unknown>>)
  return { expenses, billing, digest, reminders }
}

const JOBS = {
  'recurring-expenses': { cron: '10 0 * * *', run: () => jobRecurringExpenses() as Promise<Record<string, unknown>>, ping: false },
  'daily-billing': { cron: '5 0 * * *', run: () => jobDailyBilling() as unknown as Promise<Record<string, unknown>>, ping: true },
  'daily-digest': { cron: '0 7 * * *', run: () => jobDailyDigest(), ping: false },
  // Hourly; the job itself waits for the configured send hour and dedupes.
  'tenant-reminders': { cron: '0 * * * *', run: () => jobTenantReminders() as Promise<Record<string, unknown>>, ping: false },
} as const

export async function startJobs() {
  if (!env.JOBS_ENABLED) {
    log.info('Job terjadwal dinonaktifkan (JOBS_ENABLED=false)')
    return
  }
  boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' })
  boss.on('error', (e) => log.error('pg-boss error', errMeta(e)))
  await boss.start()

  for (const [name, job] of Object.entries(JOBS)) {
    await boss.createQueue(name).catch(() => {})
    await boss.schedule(name, job.cron, {}, { tz: env.APP_TIMEZONE, missed: 'once' })
    await boss.work(name, async () => {
      await recordRun(name, job.run)
      if (job.ping) await pingHealthcheck()
    })
  }
  log.info('Job terjadwal aktif', { timezone: env.APP_TIMEZONE, jobs: Object.keys(JOBS) })

  // Catch up right after boot: billing state must be current before anyone looks.
  setTimeout(() => {
    void recordRun('recurring-expenses', JOBS['recurring-expenses'].run)
      .then(() => recordRun('daily-billing', JOBS['daily-billing'].run))
      .then(() => recordRun('daily-digest', JOBS['daily-digest'].run))
      .catch(() => {})
  }, 5_000)
}

export async function stopJobs() {
  await boss?.stop({ graceful: true, timeout: 10_000 }).catch(() => {})
}

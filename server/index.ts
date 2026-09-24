import { serve } from '@hono/node-server'
import { createApp } from './app'
import { ensureInitialSuperadmin } from './bootstrapAdmin'
import { sql } from './db/client'
import { runMigrations } from './db/migrate'
import { env } from './env'
import { startJobs, stopJobs } from './jobs'
import { errMeta, log } from './lib/log'
import { initPush } from './services/push'
import { initWhatsApp } from './wa/manager'

/** The database may still be starting (docker compose, `npm run dev`): wait instead of crashing. */
async function waitForDatabase(attempts = 60) {
  for (let i = 1; ; i++) {
    try {
      await sql`select 1`
      return
    } catch (e) {
      if (i >= attempts) throw e
      if (i === 1 || i % 10 === 0) log.info('Menunggu database siap…', { attempt: i })
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

async function main() {
  await waitForDatabase()
  await runMigrations()
  await ensureInitialSuperadmin()
  await initPush()

  const app = createApp()
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
    log.info(`Kosku berjalan di http://${info.address}:${info.port}`, { publicUrl: env.PUBLIC_URL, wa: env.WA_DRIVER })
  })

  await initWhatsApp().catch((e) => log.error('Inisialisasi WhatsApp gagal', errMeta(e)))
  await startJobs().catch((e) => log.error('Job terjadwal gagal dimulai', errMeta(e)))

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info(`Menerima ${signal}, mematikan dengan rapi…`)
    server.close()
    await stopJobs()
    await sql.end({ timeout: 5 })
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (e) => log.error('Unhandled rejection', errMeta(e)))
}

main().catch((e) => {
  log.error('Gagal memulai server', errMeta(e))
  process.exit(1)
})

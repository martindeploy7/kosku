import path from 'node:path'
import { sql as dsql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { env } from '../env'
import { log } from '../lib/log'
import { db } from './client'

/** Applies pending migrations. Runs on every boot — drizzle tracks what is applied. */
export async function runMigrations() {
  const folder = path.resolve(env.MIGRATIONS_DIR)
  // Names, templates and WhatsApp messages contain emoji and non-Latin text.
  const enc = await db.execute<{ server_encoding: string }>(dsql`show server_encoding`)
  if (enc[0]?.server_encoding !== 'UTF8') {
    throw new Error(`Database harus ber-encoding UTF8 (sekarang: ${enc[0]?.server_encoding}). Buat ulang database dengan ENCODING 'UTF8'.`)
  }
  log.info('Menjalankan migrasi database', { folder })
  await migrate(db, { migrationsFolder: folder })
  log.info('Migrasi selesai')
}

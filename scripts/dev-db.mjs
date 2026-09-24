/* Local development database: a real PostgreSQL 17 (embedded binaries), no
 * Docker needed. Data persists in ./.devdb between runs.
 *   node scripts/dev-db.mjs          start and keep running
 *   node scripts/dev-db.mjs --reset  wipe the data directory first */
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const dir = path.resolve('.devdb')
const port = Number(process.env.DEV_DB_PORT ?? 54329)
if (process.argv.includes('--reset') && existsSync(dir)) rmSync(dir, { recursive: true, force: true })

const fresh = !existsSync(path.join(dir, 'PG_VERSION'))
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'kosku', password: 'kosku', port, persistent: true, onLog: () => {},
  // UTF-8 regardless of the OS locale (Windows would otherwise pick WIN1252 and reject emoji).
  initdbFlags: ['--encoding=UTF8', '--no-locale'],
})
if (fresh) await pg.initialise()
await pg.start()
if (fresh) await pg.createDatabase('kosku')
console.log(`[dev-db] PostgreSQL siap: postgres://kosku:kosku@localhost:${port}/kosku`)

const stop = async () => { await pg.stop(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
setInterval(() => {}, 1 << 30)

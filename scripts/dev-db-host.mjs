import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const dataDir = resolve(root, '.devdata/postgres')
const logFile = resolve(root, '.devdata/postgres.log')
const port = '54329'

mkdirSync(resolve(root, '.devdata'), { recursive: true })

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  return result
}

if (!existsSync(resolve(dataDir, 'PG_VERSION'))) {
  const initialized = run('initdb', ['-D', dataDir, '--username=kosku', '--auth=trust'])
  if (initialized.status !== 0) process.exit(initialized.status ?? 1)
}

const ready = spawnSync('pg_isready', ['-h', '127.0.0.1', '-p', port], { stdio: 'ignore' })
if (ready.status !== 0) {
  const started = run('pg_ctl', ['-D', dataDir, '-o', `-p ${port}`, '-l', logFile, 'start'])
  if (started.status !== 0) process.exit(started.status ?? 1)
}

const database = spawnSync(
  'psql',
  ['-h', '127.0.0.1', '-p', port, '-U', 'kosku', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'kosku'"],
  { encoding: 'utf8' },
)
if (database.status !== 0) process.exit(database.status ?? 1)

if (database.stdout.trim() !== '1') {
  const created = run('createdb', ['-h', '127.0.0.1', '-p', port, '-U', 'kosku', 'kosku'])
  if (created.status !== 0) process.exit(created.status ?? 1)
}

console.log(`PostgreSQL lokal siap di 127.0.0.1:${port}/kosku`)

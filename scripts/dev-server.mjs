/* Development API runner: restarts the server when server/ or shared/ change.
 * (tsx watch hangs under `concurrently` on Windows, and `node --watch` also reacts
 * to the database files in .devdb — so we watch exactly our own source folders.) */
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'

const args = ['--env-file=.env.development', '--import', 'tsx', 'server/index.ts']
let child = null
let timer = null
let restarting = false

function start() {
  child = spawn(process.execPath, args, { stdio: 'inherit' })
  child.on('exit', (code, signal) => {
    if (restarting) return
    if (signal !== 'SIGTERM') console.log(`[dev-server] server berhenti (kode ${code}). Menunggu perubahan berkas…`)
  })
}

function restart(file) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    console.log(`[dev-server] perubahan: ${file} — memulai ulang`)
    restarting = true
    const old = child
    if (old && old.exitCode === null) {
      old.once('exit', () => { restarting = false; start() })
      old.kill('SIGTERM')
    } else {
      restarting = false
      start()
    }
  }, 250)
}

for (const dir of ['server', 'shared']) {
  watch(dir, { recursive: true }, (_event, file) => {
    if (file && /\.(ts|tsx|json)$/.test(file) && !file.endsWith('.test.ts')) restart(`${dir}/${file}`)
  })
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill('SIGTERM'); process.exit(0) })
start()

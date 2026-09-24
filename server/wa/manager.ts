import { and, asc, eq, inArray, isNull, lt, notLike, or, sql as dsql } from 'drizzle-orm'
import makeWASocket, {
  Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, isJidGroup, isLidUser, jidNormalizedUser,
  makeCacheableSignalKeyStore, normalizeMessageContent, type WAMessage, type WASocket,
} from 'baileys'
import QRCode from 'qrcode'
import { formatPhoneDisplay, normalizePhone, phoneFromJid, samePhone } from '@shared/phone'
import type { WaConnectionStatus, WaSession } from '@shared/types'
import { db, schema } from '../db/client'
import { env } from '../env'
import { events } from '../lib/events'
import { errMeta, log } from '../lib/log'
import { bumpRev } from '../lib/rev'
import { markContractSent } from '../services/contracts'
import { loadFile } from '../services/files'
import { notify } from '../services/notify'
import { clearAuthState, hasAuthState, usePgAuthState } from './authState'
import { type IncomingMedia, recordIncoming } from './incoming'

/* ---------------------------------------------------------------------------
 * One WhatsApp number per property, linked by scanning a QR code.
 *
 * The number that scans MUST be the number configured on the property. When a
 * different phone scans, the link is rejected on the spot: the device is logged
 * out and its credentials wiped, so tenants never receive messages from a
 * number they don't recognise.
 * ------------------------------------------------------------------------- */

interface Session {
  propertyId: string
  status: WaConnectionStatus
  phone: string | null
  qr: string | null
  lastError: string | null
  sock: WASocket | null
  /** Set while we tear the socket down on purpose, so "close" isn't treated as a drop. */
  stopping: boolean
  retries: number
  sending: boolean
  /** Mock driver only: pretend this number scanned. */
  mockPhone?: string
}

const sessions = new Map<string, Session>()

const silentLogger = {
  level: 'silent',
  child() {
    return silentLogger
  },
  trace() {},
  debug() {},
  info() {},
  warn(obj: unknown, msg?: string) {
    log.debug('baileys warn', { msg, obj: typeof obj === 'object' ? undefined : obj })
  },
  error(obj: unknown, msg?: string) {
    log.debug('baileys error', { msg })
  },
}

function session(propertyId: string): Session {
  let s = sessions.get(propertyId)
  if (!s) {
    s = { propertyId, status: 'disconnected', phone: null, qr: null, lastError: null, sock: null, stopping: false, retries: 0, sending: false }
    sessions.set(propertyId, s)
  }
  return s
}

async function persist(s: Session) {
  await db
    .insert(schema.waSessions)
    .values({ propertyId: s.propertyId, status: s.status, phone: s.phone, lastError: s.lastError })
    .onConflictDoUpdate({
      target: schema.waSessions.propertyId,
      set: {
        status: s.status, phone: s.phone, lastError: s.lastError, updatedAt: new Date().toISOString(),
        connectedAt: s.status === 'connected' ? new Date().toISOString() : undefined,
      },
    })
  bumpRev()
}

async function setStatus(s: Session, status: WaConnectionStatus, patch: Partial<Session> = {}) {
  Object.assign(s, patch, { status })
  if (status !== 'qr') s.qr = null
  await persist(s)
}

async function expectedPhone(propertyId: string) {
  const p = await db.query.properties.findFirst({ where: eq(schema.properties.id, propertyId) })
  return p && !p.deletedAt ? p : null
}

/* ------------------------------------------------------------------ public API */

export async function getSessionStatus(propertyId: string): Promise<WaSession> {
  const property = await expectedPhone(propertyId)
  const s = session(propertyId)
  if (s.status === 'disconnected' && !s.lastError) {
    const row = await db.query.waSessions.findFirst({ where: eq(schema.waSessions.propertyId, propertyId) })
    if (row?.status === 'mismatch') {
      s.status = 'mismatch'
      s.lastError = row.lastError
    }
  }
  return {
    propertyId,
    status: s.status,
    phone: s.phone,
    expectedPhone: property?.phone ?? '',
    lastError: s.lastError,
    qr: s.qr,
    driver: env.WA_DRIVER,
  }
}

export const isConnected = (propertyId: string) => sessions.get(propertyId)?.status === 'connected'

export function connectionStatuses() {
  return Object.fromEntries([...sessions.values()].map((s) => [s.propertyId, s.status]))
}

/** Start linking: produces a QR code to scan with the property's phone. */
export async function connect(propertyId: string, opts: { mockPhone?: string } = {}) {
  const property = await expectedPhone(propertyId)
  if (!property) throw new Error('Properti tidak ditemukan')
  if (!property.phone) throw new Error('Isi nomor WhatsApp properti terlebih dahulu.')
  const s = session(propertyId)
  if (s.status === 'connected' || s.status === 'connecting' || s.status === 'qr') return getSessionStatus(propertyId)
  s.lastError = null
  s.retries = 0
  s.mockPhone = opts.mockPhone
  await start(s)
  return getSessionStatus(propertyId)
}

/** Unlink the device (logs out on the phone too) and forget its credentials. */
export async function disconnect(propertyId: string, reason = 'Diputuskan oleh admin') {
  const s = session(propertyId)
  s.stopping = true
  try {
    if (s.sock) await s.sock.logout().catch(() => {})
  } finally {
    s.sock?.end(undefined)
    s.sock = null
    s.stopping = false
  }
  await clearAuthState(propertyId)
  await setStatus(s, 'disconnected', { phone: null, lastError: null })
  log.info('WhatsApp diputuskan', { propertyId, reason })
}

/** Stop the socket but keep credentials (used when a property is soft-deleted). */
async function suspend(propertyId: string) {
  const s = sessions.get(propertyId)
  if (!s) return
  s.stopping = true
  s.sock?.end(undefined)
  s.sock = null
  s.stopping = false
  await setStatus(s, 'disconnected', { lastError: null })
}

/** Reconnect every property that has saved credentials. Called at boot. */
export async function initWhatsApp() {
  // A restart mid-send leaves rows in "sending" forever; put them back in the queue.
  // (attempts was already counted, so a message is still tried at most MAX_ATTEMPTS times.)
  await db.update(schema.waMessages).set({ status: 'queued' }).where(eq(schema.waMessages.status, 'sending'))
  const props = await db.select().from(schema.properties).where(isNull(schema.properties.deletedAt))
  for (const p of props) {
    const row = await db.query.waSessions.findFirst({ where: eq(schema.waSessions.propertyId, p.id) })
    if (row?.status === 'mismatch') {
      const s = session(p.id)
      s.status = 'mismatch'
      s.lastError = row.lastError
    }
    if (env.WA_DRIVER === 'mock' ? row?.status === 'connected' : await hasAuthState(p.id)) {
      const s = session(p.id)
      if (env.WA_DRIVER === 'mock') s.mockPhone = row?.phone ?? p.phone
      await start(s).catch((e) => log.error('Gagal menyambungkan ulang WhatsApp', { propertyId: p.id, ...errMeta(e) }))
    } else if (row && row.status !== 'disconnected' && row.status !== 'mismatch') {
      await setStatus(session(p.id), 'disconnected')
    }
  }
  events.on('wa:outbox', (propertyId) => void drain(propertyId))
  events.on('property:deleted', (propertyId) => void suspend(propertyId))
  events.on('property:restored', async (propertyId) => {
    if (await hasAuthState(propertyId)) void start(session(propertyId))
  })
  // Safety net: retry anything left queued (e.g. sent while disconnected).
  setInterval(() => {
    for (const s of sessions.values()) if (s.status === 'connected') void drain(s.propertyId)
  }, 30_000).unref()
}

/* ------------------------------------------------------------------ lifecycle */

async function onLinked(s: Session, linkedJid: string | undefined) {
  const property = await expectedPhone(s.propertyId)
  const linked = normalizePhone(phoneFromJid(linkedJid))
  if (!property) return

  if (!samePhone(linked, property.phone)) {
    // The wrong phone scanned. Undo the link immediately.
    const msg = `Nomor yang memindai QR (${formatPhoneDisplay(linked)}) berbeda dengan nomor WhatsApp properti (${formatPhoneDisplay(property.phone)}). Tautan dibatalkan otomatis — pindai ulang menggunakan HP dengan nomor properti.`
    log.warn('Nomor WhatsApp tidak cocok, tautan dibatalkan', { propertyId: s.propertyId, linked, expected: property.phone })
    s.stopping = true
    try {
      await s.sock?.logout().catch(() => {})
    } finally {
      s.sock?.end(undefined)
      s.sock = null
      s.stopping = false
    }
    await clearAuthState(s.propertyId)
    await setStatus(s, 'mismatch', { phone: null, lastError: msg })
    await notify(db, {
      type: 'wa_mismatch', severity: 'warning', title: `WhatsApp ${property.name}: nomor tidak cocok`,
      body: msg, link: `/properties/${property.id}?tab=whatsapp`, propertyId: property.id,
    })
    return
  }

  s.retries = 0
  await setStatus(s, 'connected', { phone: linked, lastError: null })
  await notify(db, {
    type: 'wa_connected', severity: 'success', title: `WhatsApp ${property.name} terhubung`,
    body: `Pesan otomatis dikirim dari ${formatPhoneDisplay(linked)}.`,
    link: `/properties/${property.id}?tab=whatsapp`, propertyId: property.id,
    dedupeKey: `wa_connected:${property.id}:${new Date().toISOString().slice(0, 13)}`, push: false,
  })
  void drain(s.propertyId)
}

async function start(s: Session) {
  if (env.WA_DRIVER === 'mock') return startMock(s)
  await setStatus(s, 'connecting')

  const { state, saveCreds } = await usePgAuthState(s.propertyId)
  const version = await fetchLatestBaileysVersion()
    .then((v) => v.version)
    .catch(() => undefined)

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
    logger: silentLogger,
    browser: Browsers.ubuntu('Kosku'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  })
  s.sock = sock
  const wasRegistered = Boolean(state.creds.me?.id)

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u) => {
    try {
      if (u.qr) {
        s.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 })
        s.status = 'qr'
        await persist(s)
      }
      if (u.connection === 'open') {
        await onLinked(s, sock.user?.id)
      }
      if (u.connection === 'close') {
        if (s.sock !== sock) return // superseded
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
        s.sock = null
        if (s.stopping || s.status === 'mismatch') return

        if (code === DisconnectReason.loggedOut) {
          await clearAuthState(s.propertyId)
          await setStatus(s, 'disconnected', { phone: null, lastError: 'Perangkat dikeluarkan dari WhatsApp di HP. Pindai QR lagi untuk menghubungkan.' })
          const property = await expectedPhone(s.propertyId)
          await notify(db, {
            type: 'wa_disconnected', severity: 'danger', title: `WhatsApp ${property?.name ?? ''} terputus`,
            body: 'Perangkat dikeluarkan dari HP. Pesan otomatis ke penyewa tertahan sampai dihubungkan lagi.',
            link: `/properties/${s.propertyId}?tab=whatsapp`, propertyId: s.propertyId,
          })
          return
        }

        const everLinked = wasRegistered || Boolean(state.creds.me?.id)
        if (!everLinked) {
          // QR was never scanned and WhatsApp stopped offering new codes.
          await setStatus(s, 'disconnected', { lastError: 'QR kedaluwarsa sebelum dipindai. Klik "Hubungkan" untuk QR baru.' })
          return
        }
        // Transient drop: reconnect with backoff (restartRequired is immediate).
        s.retries += 1
        const delay = code === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2_000 * 2 ** Math.min(s.retries, 5))
        await setStatus(s, 'connecting', { lastError: s.retries > 3 ? 'Koneksi WhatsApp tidak stabil, mencoba lagi…' : null })
        setTimeout(() => void start(s).catch((e) => log.error('Gagal reconnect WhatsApp', errMeta(e))), delay)
      }
    } catch (e) {
      log.error('Kesalahan pada event koneksi WhatsApp', errMeta(e))
    }
  })

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) void handleIncoming(s, m)
  })

  sock.ev.on('messages.update', (updates) => {
    for (const up of updates) {
      const st = up.update.status
      if (!up.key.fromMe || !up.key.id || st == null) continue
      // 3 = delivered to device, 4 = read
      const status = st >= 4 ? 'read' : st >= 3 ? 'delivered' : null
      if (status) {
        void db.update(schema.waMessages).set({ status }).where(eq(schema.waMessages.waMessageId, up.key.id)).then(() => bumpRev())
      }
    }
  })
}

/* ------------------------------------------------------------------ mock driver */

async function startMock(s: Session) {
  const property = await expectedPhone(s.propertyId)
  const scanning = normalizePhone(s.mockPhone || property?.phone || '')
  if (await hasMockLink(s)) {
    await onLinked(s, `${scanning}@s.whatsapp.net`)
    return
  }
  s.qr = await QRCode.toDataURL(`kosku-mock:${s.propertyId}`, { margin: 1, width: 320 })
  await setStatus(s, 'qr', { qr: s.qr })
  // Simulate the admin scanning after a few seconds.
  setTimeout(() => void onLinked(s, `${scanning}@s.whatsapp.net`), 2500)
}

async function hasMockLink(s: Session) {
  const row = await db.query.waSessions.findFirst({ where: eq(schema.waSessions.propertyId, s.propertyId) })
  return row?.status === 'connected'
}

/* ------------------------------------------------------------------ incoming */

function textOf(content: NonNullable<WAMessage['message']>): string {
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    (content.videoMessage ? '[Video]' : '') ||
    (content.audioMessage ? '[Pesan suara]' : '') ||
    (content.stickerMessage ? '[Stiker]' : '') ||
    (content.locationMessage ? '[Lokasi]' : '') ||
    (content.contactMessage ? '[Kontak]' : '') ||
    ''
  )
}

async function handleIncoming(s: Session, m: WAMessage) {
  try {
    const jid = m.key.remoteJid
    if (!jid || m.key.fromMe || isJidGroup(jid) || jid.endsWith('@broadcast') || jid === 'status@broadcast') return
    // Newer WhatsApp addresses many chats by LID; the phone number rides along in remoteJidAlt.
    const pnJid = isLidUser(jid) ? m.key.remoteJidAlt ?? '' : jid
    const phone = normalizePhone(phoneFromJid(jidNormalizedUser(pnJid)))
    if (!phone) return
    // Unwraps view-once / ephemeral / document-with-caption envelopes.
    const content = normalizeMessageContent(m.message)
    if (!content) return

    const image = content.imageMessage
    const document = content.documentMessage
    const sock = s.sock
    const media: IncomingMedia | null = image || document
      ? {
          type: image ? 'image' : 'document',
          fileName: document?.fileName ?? '',
          size: Number((image ?? document)?.fileLength ?? 0),
          download: async () => {
            if (!sock) throw new Error('WhatsApp tidak terhubung.')
            return (await downloadMediaMessage(m, 'buffer', {}, {
              logger: silentLogger as never, reuploadRequest: sock.updateMediaMessage,
            })) as Buffer
          },
        }
      : null

    await recordIncoming(s.propertyId, { phone, body: textOf(content), waMessageId: m.key.id ?? null, media })
  } catch (e) {
    log.error('Gagal menyimpan pesan WhatsApp masuk', errMeta(e))
  }
}

/* ------------------------------------------------------------------ outbox */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pace = () => env.WA_MIN_DELAY_MS + Math.random() * Math.max(0, env.WA_MAX_DELAY_MS - env.WA_MIN_DELAY_MS)

/** Automated nudges lose their point if they arrive days late (e.g. after a long disconnect). */
const STALE_PREFIXES = ['reminder:', 'due:', 'overdue:', 'birthday:']
/** Messages nobody pressed "send" for: held overnight so a reconnect at 23:00 doesn't wake tenants up. */
const AUTOMATED_PREFIXES = [...STALE_PREFIXES, 'lapsed:']
const QUIET_FROM = 21
const QUIET_UNTIL = 6
const MAX_ATTEMPTS = 3

function isQuietHour() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: env.APP_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  return hour >= QUIET_FROM || hour < QUIET_UNTIL
}

async function expireStale(propertyId: string) {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString()
  const stale = await db
    .select({ id: schema.waMessages.id, key: schema.waMessages.dedupeKey })
    .from(schema.waMessages)
    .where(and(eq(schema.waMessages.propertyId, propertyId), eq(schema.waMessages.status, 'queued'), lt(schema.waMessages.createdAt, cutoff)))
  const ids = stale.filter((r) => r.key && STALE_PREFIXES.some((p) => r.key!.startsWith(p))).map((r) => r.id)
  if (ids.length) {
    await db.update(schema.waMessages)
      .set({ status: 'failed', error: 'Kedaluwarsa: WhatsApp tidak terhubung lebih dari 24 jam.' })
      .where(inArray(schema.waMessages.id, ids))
  }
}

/** Send queued messages for one property, one at a time, with human-like pauses. */
async function drain(propertyId: string) {
  const s = sessions.get(propertyId)
  if (!s || s.status !== 'connected' || s.sending) return
  s.sending = true
  try {
    await expireStale(propertyId)
    for (;;) {
      if (s.status !== 'connected') break
      const key = schema.waMessages.dedupeKey
      const [msg] = await db
        .select()
        .from(schema.waMessages)
        .where(and(
          eq(schema.waMessages.propertyId, propertyId), eq(schema.waMessages.status, 'queued'),
          lt(schema.waMessages.attempts, MAX_ATTEMPTS),
          isQuietHour() ? or(isNull(key), and(...AUTOMATED_PREFIXES.map((p) => notLike(key, `${p}%`)))) : undefined,
        ))
        .orderBy(asc(schema.waMessages.createdAt))
        .limit(1)
      if (!msg) break

      await db.update(schema.waMessages)
        .set({ status: 'sending', attempts: dsql`${schema.waMessages.attempts} + 1` })
        .where(eq(schema.waMessages.id, msg.id))
      try {
        const waId = await deliver(s, msg)
        await db.update(schema.waMessages)
          .set({ status: 'sent', waMessageId: waId, sentAt: new Date().toISOString(), error: null })
          .where(eq(schema.waMessages.id, msg.id))
        await markContractSent(msg.dedupeKey)
        if (msg.dedupeKey?.startsWith('invoice:')) {
          await db.update(schema.invoices).set({ sentAt: new Date().toISOString() })
            .where(eq(schema.invoices.id, msg.dedupeKey.split(':')[1]))
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        const final = msg.attempts + 1 >= MAX_ATTEMPTS || /tidak terdaftar/i.test(error)
        await db.update(schema.waMessages)
          .set({ status: final ? 'failed' : 'queued', error })
          .where(eq(schema.waMessages.id, msg.id))
        if (final) {
          await notify(db, {
            type: 'wa_failed', severity: 'warning', title: 'Pesan WhatsApp gagal terkirim',
            body: `Ke ${formatPhoneDisplay(msg.phone)}: ${error}`, link: `/chat?property=${propertyId}&phone=${msg.phone}`,
            propertyId, dedupeKey: `wa_failed:${msg.id}`,
          })
        } else {
          await sleep(15_000)
        }
      }
      bumpRev()
      await sleep(pace())
    }
  } finally {
    s.sending = false
  }
}

async function deliver(s: Session, msg: typeof schema.waMessages.$inferSelect): Promise<string> {
  if (env.WA_DRIVER === 'mock') {
    await sleep(150)
    if (/^0+$/.test(msg.phone.slice(-6))) throw new Error('Nomor tidak terdaftar di WhatsApp.')
    return `MOCK-${Date.now().toString(36)}`
  }
  const sock = s.sock
  if (!sock) throw new Error('WhatsApp tidak terhubung.')
  const [check] = (await sock.onWhatsApp(msg.phone)) ?? []
  if (!check?.exists) throw new Error('Nomor tidak terdaftar di WhatsApp.')
  const jid = check.jid

  if (msg.type === 'document' && msg.fileId) {
    const { row, buffer } = await loadFile(msg.fileId, { includeDeleted: true })
    const sent = await sock.sendMessage(jid, {
      document: buffer, mimetype: row.mime, fileName: msg.fileName ?? row.originalName, caption: msg.body,
    })
    return sent?.key.id ?? ''
  }
  const sent = await sock.sendMessage(jid, { text: msg.body })
  return sent?.key.id ?? ''
}

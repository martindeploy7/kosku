import { and, inArray, isNull } from 'drizzle-orm'
import { daysBetween, formatDate, formatIDR } from '@shared/dates'
import { buildTakeaways, outstanding } from '@shared/finance'
import { purgeExpiredSessions } from '../auth/session'
import { db, schema } from '../db/client'
import { env } from '../env'
import { Effects } from '../lib/effects'
import { bumpRev } from '../lib/rev'
import { appToday, runDailyBilling } from '../services/billing'
import { toContract, toInvoice, toRental, toRoom } from '../services/mappers'
import { invoiceVars, queueWa, render } from '../services/messages'
import { notify } from '../services/notify'
import { getAppSettings } from '../services/settings'

/* ------------------------------------------------------------------ billing */

export async function jobDailyBilling(asOf = appToday()) {
  const fx = new Effects()
  const result = await db.transaction((tx) => runDailyBilling(tx, fx, asOf))
  await fx.run()
  await purgeExpiredSessions()
  bumpRev()
  return result
}

/* ------------------------------------------------------------------ admin awareness */

async function loadLive() {
  const [properties, rooms, rentals, invoices, contracts, tenants] = await Promise.all([
    db.select().from(schema.properties).where(isNull(schema.properties.deletedAt)),
    db.select().from(schema.rooms).where(isNull(schema.rooms.deletedAt)),
    db.select().from(schema.rentals).where(and(isNull(schema.rentals.deletedAt), inArray(schema.rentals.status, ['booked', 'active', 'lapsed']))),
    db.select().from(schema.invoices).where(isNull(schema.invoices.deletedAt)),
    db.select().from(schema.contracts).where(isNull(schema.contracts.deletedAt)),
    db.select().from(schema.tenants).where(isNull(schema.tenants.deletedAt)),
  ])
  return { properties, rooms, rentals, invoices, contracts, tenants }
}

/**
 * What every admin should know this morning, per property: due today,
 * overdue, DP deadlines, unsigned agreements. Deduplicated per day, so running
 * it twice (catch-up after downtime) never double-notifies.
 */
export async function jobDailyDigest(asOf = appToday()) {
  const data = await loadLive()
  const tenantName = new Map(data.tenants.map((t) => [t.id, t.name]))
  const roomName = new Map(data.rooms.map((r) => [r.id, r.name]))
  const fx = new Effects()
  let created = 0

  for (const p of data.properties) {
    const t = buildTakeaways({
      rentals: data.rentals.map((r) => toRental(r)),
      invoices: data.invoices.map(toInvoice),
      rooms: data.rooms.map(toRoom),
      contracts: data.contracts.map(toContract),
      today: asOf,
      propertyId: p.id,
    })
    const dpSoon = t.dpDeadlines.filter((d) => d.daysLate >= -1)
    const lines = [
      t.dueToday.length && `${t.dueToday.length} jatuh tempo hari ini (${formatIDR(t.totals.dueToday)})`,
      t.overdue.length && `${t.overdue.length} tagihan terlambat (${formatIDR(t.totals.overdue)})`,
      dpSoon.length && `${dpSoon.length} DP harus lunas hari ini/besok`,
      t.unsignedContracts.length && `${t.unsignedContracts.length} perjanjian belum ditandatangani`,
      t.endingSoon.length && `${t.endingSoon.length} sewa berakhir dalam 7 hari`,
    ].filter(Boolean) as string[]

    if (lines.length) {
      const n = await notify(db, {
        type: 'daily_digest',
        severity: t.overdue.length || dpSoon.length ? 'warning' : 'info',
        title: `Hari ini di ${p.name}`,
        body: lines.join(' · '),
        link: '/dashboard',
        propertyId: p.id,
        dedupeKey: `digest:${asOf}:${p.id}`,
        push: true,
      }, fx)
      if (n) created++
    }

    // Individual alerts for things with a hard deadline.
    for (const d of dpSoon) {
      const when = d.daysLate === 0 ? 'hari ini' : d.daysLate < 0 ? 'besok' : `terlewat ${d.daysLate} hari`
      const n = await notify(db, {
        type: 'dp_deadline', severity: 'warning',
        title: `Batas pelunasan DP ${when}: ${tenantName.get(d.tenantId) ?? ''}`,
        body: `${roomName.get(d.roomId) ?? ''} · sisa ${formatIDR(d.amount)} · ${formatDate(d.dueDate, 'long')}. Jika tidak lunas, kamar dilepas otomatis.`,
        link: `/tenants/${d.tenantId}`, propertyId: p.id,
        dedupeKey: `dp_deadline:${d.rentalId}:${asOf}`, push: true,
      }, fx)
      if (n) created++
    }
    for (const d of t.overdue.filter((x) => x.daysLate === 1)) {
      const n = await notify(db, {
        type: 'invoice_overdue', severity: 'warning',
        title: `Terlambat bayar: ${tenantName.get(d.tenantId) ?? ''}`,
        body: `${roomName.get(d.roomId) ?? ''} · ${formatIDR(d.amount)} · jatuh tempo ${formatDate(d.dueDate, 'long')}`,
        link: `/tenants/${d.tenantId}?tab=billing`, propertyId: p.id,
        dedupeKey: `overdue:${d.invoiceId}`, push: false,
      }, fx)
      if (n) created++
    }
    for (const r of t.endingSoon.filter((x) => x.endDate === asOf)) {
      const n = await notify(db, {
        type: 'rental_ending', severity: 'info',
        title: `Sewa berakhir hari ini: ${tenantName.get(r.tenantId) ?? ''}`,
        body: `${roomName.get(r.roomId) ?? ''}. Proses check-out atau perpanjang sewanya.`,
        link: `/tenants/${r.tenantId}`, propertyId: p.id, dedupeKey: `rental_ending:${r.id}:${asOf}`,
      }, fx)
      if (n) created++
    }
  }
  await fx.run()
  return { notifications: created }
}

/* ------------------------------------------------------------------ WhatsApp reminders to tenants */

export async function jobTenantReminders(asOf = appToday(), opts: { force?: boolean } = {}) {
  const settings = await getAppSettings()
  const cfg = settings.notifications
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: env.APP_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  // Send at the configured hour or later (catch-up), never late at night.
  if (!opts.force && (hour < cfg.sendHour || hour > 21)) return { skipped: `menunggu jam ${cfg.sendHour}:00`, queued: 0 }

  const data = await loadLive()
  const propById = new Map(data.properties.map((p) => [p.id, p]))
  const tenantById = new Map(data.tenants.map((t) => [t.id, t]))
  const roomById = new Map(data.rooms.map((r) => [r.id, r]))
  const rentalById = new Map(data.rentals.map((r) => [r.id, r]))
  const fx = new Effects()
  let queued = 0

  const send = async (invoice: (typeof data.invoices)[number], templateId: string, key: string) => {
    const tenant = tenantById.get(invoice.tenantId)
    const property = propById.get(invoice.propertyId)
    if (!tenant?.phone || !property) return
    const row = await queueWa(db, {
      propertyId: property.id, tenantId: tenant.id, phone: tenant.phone,
      body: render(property, templateId, invoiceVars({
        property, tenantName: tenant.name, roomName: roomById.get(invoice.roomId)?.name ?? '', invoice,
      })),
      dedupeKey: key,
    }, fx)
    if (row) queued++
  }

  const br = cfg.billingReminder
  if (br.enabled) {
    for (const inv of data.invoices) {
      const rental = rentalById.get(inv.rentalId)
      if (!rental || inv.status === 'batal' || outstanding(toInvoice(inv)) <= 0) continue
      const d = daysBetween(asOf, inv.dueDate) // positive = days until due

      if (rental.status === 'booked') {
        // DP bookings: one nudge the day before the deadline.
        if (d === 1) await send(inv, 'reminder', `reminder:${inv.id}:dp`)
        continue
      }
      if (rental.status !== 'active') continue
      if (br.beforeDue.enabled && d === br.beforeDue.days) await send(inv, 'reminder', `reminder:${inv.id}:before`)
      if (br.onDue.enabled && d === 0) await send(inv, 'due', `due:${inv.id}`)
      for (const stage of ['first', 'second', 'last'] as const) {
        const s = br[stage]
        if (s.enabled && -d === s.days) await send(inv, 'overdue', `overdue:${inv.id}:${stage}`)
      }
    }
  }

  if (cfg.birthdayGreeting) {
    const md = asOf.slice(5)
    const year = Number(asOf.slice(0, 4))
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    // 29 Februari birthdays are greeted on 28 Februari in non-leap years.
    const isBirthday = (dob: string) => dob.slice(5) === md || (!leap && md === '02-28' && dob.slice(5) === '02-29')
    const activeTenants = new Set(data.rentals.filter((r) => r.status === 'active').map((r) => r.tenantId))
    for (const t of data.tenants) {
      if (!t.dob || !isBirthday(t.dob) || !activeTenants.has(t.id) || !t.phone) continue
      const rental = data.rentals.find((r) => r.tenantId === t.id && r.status === 'active')!
      const property = propById.get(rental.propertyId)
      if (!property) continue
      const row = await queueWa(db, {
        propertyId: property.id, tenantId: t.id, phone: t.phone,
        body: render(property, 'birthday', { penyewa: t.name, properti: property.name }),
        dedupeKey: `birthday:${t.id}:${asOf.slice(0, 4)}`,
      }, fx)
      if (row) queued++
    }
  }

  await fx.run()
  return { queued }
}


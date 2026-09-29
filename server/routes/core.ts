import { and, eq, inArray, isNotNull, isNull, or, sql as dsql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { Hono } from 'hono'
import {
  DEFAULT_HOUSE_RULES, DEFAULT_WA_TEMPLATES, defaultAgreement, defaultBookingPolicy, defaultInvoicePdf, defaultLateFee,
  EXPENSE_CATEGORIES,
} from '@shared/constants'
import { buildAgreementSnapshot, formatAddress } from '@shared/agreement'
import { addDays } from '@shared/dates'
import { isValidPhone, normalizePhone } from '@shared/phone'
import type { Bootstrap } from '@shared/types'
import {
  type AppEnv, accessibleProperties, assertPropertyAccess, canDelete, isSuper, requireRole, requireUser,
} from '../auth/context'
import type { SessionUser } from '../auth/session'
import { type Executor, db, schema } from '../db/client'
import { env } from '../env'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { bumpRev, currentRev } from '../lib/rev'
import { renderAgreementPdf } from '../pdf/agreement'
import { writeAudit } from '../services/audit'
import { appToday } from '../services/billing'
import { loadFile } from '../services/files'
import {
  toContract, toExpense, toInvoice, toPayment, toProperty, toRental, toRoom, toService, toTenant, toUser,
} from '../services/mappers'
import { unreadCount } from '../services/notify'
import { getAppSettings, saveAppSettings } from '../services/settings'
import { listApprovals, pendingResponse, saveProperty, saveRoom } from '../services/approvals'
import { connectionStatuses } from '../wa/manager'
import { approvalReason, deleteOrRequest } from './approvals'
import {
  address, isoDate, items, jsonBody, parse, priceSet, schemes, updateVersioned, uuid, version, z,
} from './util'

export const coreRoutes = new Hono<AppEnv>()


/* ================================================================== bootstrap */

function scoped(user: SessionUser, col: AnyPgColumn): SQL {
  const ids = accessibleProperties(user)
  if (ids === null) return dsql`true`
  return ids.length ? inArray(col, ids) : dsql`false`
}

export async function buildBootstrap(user: SessionUser): Promise<Bootstrap> {
  const live = <T extends { deletedAt: AnyPgColumn }>(t: T) => isNull(t.deletedAt)
  const [properties, rooms, services, rentals, invoices, payments, expenses, contracts, users, tenants, allUsers] =
    await Promise.all([
      db.select().from(schema.properties).where(and(live(schema.properties), scoped(user, schema.properties.id))),
      db.select().from(schema.rooms).where(and(live(schema.rooms), scoped(user, schema.rooms.propertyId))),
      db.select().from(schema.services).where(and(live(schema.services), scoped(user, schema.services.propertyId))),
      db.select().from(schema.rentals).where(and(live(schema.rentals), scoped(user, schema.rentals.propertyId))),
      db.select().from(schema.invoices).where(and(live(schema.invoices), scoped(user, schema.invoices.propertyId))),
      db.select().from(schema.payments).where(and(live(schema.payments), scoped(user, schema.payments.propertyId))),
      db.select().from(schema.expenses).where(and(live(schema.expenses), scoped(user, schema.expenses.propertyId))),
      db.select().from(schema.contracts).where(and(live(schema.contracts), scoped(user, schema.contracts.propertyId))),
      isSuper(user)
        ? db.select().from(schema.users).where(and(live(schema.users), or(eq(schema.users.ownerId, user.ownerId), eq(schema.users.id, user.ownerId))))
        : Promise.resolve([]),
      db.select().from(schema.tenants).where(and(live(schema.tenants), eq(schema.tenants.ownerId, user.ownerId))),
      db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
    ])

  // Tenants: anyone with a lease in scope, plus prospects not tied to another property.
  const scope = accessibleProperties(user)
  const tenantIdsInScope = new Set(rentals.map((r) => r.tenantId))
  // Tenants are already limited to this workspace; a limited account sees only its properties' people.
  const everRented = new Set(
    user.allProperties ? [] : (await db.select({ t: schema.rentals.tenantId }).from(schema.rentals)).map((r) => r.t),
  )
  const visibleTenants = tenants.filter((t) =>
    user.allProperties ||
    tenantIdsInScope.has(t.id) ||
    (!everRented.has(t.id) && (!t.waitlistPropertyId || scope.includes(t.waitlistPropertyId))),
  )

  const received = new Map<string, { deposit: number; dp: number }>()
  for (const p of payments) {
    if (!p.rentalId || (p.kind !== 'deposit' && p.kind !== 'dp') || p.amount <= 0) continue
    const r = received.get(p.rentalId) ?? { deposit: 0, dp: 0 }
    r[p.kind] += p.amount
    received.set(p.rentalId, r)
  }

  const names = new Map(allUsers.map((u) => [u.id, u.name]))
  // Names of deleted records (for history labels) — this workspace only.
  const [delProps, delRooms, delTenants] = await Promise.all([
    db.select({ id: schema.properties.id, name: schema.properties.name }).from(schema.properties)
      .where(and(isNotNull(schema.properties.deletedAt), eq(schema.properties.ownerId, user.ownerId))),
    db.select({ id: schema.rooms.id, name: schema.rooms.name }).from(schema.rooms)
      .innerJoin(schema.properties, eq(schema.properties.id, schema.rooms.propertyId))
      .where(and(isNotNull(schema.rooms.deletedAt), eq(schema.properties.ownerId, user.ownerId))),
    db.select({ id: schema.tenants.id, name: schema.tenants.name }).from(schema.tenants)
      .where(and(isNotNull(schema.tenants.deletedAt), eq(schema.tenants.ownerId, user.ownerId))),
  ])
  const toMap = (rows: { id: string; name: string }[]) => Object.fromEntries(rows.map((r) => [r.id, r.name]))

  return {
    me: user,
    today: appToday(),
    timezone: env.APP_TIMEZONE,
    rev: currentRev(),
    properties: properties.map(toProperty),
    rooms: rooms.map(toRoom),
    services: services.map(toService),
    tenants: visibleTenants.map(toTenant),
    rentals: rentals.map((r) => toRental(r, received.get(r.id))),
    invoices: invoices.map(toInvoice),
    payments: payments.map((p) => toPayment(p, names)),
    expenses: expenses.map(toExpense),
    contracts: contracts.map(toContract),
    users: users.map(toUser),
    settings: await getAppSettings(user.ownerId),
    deletedNames: { properties: toMap(delProps), rooms: toMap(delRooms), tenants: toMap(delTenants) },
    approvals: await listApprovals(user, { status: 'pending' }),
  }
}

coreRoutes.get('/bootstrap', async (c) => {
  const u = requireUser(c)
  c.header('Cache-Control', 'no-store')
  return c.json(await buildBootstrap(u))
})

/** Cheap poll: has anything changed, how many unread notifications, WhatsApp link states. */
coreRoutes.get('/sync', async (c) => {
  const u = requireUser(c)
  c.header('Cache-Control', 'no-store')
  // WhatsApp link states of this user's properties only.
  const wa = Object.fromEntries(Object.entries(connectionStatuses()).filter(([id]) => u.propertyIds.includes(id)))
  return c.json({ rev: currentRev(), unread: await unreadCount(u), wa, today: appToday() })
})

/* ================================================================== settings */

coreRoutes.get('/settings', async (c) => {
  const u = requireUser(c)
  return c.json(await getAppSettings(u.ownerId))
})

const reminder = z.object({ enabled: z.boolean(), days: z.number().int().min(1).max(30) })
coreRoutes.put('/settings', async (c) => {
  const u = requireRole(c, 'superadmin', 'admin')
  const body = parse(z.object({
    requireIdNumber: z.boolean(),
    notifications: z.object({
      birthdayGreeting: z.boolean(),
      paymentReceipt: z.boolean(),
      sendHour: z.number().int().min(5).max(21),
      billingReminder: z.object({
        enabled: z.boolean(), beforeDue: reminder, onDue: z.object({ enabled: z.boolean() }),
        first: reminder, second: reminder, last: reminder,
      }),
    }),
  }), await jsonBody(c))
  const saved = await saveAppSettings(u.ownerId, body)
  await writeAudit(u, c.get('ip'), { action: 'settings.update', entityType: 'settings', summary: 'Ubah pengaturan pengingat otomatis' })
  bumpRev()
  return c.json(saved)
})

/* ================================================================== properties */

/**
 * Invoice numbers start with the property code, so codes never repeat — across
 * all owners, deleted properties included. A suggested code gets a number
 * appended (MLT -> MLT2); a code the user typed must be free.
 */
async function uniqueCode(exec: Executor, code: string, typed: boolean) {
  const taken = new Set((await exec.select({ c: schema.properties.code }).from(schema.properties)).map((r) => r.c.toUpperCase()))
  if (!taken.has(code)) return code
  if (typed) throw conflict(`Kode faktur "${code}" sudah dipakai properti lain. Pilih kode lain.`)
  for (let n = 2; ; n++) {
    const next = `${code.slice(0, 4)}${n}`
    if (!taken.has(next)) return next
  }
}

function codeFromName(name: string) {
  const words = name.replace(/^(kost?|kos|rumah kos|residence|residen)\s+/i, '').split(/\s+/).filter(Boolean)
  const letters = words.length >= 3 ? words.slice(0, 3).map((w) => w[0]).join('') : words.join('').replace(/[aiueo]/gi, '').slice(0, 3)
  return (letters || name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(3, 'X').slice(0, 5)
}

const phoneField = z.string().refine(isValidPhone, 'nomor WhatsApp tidak valid').transform((p) => normalizePhone(p))

const propertyCreate = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneField,
  code: z.string().trim().max(5).regex(/^[A-Za-z0-9]*$/, 'kode hanya huruf/angka').optional(),
  address: address.optional(),
  note: z.string().max(2000).optional(),
})

const template = z.object({ id: z.string().max(40), label: z.string().max(80), body: z.string().max(4000), isDefault: z.boolean() })
const ruleList = z.array(z.string().trim().min(1).max(300)).max(50)
const propertyPatch = z.object({
  version,
  name: z.string().trim().min(2).max(120).optional(),
  code: z.string().trim().min(2).max(5).regex(/^[A-Za-z0-9]+$/).optional(),
  phone: phoneField.optional(),
  note: z.string().max(2000).optional(),
  address: address.optional(),
  paymentMethods: z.object({ cash: z.boolean(), transfer: z.boolean() }).optional(),
  paymentInfo: z.string().max(1000).optional(),
  lateFee: z.object({
    enabled: z.boolean(), type: z.enum(['fixed', 'percent']), value: z.number().min(0).max(100_000_000),
    graceDays: z.number().int().min(0).max(60), frequency: z.enum(['once', 'daily']),
  }).optional(),
  booking: z.object({
    dpHoldDays: z.number().int().min(1).max(60), graceDays: z.number().int().min(0).max(30),
    lapsePolicy: z.enum(['forfeit', 'manual']),
  }).optional(),
  invoicePdf: z.object({
    language: z.enum(['id', 'en']), customLogo: z.boolean(), logoSize: z.number(), font: z.string().max(40),
    fontSize: z.number(), textColor: z.string().max(20), labelColor: z.string().max(20), note: z.string().max(1000),
  }).optional(),
  templates: z.object({ whatsapp: z.array(template).max(30) }).optional(),
  rules: z.object({
    groups: z.object({
      accessHours: ruleList, tenantCriteria: ruleList, generalPolicy: ruleList,
      paymentPolicy: ruleList, guestPolicy: ruleList, requiredDocs: ruleList,
    }),
    custom: ruleList,
  }).optional(),
  agreement: z.object({
    template: z.string().min(20).max(30_000),
    ownerName: z.string().max(120),
    ownerTitle: z.string().max(80),
    ownerSignatureFileId: uuid.nullable(),
    logoFileId: uuid.nullable(),
    contactEmail: z.string().max(120),
    linkExpiryDays: z.number().int().min(1).max(60),
    autoSend: z.boolean(),
  }).optional(),
})

coreRoutes.post('/properties', async (c) => {
  const u = requireRole(c, 'superadmin', 'admin')
  const body = parse(propertyCreate, await jsonBody(c))
  const row = await db.transaction(async (tx) => {
    const [p] = await tx.insert(schema.properties).values({
      name: body.name,
      code: await uniqueCode(tx, (body.code || codeFromName(body.name)).toUpperCase(), Boolean(body.code)),
      ownerId: u.ownerId,
      sandbox: u.sandbox,
      phone: body.phone,
      note: body.note ?? '',
      address: body.address ?? { street: '', postcode: '', province: '', city: '', district: '', subdistrict: '', lat: -6.2088, lng: 106.8456 },
      paymentMethods: { cash: true, transfer: true },
      paymentInfo: '',
      lateFee: defaultLateFee(),
      booking: defaultBookingPolicy(),
      invoicePdf: defaultInvoicePdf(),
      templates: { whatsapp: DEFAULT_WA_TEMPLATES.map((t) => ({ ...t })) },
      rules: DEFAULT_HOUSE_RULES(),
      agreement: { ...defaultAgreement(), ownerName: u.name },
    }).returning()
    // An admin limited to some properties keeps access to the one they just created.
    if (!u.allProperties) {
      await tx.update(schema.users)
        .set({ propertyIds: dsql`array_append(${schema.users.propertyIds}, ${p.id}::uuid)` })
        .where(eq(schema.users.id, u.id))
    }
    await writeAudit(u, c.get('ip'), {
      action: 'property.create', entityType: 'property', entityId: p.id, propertyId: p.id, summary: `Tambah properti ${p.name}`,
    }, tx)
    return p
  })
  bumpRev()
  return c.json(toProperty(row), 201)
})

coreRoutes.patch('/properties/:id', async (c) => {
  const u = requireRole(c, 'superadmin', 'admin')
  const id = parse(uuid, c.req.param('id'))
  assertPropertyAccess(u, id)
  const raw = await jsonBody(c)
  const { version: v, ...patch } = parse(propertyPatch, raw)
  // Money/legal attributes from a non-superadmin become an approval request; the rest applies now.
  const { row, request } = await saveProperty(u, c.get('ip'), id, v, patch, approvalReason(raw))
  if (request) return c.json(pendingResponse(request, toProperty(row)), 202)
  return c.json(toProperty(row))
})

/** Render the agreement + house rules PDF from unsaved edits, with sample tenant data. */
coreRoutes.post('/properties/:id/agreement-preview', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  assertPropertyAccess(u, id)
  const p = await db.query.properties.findFirst({ where: and(eq(schema.properties.id, id), isNull(schema.properties.deletedAt)) })
  if (!p) throw notFound('Properti')
  const body = parse(z.object({
    agreement: propertyPatch.shape.agreement.unwrap(),
    rules: propertyPatch.shape.rules.unwrap(),
    booking: propertyPatch.shape.booking.unwrap().optional(),
    lateFee: propertyPatch.shape.lateFee.unwrap().optional(),
  }), await jsonBody(c))
  const today = appToday()
  const snapshot = buildAgreementSnapshot({
    number: `PSK/${p.code}/CONTOH`,
    date: today,
    property: {
      name: p.name, code: p.code, address: formatAddress(p.address), phone: p.phone, paymentMethods: p.paymentMethods, paymentInfo: p.paymentInfo,
      lateFee: body.lateFee ?? p.lateFee, booking: body.booking ?? p.booking,
    },
    agreement: body.agreement,
    rules: body.rules,
    tenant: { name: 'Nama Penyewa (contoh)', idNumber: '3273xxxxxxxxxxxx', phone: '6281200000000' },
    room: { name: 'Kamar 1' },
    rental: {
      startDate: addDays(today, 3), endDate: null, rentType: 'monthly', price: 1_500_000, billingDay: Number(addDays(today, 3).slice(8)),
      depositAmount: 1_500_000, dpAmount: 500_000, paymentDeadline: addDays(today, 2), services: [],
    },
  })
  const loadOptional = async (fileId: string | null) => (fileId ? await loadFile(fileId).then((f) => f.buffer).catch(() => null) : null)
  const [ownerSignature, logo] = await Promise.all([
    loadOptional(body.agreement.ownerSignatureFileId), loadOptional(body.agreement.logoFileId),
  ])
  const pdf = await renderAgreementPdf(snapshot, { ownerSignature, logo })
  return new Response(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="pratinjau-perjanjian.pdf"', 'Cache-Control': 'no-store' },
  })
})

coreRoutes.delete('/properties/:id', async (c) => {
  const u = requireRole(c, 'superadmin', 'admin')
  const id = parse(uuid, c.req.param('id'))
  assertPropertyAccess(u, id)
  return deleteOrRequest(c, u, 'property', id, optionalVersion(c.req.query('version')))
})

function optionalVersion(v: string | undefined) {
  if (!v) return undefined
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/* ================================================================== rooms & services */

const roomBody = z.object({
  propertyId: uuid,
  name: z.string().trim().min(1).max(80),
  price: priceSet,
  schemes,
  condition: z.enum(['bersih', 'kotor', 'rusak']).default('bersih'),
  note: z.string().max(1000).default(''),
})

coreRoutes.post('/rooms', async (c) => {
  const u = requireUser(c)
  const body = parse(roomBody.extend({
    bulkCount: z.number().int().min(1).max(50).optional(),
  }), await jsonBody(c))
  assertPropertyAccess(u, body.propertyId)
  const property = await db.query.properties.findFirst({ where: and(eq(schema.properties.id, body.propertyId), isNull(schema.properties.deletedAt)) })
  if (!property) throw notFound('Properti')

  const rows = await db.transaction(async (tx) => {
    let names = [body.name]
    if (body.bulkCount && body.bulkCount > 1) {
      // Continue after the highest number already used with this prefix ("Kamar 7" → "Kamar 8", a new prefix → 1).
      const existing = await tx.select({ name: schema.rooms.name }).from(schema.rooms)
        .where(and(eq(schema.rooms.propertyId, body.propertyId), isNull(schema.rooms.deletedAt)))
      const prefix = body.name.trim()
      const used = existing
        .map((r) => r.name.startsWith(`${prefix} `) ? Number(r.name.slice(prefix.length + 1)) : NaN)
        .filter((n) => Number.isInteger(n) && n > 0)
      const start = (used.length ? Math.max(...used) : 0) + 1
      names = Array.from({ length: body.bulkCount }, (_, i) => `${prefix} ${start + i}`)
    }
    const created = await tx.insert(schema.rooms).values(names.map((name) => ({
      propertyId: body.propertyId, name, price: body.price, schemes: body.schemes, condition: body.condition, note: body.note,
    }))).returning()
    await writeAudit(u, c.get('ip'), {
      action: 'room.create', entityType: 'room', entityId: created[0].id, propertyId: body.propertyId,
      summary: created.length > 1 ? `Tambah ${created.length} kamar di ${property.name}` : `Tambah ${created[0].name} di ${property.name}`,
    }, tx)
    return created
  })
  bumpRev()
  return c.json(rows.map(toRoom), 201)
})

coreRoutes.patch('/rooms/:id', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const raw = await jsonBody(c)
  const body = parse(roomBody.omit({ propertyId: true }).partial().extend({ version }), raw)
  const room = await db.query.rooms.findFirst({ where: and(eq(schema.rooms.id, id), isNull(schema.rooms.deletedAt)) })
  if (!room) throw notFound('Kamar')
  assertPropertyAccess(u, room.propertyId)
  const { version: v, ...patch } = body
  // Price and rental schemes need a superadmin's approval; name, condition and notes don't.
  const { row, request } = await saveRoom(u, c.get('ip'), room, v, patch, approvalReason(raw))
  if (request) return c.json(pendingResponse(request, toRoom(row)), 202)
  return c.json(toRoom(row))
})

coreRoutes.delete('/rooms/:id', async (c) => {
  const u = requireUser(c)
  if (!canDelete(u)) throw forbidden('Staf tidak dapat menghapus data.')
  const id = parse(uuid, c.req.param('id'))
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, id) })
  if (!room) throw notFound('Kamar')
  assertPropertyAccess(u, room.propertyId)
  return deleteOrRequest(c, u, 'room', id, optionalVersion(c.req.query('version')))
})

coreRoutes.post('/services', async (c) => {
  const u = requireRole(c, 'superadmin', 'admin')
  const body = parse(z.object({ propertyId: uuid, name: z.string().trim().min(1).max(80), price: priceSet }), await jsonBody(c))
  assertPropertyAccess(u, body.propertyId)
  const [row] = await db.insert(schema.services).values(body).returning()
  await writeAudit(u, c.get('ip'), { action: 'service.create', entityType: 'service', entityId: row.id, propertyId: row.propertyId, summary: `Tambah layanan ${row.name}` })
  bumpRev()
  return c.json(toService(row), 201)
})

coreRoutes.delete('/services/:id', async (c) => {
  const u = requireRole(c, 'superadmin', 'admin')
  const id = parse(uuid, c.req.param('id'))
  const s = await db.query.services.findFirst({ where: eq(schema.services.id, id) })
  if (!s) throw notFound('Layanan')
  assertPropertyAccess(u, s.propertyId)
  return deleteOrRequest(c, u, 'service', id)
})

/* ================================================================== tenants */

const contact = z.object({
  id: z.string().max(60),
  name: z.string().max(120),
  email: z.string().max(160),
  phone: z.string().max(30),
})
const tenantFields = {
  name: z.string().trim().min(2).max(120),
  idNumber: z.string().trim().max(32),
  gender: z.enum(['male', 'female', '']),
  dob: z.union([isoDate, z.literal('')]),
  maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed', '']),
  emergencyContact: z.string().max(120),
  job: z.string().max(120),
  vehiclePlate: z.string().max(30),
  checkInNote: z.string().max(2000),
  checkOutNote: z.string().max(2000),
  avatarColor: z.string().max(30),
  contacts: z.array(contact).min(1).max(5),
  isWaitlist: z.boolean(),
  waitlistPropertyId: uuid.nullable(),
}

function tenantColumns(body: Partial<Record<keyof typeof tenantFields, unknown>>) {
  const out: Record<string, unknown> = { ...body }
  if ('dob' in body) out.dob = body.dob || null
  if (body.contacts) {
    const contacts = (body.contacts as z.infer<typeof contact>[]).map((ct) => ({ ...ct, phone: normalizePhone(ct.phone) }))
    out.contacts = contacts
    out.phone = contacts[0]?.phone ?? ''
  }
  return out
}

coreRoutes.post('/tenants', async (c) => {
  const u = requireUser(c)
  const body = parse(z.object(tenantFields).partial().required({ name: true, contacts: true }), await jsonBody(c))
  if (body.waitlistPropertyId) assertPropertyAccess(u, body.waitlistPropertyId)
  const settings = await getAppSettings(u.ownerId)
  if (settings.requireIdNumber && !body.idNumber) throw badRequest('Nomor identitas (NIK) wajib diisi.')
  if (!isValidPhone(body.contacts[0].phone)) throw badRequest('Nomor WhatsApp penyewa tidak valid.')

  const [row] = await db.insert(schema.tenants)
    .values({ ...tenantColumns(body), ownerId: u.ownerId } as typeof schema.tenants.$inferInsert).returning()
  await writeAudit(u, c.get('ip'), {
    action: 'tenant.create', entityType: 'tenant', entityId: row.id, propertyId: row.waitlistPropertyId,
    summary: `Tambah ${row.isWaitlist ? 'calon penyewa (daftar tunggu)' : 'penyewa'} ${row.name}`,
  })
  bumpRev()
  return c.json(toTenant(row), 201)
})

async function assertTenantAccess(u: SessionUser, tenantId: string) {
  const t = await db.query.tenants.findFirst({ where: and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)) })
  // Another owner's tenant doesn't exist as far as this user is concerned.
  if (!t || t.ownerId !== u.ownerId) throw notFound('Penyewa')
  if (!u.allProperties) {
    const rentals = await db.select({ p: schema.rentals.propertyId }).from(schema.rentals).where(eq(schema.rentals.tenantId, tenantId))
    const props = new Set([...rentals.map((r) => r.p), ...(t.waitlistPropertyId ? [t.waitlistPropertyId] : [])])
    if (props.size && ![...props].some((p) => u.propertyIds.includes(p))) throw forbidden('Anda tidak memiliki akses ke penyewa ini.')
  }
  return t
}

coreRoutes.patch('/tenants/:id', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const body = parse(z.object(tenantFields).partial().extend({ version }), await jsonBody(c))
  const t = await assertTenantAccess(u, id)
  if (body.waitlistPropertyId) assertPropertyAccess(u, body.waitlistPropertyId)
  if (body.contacts && !isValidPhone(body.contacts[0].phone)) throw badRequest('Nomor WhatsApp penyewa tidak valid.')
  const { version: v, ...patch } = body
  const row = await updateVersioned(db, schema.tenants, id, v, tenantColumns(patch))
  await writeAudit(u, c.get('ip'), {
    action: 'tenant.update', entityType: 'tenant', entityId: id, summary: `Ubah data penyewa ${t.name}`,
    meta: { fields: Object.keys(patch) },
  })
  bumpRev()
  return c.json(toTenant(row))
})

coreRoutes.delete('/tenants/:id', async (c) => {
  const u = requireUser(c)
  if (!canDelete(u)) throw forbidden('Staf tidak dapat menghapus data.')
  const id = parse(uuid, c.req.param('id'))
  await assertTenantAccess(u, id)
  return deleteOrRequest(c, u, 'tenant', id, optionalVersion(c.req.query('version')))
})

/* ================================================================== expenses */

const expenseBody = z.object({
  propertyId: uuid,
  roomId: uuid.nullable(),
  category: z.string().min(1).max(80).refine((v) => EXPENSE_CATEGORIES.includes(v) || v.length > 0),
  name: z.string().trim().min(1).max(160),
  date: isoDate,
  items,
  note: z.string().max(2000).default(''),
  attachment: uuid.nullable().default(null),
  recurring: z.boolean().default(false),
  recurrence: z.enum(['weekly', 'monthly', 'yearly']).nullable().optional(),
  recurrenceEndDate: isoDate.nullable().optional(),
})

function normalizeExpenseRecurrence(input: {
  recurring: boolean
  recurrence?: 'weekly' | 'monthly' | 'yearly' | null
  recurrenceEndDate?: string | null
  date: string
}) {
  if (!input.recurring) return { recurrence: null, recurrenceEndDate: null }
  const recurrence = input.recurrence ?? 'monthly'
  const recurrenceEndDate = input.recurrenceEndDate ?? null
  if (recurrenceEndDate && recurrenceEndDate < input.date) {
    throw badRequest('Tanggal akhir pengulangan tidak boleh sebelum tanggal pengeluaran.')
  }
  return { recurrence, recurrenceEndDate }
}

coreRoutes.post('/expenses', async (c) => {
  const u = requireUser(c)
  const body = parse(expenseBody, await jsonBody(c))
  assertPropertyAccess(u, body.propertyId)
  const total = body.items.reduce((a, i) => a + i.amount, 0)
  if (total <= 0) throw badRequest('Total pengeluaran harus lebih dari 0.')
  const recurrence = normalizeExpenseRecurrence(body)
  const [row] = await db.insert(schema.expenses).values({
    propertyId: body.propertyId, roomId: body.roomId, category: body.category, name: body.name, date: body.date,
    items: body.items, total, note: body.note, attachmentFileId: body.attachment, recurring: body.recurring,
    ...recurrence, createdBy: u.id,
  }).returning()
  await writeAudit(u, c.get('ip'), {
    action: 'expense.create', entityType: 'expense', entityId: row.id, propertyId: row.propertyId,
    summary: `Catat pengeluaran ${row.name} (Rp ${total.toLocaleString('id-ID')})`,
  })
  bumpRev()
  return c.json(toExpense(row), 201)
})

coreRoutes.post('/expenses/batch', async (c) => {
  const u = requireUser(c)
  const { expenses: bodies } = parse(z.object({ expenses: z.array(expenseBody).min(1).max(20) }), await jsonBody(c))
  bodies.forEach((body) => assertPropertyAccess(u, body.propertyId))

  const rows = await db.transaction(async (tx) => {
    const created: (typeof schema.expenses.$inferSelect)[] = []
    for (const body of bodies) {
      const total = body.items.reduce((a, i) => a + i.amount, 0)
      if (total <= 0) throw badRequest(`Total ${body.name} harus lebih dari 0.`)
      const recurrence = normalizeExpenseRecurrence(body)
      const [row] = await tx.insert(schema.expenses).values({
        propertyId: body.propertyId, roomId: body.roomId, category: body.category, name: body.name, date: body.date,
        items: body.items, total, note: body.note, attachmentFileId: body.attachment, recurring: body.recurring,
        ...recurrence, createdBy: u.id,
      }).returning()
      await writeAudit(u, c.get('ip'), {
        action: 'expense.create', entityType: 'expense', entityId: row.id, propertyId: row.propertyId,
        summary: `Catat pengeluaran ${row.name} (Rp ${total.toLocaleString('id-ID')}) dari template`,
      }, tx)
      created.push(row)
    }
    return created
  })

  bumpRev()
  return c.json(rows.map(toExpense), 201)
})

coreRoutes.patch('/expenses/:id', async (c) => {
  const u = requireUser(c)
  const id = parse(uuid, c.req.param('id'))
  const body = parse(expenseBody.partial().extend({ version }), await jsonBody(c))
  const e = await db.query.expenses.findFirst({ where: and(eq(schema.expenses.id, id), isNull(schema.expenses.deletedAt)) })
  if (!e) throw notFound('Pengeluaran')
  assertPropertyAccess(u, e.propertyId)
  if (body.propertyId) assertPropertyAccess(u, body.propertyId)
  const { version: v, attachment, ...rest } = body
  const patch: Record<string, unknown> = { ...rest }
  const recurrence = normalizeExpenseRecurrence({
    recurring: body.recurring ?? e.recurring,
    recurrence: body.recurrence !== undefined ? body.recurrence : e.recurrence,
    recurrenceEndDate: body.recurrenceEndDate !== undefined ? body.recurrenceEndDate : e.recurrenceEndDate,
    date: body.date ?? e.date,
  })
  patch.recurrence = recurrence.recurrence
  patch.recurrenceEndDate = recurrence.recurrenceEndDate
  if (attachment !== undefined) patch.attachmentFileId = attachment
  if (rest.items) patch.total = rest.items.reduce((a, i) => a + i.amount, 0)
  const row = await updateVersioned(db, schema.expenses, id, v, patch)
  await writeAudit(u, c.get('ip'), { action: 'expense.update', entityType: 'expense', entityId: id, propertyId: row.propertyId, summary: `Ubah pengeluaran ${row.name}` })
  bumpRev()
  return c.json(toExpense(row))
})

coreRoutes.delete('/expenses/:id', async (c) => {
  const u = requireUser(c)
  if (!canDelete(u)) throw forbidden('Staf tidak dapat menghapus data.')
  const id = parse(uuid, c.req.param('id'))
  const e = await db.query.expenses.findFirst({ where: eq(schema.expenses.id, id) })
  if (!e) throw notFound('Pengeluaran')
  assertPropertyAccess(u, e.propertyId)
  return deleteOrRequest(c, u, 'expense', id, optionalVersion(c.req.query('version')))
})

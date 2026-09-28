import { and, asc, eq, inArray, isNull, sql as dsql } from 'drizzle-orm'
import {
  DEFAULT_HOUSE_RULES, DEFAULT_WA_TEMPLATES, defaultAgreement, defaultBookingPolicy, defaultInvoicePdf,
} from '@shared/constants'
import { addDays, addMonths } from '@shared/dates'
import { type Executor, db, schema } from './db/client'
import { Effects } from './lib/effects'
import { appToday, createRental, recordPayment, runDailyBilling, type Actor } from './services/billing'

/* Demo data built through the real services — so the seed itself exercises
 * proration, recurring invoices, DP bookings and payments exactly as the app does. */

const COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500', 'bg-teal-500']

/** A code nobody uses yet (codes prefix invoice numbers, across every workspace). */
async function freeCode(exec: Executor, base: string) {
  const taken = new Set((await exec.select({ c: schema.properties.code }).from(schema.properties)).map((r) => r.c.toUpperCase()))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`
}

/** A WhatsApp number no live property uses. Sandbox numbers are fake (62899…) and never messaged. */
async function freePhone(exec: Executor, preferred: string, sandbox: boolean) {
  const taken = new Set((await exec.select({ p: schema.properties.phone }).from(schema.properties).where(isNull(schema.properties.deletedAt))).map((r) => r.p))
  if (!sandbox && !taken.has(preferred)) return preferred
  for (;;) {
    const n = `62899${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    if (!taken.has(n)) return n
  }
}

/**
 * Fill one workspace with realistic dummy data. `ownerId` defaults to the first
 * superadmin (development). For a developer it builds their sandbox.
 */
export async function seedDemo(opts: { force?: boolean; ownerId?: string } = {}) {
  // One transaction: a failed seed leaves nothing half-created behind.
  const fx = new Effects()
  const result = await db.transaction(async (tx) => {
  const admin = opts.ownerId
    ? await tx.query.users.findFirst({ where: eq(schema.users.id, opts.ownerId) })
    : await tx.query.users.findFirst({ where: eq(schema.users.role, 'superadmin'), orderBy: asc(schema.users.createdAt) })
  if (!admin) throw new Error('Buat superadmin terlebih dahulu.')
  const sandbox = admin.role === 'developer'
  const existing = await tx.select({ c: dsql<number>`count(*)` }).from(schema.properties)
    .where(and(isNull(schema.properties.deletedAt), eq(schema.properties.ownerId, admin.id)))
  if (Number(existing[0].c) > 0 && !opts.force) {
    return { skipped: 'Sudah ada properti. Gunakan --force untuk tetap menambahkan data demo.' }
  }
  const actor: Actor = { id: admin.id, username: admin.username, name: admin.name }
  const today = appToday()

  const mkProperty = async (name: string, code: string, phone: string, address: typeof schema.properties.$inferInsert.address) => {
    const [p] = await tx.insert(schema.properties).values({
      name: sandbox ? `${name} (Demo)` : name,
      code: await freeCode(tx, sandbox ? `D${code}` : code),
      phone: await freePhone(tx, phone, sandbox),
      ownerId: admin.id, sandbox, note: sandbox ? 'Data dummy untuk pengembangan — bukan data penyewa asli.' : '', address,
      paymentMethods: { cash: true, transfer: true },
      paymentInfo: 'Transfer ke BCA 123-456-7890 a.n. Pengelola Kos, atau tunai ke pengelola.',
      lateFee: { enabled: true, type: 'fixed', value: 25000, graceDays: 3, frequency: 'once' },
      booking: defaultBookingPolicy(),
      invoicePdf: defaultInvoicePdf(),
      templates: { whatsapp: DEFAULT_WA_TEMPLATES.map((t) => ({ ...t })) },
      rules: DEFAULT_HOUSE_RULES(),
      agreement: { ...defaultAgreement(), ownerName: admin.name, ownerTitle: 'Pemilik' },
    }).returning()
    return p
  }

  const melati = await mkProperty('Kost Melati Asri', 'MLT', '6281234567890', {
    street: 'Jl. Kenanga No. 12, RT 03/RW 05', postcode: '40135', province: 'Jawa Barat', city: 'Kota Bandung',
    district: 'Coblong', subdistrict: 'Dago', lat: -6.8915, lng: 107.6107,
  })
  const cempaka = await mkProperty('Kost Cempaka Residence', 'CMP', '6281398765432', {
    street: 'Jl. Margonda Raya No. 88', postcode: '16424', province: 'Jawa Barat', city: 'Kota Depok',
    district: 'Beji', subdistrict: 'Kemiri Muka', lat: -6.3688, lng: 106.8316,
  })

  const price = (m: number) => ({ daily: Math.round(m / 20), weekly: Math.round(m / 3.5), monthly: m, yearly: m * 11 })
  const schemes = { daily: false, weekly: false, monthly: true, yearly: true }
  const rooms = await tx.insert(schema.rooms).values([
    ...[1, 2, 3, 4, 5, 6].map((n) => ({
      propertyId: melati.id, name: `Kamar ${n}`, price: price(n <= 2 ? 1_500_000 : n <= 4 ? 1_750_000 : 2_000_000), schemes,
      condition: (n === 3 ? 'kotor' : n === 5 ? 'rusak' : 'bersih') as 'bersih' | 'kotor' | 'rusak', note: '',
    })),
    ...[1, 2, 3, 4].map((n) => ({
      propertyId: cempaka.id, name: `Kamar ${n}`, price: price(n <= 2 ? 1_200_000 : 1_350_000), schemes,
      condition: 'bersih' as const, note: '',
    })),
  ]).returning()
  const room = (p: string, n: number) => rooms.find((r) => r.propertyId === p && r.name === `Kamar ${n}`)!

  await tx.insert(schema.services).values([
    { propertyId: melati.id, name: 'Laundry', price: { daily: 0, weekly: 50_000, monthly: 150_000, yearly: 1_500_000 } },
    { propertyId: cempaka.id, name: 'Parkir mobil', price: { daily: 0, weekly: 0, monthly: 200_000, yearly: 2_000_000 } },
  ])

  const people = [
    { name: 'Budi Santoso', phone: '6281230000001', idNumber: '3273000101900001', job: 'Karyawan Swasta', gender: 'male', dob: '1998-06-15', plate: 'D 1234 XYZ' },
    { name: 'Siti Nurhaliza', phone: '6281230000002', idNumber: '3273000202990002', job: 'Mahasiswa', gender: 'female', dob: '2002-' + today.slice(5), plate: '' },
    { name: 'Andi Wijaya', phone: '6281230000003', idNumber: '3273000303950003', job: 'Programmer', gender: 'male', dob: '1995-03-03', plate: 'B 4455 KLM' },
    { name: 'Rina Kartika', phone: '6281230000004', idNumber: '3276000404970004', job: 'Perawat', gender: 'female', dob: '1997-11-20', plate: '' },
    { name: 'Dimas Prayoga', phone: '6281230000005', idNumber: '3276000505000005', job: 'Mahasiswa', gender: 'male', dob: '2000-08-08', plate: 'B 7788 QR' },
    { name: 'Lestari Putri', phone: '6281230000006', idNumber: '3273000606010006', job: 'Desainer', gender: 'female', dob: '2001-01-12', plate: '' },
    { name: 'Fajar Nugroho', phone: '6281230000007', idNumber: '', job: 'Mahasiswa', gender: 'male', dob: '', plate: '' },
    { name: 'Maya Anggraini', phone: '6281230000008', idNumber: '', job: 'Karyawan', gender: 'female', dob: '', plate: '' },
  ]
  const tenants = await tx.insert(schema.tenants).values(people.map((p, i) => ({
    name: p.name, idNumber: p.idNumber, gender: p.gender, dob: p.dob || null, job: p.job, vehiclePlate: p.plate,
    maritalStatus: 'single', avatarColor: COLORS[i % COLORS.length], phone: p.phone,
    contacts: [{ id: `ct${i}`, name: p.name, email: '', phone: p.phone }],
    isWaitlist: i >= 6, waitlistPropertyId: i >= 6 ? melati.id : null, ownerId: admin.id,
    checkInNote: i < 5 ? 'Kunci 2 buah, kondisi kamar baik' : '',
  }))).returning()
  const t = (i: number) => tenants[i]

  const lease = async (tenantIdx: number, r: typeof rooms[number], monthsAgo: number, mode: 'full' | 'dp' | 'later', extra: Partial<Parameters<typeof createRental>[1]> = {}) => {
    const start = monthsAgo > 0 ? addDays(addMonths(today, -monthsAgo), -3) : addDays(today, 2)
    return createRental(tx, {
      tenantId: t(tenantIdx).id, roomId: r.id, startDate: start, endDate: null, rentType: 'monthly',
      // Billed on the move-in date each month — the usual arrangement for a kos.
      price: r.price.monthly, billingDay: Number(start.slice(8, 10)), serviceIds: [], depositAmount: r.price.monthly, depositPaid: true,
      paymentMode: mode, dpAmount: 0, paymentDeadline: null, method: 'transfer', paymentDate: start > today ? today : start,
      ...extra,
    }, actor, null, fx)
  }

  // Long-standing tenants with a clean record, one with arrears, and fresh bookings.
  await lease(0, room(melati.id, 1), 6, 'full')
  await lease(1, room(melati.id, 2), 4, 'full')
  await lease(2, room(melati.id, 4), 3, 'full')
  await lease(3, room(cempaka.id, 1), 5, 'full')
  // DP booking: move-in in 2 days, balance due in 2 days.
  await lease(4, room(cempaka.id, 3), 0, 'dp', {
    dpAmount: 500_000, paymentDeadline: addDays(today, 2), depositPaid: false, method: 'cash',
  })
  // DP booking whose deadline is today — shows up in "Hari ini".
  await lease(5, room(melati.id, 6), 0, 'dp', {
    dpAmount: 300_000, paymentDeadline: today, depositPaid: false,
  })

  // Issue every recurring invoice up to today (+ lead window).
  await runDailyBilling(tx, fx, today)

  // Pay history: everything paid on time except Andi's latest invoice (arrears) and current-month ones for Rina.
  // Only this seed's properties — never touch another workspace's books.
  const seeded = [melati.id, cempaka.id]
  const invoices = await tx.select().from(schema.invoices)
    .where(and(isNull(schema.invoices.deletedAt), inArray(schema.invoices.propertyId, seeded))).orderBy(asc(schema.invoices.dueDate))
  const rentals = await tx.select().from(schema.rentals).where(inArray(schema.rentals.propertyId, seeded))
  // Most pay on the due date; every third invoice a couple of days late, for the settlement report.
  const payDate = (inv: typeof invoices[number]) => {
    const d = addDays(inv.dueDate, inv.number.endsWith('3') ? 2 : 0)
    return d > today ? today : d
  }
  for (const inv of invoices) {
    const rental = rentals.find((r) => r.id === inv.rentalId)!
    if (rental.status !== 'active' || inv.paidAmount >= inv.total || inv.dueDate > today) continue
    const isAndiLatest = rental.tenantId === t(2).id && inv.dueDate > addDays(today, -35)
    const isRinaCurrent = rental.tenantId === t(3).id && inv.dueDate >= addDays(today, -3)
    if (isAndiLatest || isRinaCurrent) continue
    await recordPayment(tx, {
      invoiceId: inv.id, tenantId: inv.tenantId, rentalId: null, date: payDate(inv),
      method: 'transfer', amount: inv.subtotal - inv.paidAmount, kind: 'rent', note: '', attachmentFileId: null,
    }, actor, null, fx, { sendReceipt: false })
  }

  const expenseRows = [
    { p: melati.id, cat: 'Listrik & Air', name: 'Token listrik area bersama', amount: 350_000, m: 0 },
    { p: melati.id, cat: 'Perawatan dan Perbaikan', name: 'Perbaikan keran Kamar 5', amount: 175_000, m: 0 },
    { p: melati.id, cat: 'Internet', name: 'Langganan WiFi', amount: 450_000, m: 1 },
    { p: melati.id, cat: 'Kebersihan', name: 'Upah kebersihan', amount: 600_000, m: 1 },
    { p: cempaka.id, cat: 'Keamanan', name: 'Iuran keamanan RT', amount: 100_000, m: 0 },
    { p: cempaka.id, cat: 'Perlengkapan', name: 'Lampu LED & sapu', amount: 225_000, m: 2 },
    { p: cempaka.id, cat: 'Listrik & Air', name: 'Tagihan PDAM', amount: 280_000, m: 1 },
  ]
  await tx.insert(schema.expenses).values(expenseRows.map((e) => ({
    propertyId: e.p, roomId: null, category: e.cat, name: e.name, date: addDays(addMonths(today, -e.m), -2),
    items: [{ name: e.name, amount: e.amount }], total: e.amount, note: '', createdBy: admin.id,
    // A recurring cost must say how often it repeats (database constraint).
    recurring: e.cat === 'Internet', recurrence: e.cat === 'Internet' ? ('monthly' as const) : null,
  })))

  // Demo tenants have made-up numbers: keep the demo from queueing WhatsApp messages to them.
  await tx.delete(schema.waMessages).where(and(
    eq(schema.waMessages.direction, 'out'), eq(schema.waMessages.status, 'queued'), inArray(schema.waMessages.propertyId, seeded),
  ))
  return { properties: 2, rooms: rooms.length, tenants: tenants.length, invoices: invoices.length }
  })
  await fx.run()
  return result
}

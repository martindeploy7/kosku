/* End-to-end API check against a running server (development: WA_DRIVER=mock).
 *
 *   SMOKE_USER=admin SMOKE_PASSWORD=<temp-or-current> node scripts/smoke.mjs [http://localhost:8787]
 *
 * Walks the flows that matter: forced password change, CSRF guard, DP booking
 * → room held → contract (agreement + house rules PDF) → tenant signs via the
 * public link → balance paid → lease active, soft delete + restore, WhatsApp
 * number matching, notifications. Exits non-zero on the first failure. */

import sharp from 'sharp'

const BASE = process.argv[2] ?? 'http://localhost:8787'
const USER = process.env.SMOKE_USER ?? 'admin'
const PASS = process.env.SMOKE_PASSWORD
const NEW_PASS = process.env.SMOKE_NEW_PASSWORD ?? 'kosku-uji-coba-2026'
if (!PASS) throw new Error('Set SMOKE_PASSWORD')

/** Each signed-in user keeps their own cookie. */
const main = { cookie: '' }
let passed = 0
const results = []

async function api(method, path, body, opts = {}) {
  const jar = opts.jar ?? main
  const headers = { 'x-kosku': opts.noCsrf ? undefined : '1', cookie: jar.cookie }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method, headers: Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) jar.cookie = set.split(';')[0]
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, headers: res.headers }
}

function check(name, cond, detail) {
  if (!cond) {
    console.error(`✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 600) : '')
    process.exit(1)
  }
  passed++
  results.push(name)
  console.log(`✓ ${name}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/* ---------------------------------------------------------------- auth */
let r = await api('POST', '/api/auth/login', { username: USER, password: 'salah-sekali-password' })
check('password salah ditolak dengan pesan generik', r.status === 401 && /salah/i.test(r.json.error.message), r.json)

r = await api('POST', '/api/auth/login', { username: USER, password: PASS })
if (r.status === 401) {
  r = await api('POST', '/api/auth/login', { username: USER, password: NEW_PASS })
}
check('login berhasil', r.status === 200, r.json)

if (r.json.user.mustChangePassword) {
  const b = await api('GET', '/api/bootstrap')
  check('akses data diblokir sebelum ganti password', b.status === 403 && b.json.error.code === 'must_change_password', b.json)
  const weak = await api('POST', '/api/auth/change-password', { currentPassword: PASS, newPassword: 'pendek' })
  check('password lemah ditolak', weak.status === 400, weak.json)
  const ok = await api('POST', '/api/auth/change-password', { currentPassword: PASS, newPassword: NEW_PASS })
  check('ganti password wajib berhasil', ok.status === 200, ok.json)
}

r = await api('POST', '/api/tenants', { name: 'Tanpa CSRF', contacts: [{ id: 'x', name: 'x', email: '', phone: '081200000000' }] }, { noCsrf: true })
check('permintaan tanpa header CSRF ditolak', r.status === 403 && r.json.error.code === 'csrf', r.json)

/* ---------------------------------------------------------------- bootstrap */
r = await api('GET', '/api/bootstrap')
check('bootstrap memuat data', r.status === 200 && r.json.properties.length >= 1 && r.json.rooms.length >= 1, r.json?.error)
const boot = r.json
const busyRoomIds = new Set(boot.rentals.filter((x) => ['booked', 'active'].includes(x.status)).map((x) => x.roomId))
let freeRoom = boot.rooms.find((x) => !busyRoomIds.has(x.id))
if (!freeRoom) {
  // Repeated runs fill every room: add one so the test works on any database.
  const created = await api('POST', '/api/rooms', {
    propertyId: boot.properties[0].id, name: `Kamar Uji ${Date.now() % 100000}`,
    price: { daily: 0, weekly: 0, monthly: 1500000, yearly: 0 }, schemes: { daily: false, weekly: false, monthly: true, yearly: false },
  })
  freeRoom = created.json?.[0]
}
check('ada kamar kosong untuk uji', Boolean(freeRoom))
const property = boot.properties.find((p) => p.id === freeRoom.propertyId)

/* ---------------------------------------------------------------- WhatsApp: connect + number mismatch */
r = await api('GET', `/api/whatsapp/${property.id}/status`)
if (r.json.status !== 'disconnected') {
  // Still linked from a previous run (sessions survive restarts): start clean.
  r = await api('POST', `/api/whatsapp/${property.id}/disconnect`)
  check('putuskan WA yang masih tersambung dari sesi lalu', r.json.status === 'disconnected', r.json)
}
r = await api('POST', `/api/whatsapp/${property.id}/connect`, { mockPhone: '6289999999999' })
check('mulai hubungkan WA menampilkan QR', r.status === 200 && ['qr', 'connecting'].includes(r.json.status) && r.json.qr?.startsWith('data:image/png'), r.json)
await sleep(3500)
r = await api('GET', `/api/whatsapp/${property.id}/status`)
check('nomor pemindai berbeda → tautan dibatalkan (mismatch)', r.json.status === 'mismatch' && /berbeda/.test(r.json.lastError), r.json)

r = await api('POST', `/api/whatsapp/${property.id}/connect`, {})
await sleep(3500)
r = await api('GET', `/api/whatsapp/${property.id}/status`)
check('nomor pemindai sama dengan nomor properti → terhubung', r.json.status === 'connected' && r.json.phone === property.phone, r.json)

r = await api('PATCH', `/api/properties/${property.id}`, { version: property.version, phone: '081377778888' })
check('ganti nomor properti ditolak selama WA terhubung', r.status === 409 && r.json.error.code === 'wa_connected', r.json)

const other = boot.properties.find((p) => p.id !== property.id)
if (other) {
  r = await api('PATCH', `/api/properties/${other.id}`, { version: other.version, phone: property.phone })
  check('satu nomor tidak bisa dipakai dua properti', r.status === 409, r.json)
}

/* ---------------------------------------------------------------- DP booking → contract → sign → pay */
r = await api('POST', '/api/tenants', {
  name: 'Uji Penyewa DP', idNumber: '3273999900000001',
  contacts: [{ id: 'c1', name: 'Uji Penyewa DP', email: '', phone: '0812 5555 0101' }],
})
check('tambah penyewa (nomor dinormalisasi)', r.status === 201 && r.json.phone === '6281255550101', r.json)
const tenant = r.json

const start = addDays(today(), 3)
r = await api('POST', '/api/rentals', {
  tenantId: tenant.id, roomId: freeRoom.id, startDate: start, endDate: null, rentType: 'monthly',
  price: freeRoom.price.monthly, billingDay: Number(start.slice(8)), depositAmount: 500000, depositPaid: true,
  paymentMode: 'dp', dpAmount: 300000, paymentDeadline: addDays(today(), 2), method: 'transfer', sendContract: true,
})
check('pemesanan DP dibuat (status booked)', r.status === 201 && r.json.rental.status === 'booked', r.json)
check('perjanjian + tata tertib dibuat dan diantrekan ke WA', Boolean(r.json.contract?.link) && r.json.contract.queued === true, r.json)
const rental = r.json.rental
const link = r.json.contract.link
const token = link.split('/sign/')[1]

r = await api('POST', '/api/rentals', {
  tenantId: boot.tenants[0].id, roomId: freeRoom.id, startDate: start, endDate: null, rentType: 'monthly',
  price: 1000000, billingDay: 1, paymentMode: 'later', sendContract: false,
})
check('kamar yang sedang ditahan DP tidak bisa dipesan lagi', r.status === 409, r.json)

r = await api('GET', '/api/bootstrap')
const firstInv = r.json.invoices.find((i) => i.rentalId === rental.id && i.isFirst)
check('tagihan pertama jatuh tempo pada batas pelunasan DP', firstInv?.dueDate === addDays(today(), 2) && firstInv.paidAmount === 300000, firstInv)

await sleep(1500)
r = await api('GET', `/api/public/contracts/${token}`)
check('penyewa bisa membuka perjanjian tanpa login', r.status === 200 && r.json.status === 'pending' && r.json.snapshot.rules.length > 0, r.json)
check('isi perjanjian terisi lengkap (tanpa {{placeholder}})', !JSON.stringify(r.json.snapshot.blocks).includes('{{'))

r = await fetch(`${BASE}/api/public/contracts/${token}/pdf`)
const pdf = Buffer.from(await r.arrayBuffer())
check('PDF perjanjian dapat diunduh', r.status === 200 && pdf.subarray(0, 4).toString() === '%PDF', { status: r.status })

r = await api('GET', `/api/public/contracts/salah-token-xxxxxxxxxxxxxxxxxxxx`)
check('token palsu ditolak', r.status === 404, r.json)

const sigPng = await sharp({ create: { width: 400, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: Buffer.from('<svg width="400" height="150"><path d="M20 100 C 80 20, 160 140, 380 40" stroke="black" stroke-width="4" fill="none"/></svg>'), top: 0, left: 0 }])
  .png().toBuffer()
r = await api('POST', `/api/public/contracts/${token}/sign`, { name: 'Uji Penyewa DP', agree: true, signature: 'data:image/png;base64,' + sigPng.toString('base64') })
check('penyewa menandatangani perjanjian', r.status === 200 && r.json.status === 'signed', r.json)
r = await api('POST', `/api/public/contracts/${token}/sign`, { name: 'Uji Penyewa DP', agree: true, signature: 'data:image/png;base64,' + sigPng.toString('base64') })
check('tanda tangan ganda ditolak', r.status === 409, r.json)
r = await fetch(`${BASE}/api/public/contracts/${token}/pdf`)
const signedPdf = Buffer.from(await r.arrayBuffer())
check('PDF bertanda tangan lebih lengkap (ada sertifikat)', signedPdf.length > pdf.length, { before: pdf.length, after: signedPdf.length })

r = await api('POST', '/api/payments', {
  invoiceId: firstInv.id, tenantId: tenant.id, date: today(), method: 'transfer', amount: firstInv.total - 300000 + 1000, kind: 'rent',
})
check('kelebihan bayar ditolak', r.status === 400, r.json)

/* ---------------------------------------------------------------- tenant sends a transfer proof on WhatsApp */
const proofJpg = await sharp({ create: { width: 480, height: 640, channels: 3, background: '#dbeafe' } }).jpeg().toBuffer()
r = await api('POST', `/api/whatsapp/${property.id}/mock-incoming`, {
  phone: tenant.phone, body: 'Sudah transfer pelunasan ya kak',
  media: { type: 'image', fileName: 'bukti.jpg', base64: proofJpg.toString('base64') },
})
check('foto bukti transfer dari penyewa tersimpan di aplikasi', r.status === 200 && r.json?.type === 'image' && Boolean(r.json.fileId), r.json)
const proofFileId = r.json.fileId
r = await api('GET', '/api/notifications')
check('admin diberi tahu "kemungkinan bukti bayar"', r.json.some((n) => n.type === 'wa_payment_proof'), r.json.map?.((n) => n.type))
r = await api('POST', `/api/whatsapp/${property.id}/mock-incoming`, {
  phone: '0813 0000 1111', body: '', media: { type: 'image', fileName: 'x.jpg', base64: proofJpg.toString('base64') },
})
check('lampiran dari nomor bukan penyewa tidak diunduh', r.status === 200 && !r.json.fileId && /bukan penyewa/.test(r.json.body), r.json)

r = await api('POST', '/api/payments', {
  invoiceId: firstInv.id, tenantId: tenant.id, date: today(), method: 'transfer', amount: firstInv.total - 300000, kind: 'rent',
  attachment: crypto.randomUUID(),
})
check('lampiran bukti yang bukan milik penyewa ditolak', r.status === 400, r.json)
r = await api('POST', '/api/payments', {
  invoiceId: firstInv.id, tenantId: tenant.id, date: today(), method: 'transfer', amount: firstInv.total - 300000, kind: 'rent',
  attachment: proofFileId,
})
check('pelunasan dicatat dengan bukti dari WhatsApp', r.status === 201 && r.json.attachment === proofFileId, r.json)

r = await api('POST', `/api/invoices/${firstInv.id}/send`)
check('kirim faktur ke WA diantrekan', r.status === 200 && r.json.queued === true, r.json)

r = await api('GET', '/api/bootstrap')
const activated = r.json.rentals.find((x) => x.id === rental.id)
check('lunas → pemesanan otomatis menjadi sewa aktif', activated?.status === 'active', activated)
const dpPay = r.json.payments.find((p) => p.rentalId === rental.id && p.kind === 'dp')
check('DP dialihkan dari uang muka ke pendapatan', dpPay?.category === 'Pendapatan Bisnis', dpPay)
check('status tanda tangan tercatat di perjanjian', r.json.contracts.some((k) => k.rentalId === rental.id && k.status === 'signed'))

/* ---------------------------------------------------------------- soft delete + restore */
r = await api('DELETE', `/api/properties/${property.id}`)
check('properti dengan penyewa aktif tidak bisa dihapus', r.status === 409, r.json)

const expense = boot.expenses[0]
r = await api('DELETE', `/api/expenses/${expense.id}`)
check('hapus pengeluaran (soft delete)', r.status === 200 && r.json.batch, r.json)
const batch = r.json.batch
r = await api('GET', '/api/bootstrap')
check('pengeluaran hilang dari data aktif', !r.json.expenses.some((e) => e.id === expense.id))
r = await api('GET', '/api/trash')
check('pengeluaran muncul di tempat sampah', r.json.some((t) => t.id === batch), r.json)
r = await api('POST', `/api/trash/${batch}/restore`)
check('superadmin memulihkan pengeluaran', r.status === 200, r.json)
r = await api('GET', '/api/bootstrap')
check('pengeluaran kembali ke data aktif', r.json.expenses.some((e) => e.id === expense.id))

/* ---------------------------------------------------------------- optimistic locking */
const room = r.json.rooms.find((x) => x.id === freeRoom.id)
const first = await api('PATCH', `/api/rooms/${room.id}`, { version: room.version, condition: 'kotor' })
const second = await api('PATCH', `/api/rooms/${room.id}`, { version: room.version, condition: 'rusak' })
check('perubahan bersamaan terdeteksi (tidak saling menimpa)', first.status === 200 && second.status === 409 && second.json.error.code === 'stale_version', second.json)

/* ---------------------------------------------------------------- notifications & WA outbox */
r = await api('GET', '/api/notifications')
check('notifikasi admin tersedia', Array.isArray(r.json) && r.json.some((n) => n.type === 'contract_signed'), r.json.map?.((n) => n.type))
r = await api('GET', '/api/sync')
check('sync mengembalikan revisi & jumlah belum dibaca', typeof r.json.rev === 'number' && typeof r.json.unread === 'number', r.json)
await sleep(2500)
r = await api('GET', `/api/whatsapp/${property.id}/messages?phone=${tenant.phone}`)
check('pesan WA ke penyewa terkirim (booking, perjanjian, kwitansi)', r.json.filter((m) => m.status === 'sent').length >= 2, r.json.map?.((m) => [m.type, m.status, m.error]))
const invoiceMsg = r.json.find((m) => m.direction === 'out' && m.type === 'document' && /^Faktur/.test(m.fileName ?? ''))
check('faktur dikirim sebagai lampiran PDF', Boolean(invoiceMsg?.fileId), r.json.map?.((m) => [m.type, m.fileName]))
const invRes = await fetch(`${BASE}/api/files/${invoiceMsg.fileId}`, { headers: { cookie: main.cookie } })
const invPdf = Buffer.from(await invRes.arrayBuffer())
check('PDF faktur valid', invRes.status === 200 && invPdf.subarray(0, 4).toString() === '%PDF', { status: invRes.status })
const signedMsg = r.json.find((m) => m.direction === 'out' && m.type === 'document' && /ditandatangani/.test(m.fileName ?? ''))
check('salinan perjanjian bertanda tangan dikirim balik ke penyewa', Boolean(signedMsg?.fileId), r.json.map?.((m) => [m.type, m.fileName]))

/* ---------------------------------------------------------------- users */
/** Create a user, sign them in with their own cookie and replace the temporary password. */
async function newUser(role, label) {
  const username = `${role}${Date.now() % 1000000}`
  const res = await api('POST', '/api/users', { username, name: label, role, allProperties: false, propertyIds: [property.id] })
  const jar = { cookie: '' }
  await api('POST', '/api/auth/login', { username, password: res.json.temporaryPassword }, { jar })
  await api('POST', '/api/auth/change-password', { currentPassword: res.json.temporaryPassword, newPassword: NEW_PASS }, { jar })
  return { res, jar }
}

const staff = await newUser('staff', 'Staf Uji')
check('superadmin menambah staf dengan password sementara', staff.res.status === 201 && /^[\w-]{14}$/.test(staff.res.json.temporaryPassword), staff.res.json)
const admin = await newUser('admin', 'Admin Uji')
check('superadmin menambah admin (akses satu properti)', admin.res.status === 201, admin.res.json)
const A = { jar: admin.jar }
const S = { jar: staff.jar }

/* ---------------------------------------------------------------- four-eyes: admin requests, superadmin decides */
r = await api('GET', '/api/bootstrap', undefined, A)
check('admin hanya melihat properti yang ditugaskan', r.status === 200 && r.json.properties.every((p) => p.id === property.id), { status: r.status, props: r.json.properties?.map((p) => p.name), err: r.json.error })
const aBoot = r.json

// Delete → request, nothing deleted yet
// Its own expense to delete, so the test doesn't depend on leftovers from earlier runs.
const expense2 = (await api('POST', '/api/expenses', {
  propertyId: property.id, roomId: null, category: 'Kebersihan', name: 'Uji hapus ' + Date.now(), date: today(),
  items: [{ name: 'Sapu', amount: 25000 }],
})).json
r = await api('DELETE', `/api/expenses/${expense2.id}?reason=${encodeURIComponent('data ganda')}`, undefined, A)
check('admin menghapus → jadi permintaan (202), belum terhapus', r.status === 202 && r.json.pendingApproval && r.json.request.reason === 'data ganda', r.json)
const delReq = r.json.request
r = await api('DELETE', `/api/expenses/${expense2.id}`, undefined, A)
check('permintaan yang sama tidak dibuat dua kali', r.status === 202 && r.json.request.id === delReq.id, r.json)
r = await api('GET', '/api/bootstrap', undefined, A)
check('data masih ada selama menunggu', r.json.expenses.some((e) => e.id === expense2.id) && r.json.approvals.some((x) => x.id === delReq.id))
r = await api('DELETE', `/api/expenses/${expense2.id}`, undefined, S)
check('staf tetap tidak bisa menghapus', r.status === 403, r.json)
r = await api('GET', '/api/notifications')
check('superadmin mendapat notifikasi "perlu persetujuan"', r.json.some((n) => n.type === 'approval_requested' && n.link.includes(delReq.id)), r.json.map?.((n) => n.type))
r = await api('POST', `/api/approvals/${delReq.id}/approve`, {}, A)
check('admin tidak bisa menyetujui permintaan', r.status === 403, r.json)
r = await api('POST', `/api/approvals/${delReq.id}/approve`, { note: 'ok' })
check('superadmin menyetujui → data terhapus (soft delete)', r.status === 200 && r.json.status === 'approved', r.json)
r = await api('GET', '/api/trash')
check('tempat sampah mencatat peminta & penyetuju', r.json.some((t) => t.entityId === expense2.id && /disetujui/.test(t.deletedByName)), r.json.slice?.(0, 2))
r = await api('POST', `/api/approvals/${delReq.id}/approve`, {})
check('permintaan yang sudah diputuskan tidak bisa diproses lagi', r.status === 409, r.json)
r = await api('GET', '/api/notifications', undefined, A)
check('admin diberi tahu permintaannya disetujui', r.json.some((n) => n.type === 'approval_approved'), r.json.map?.((n) => n.type))
r = await api('GET', '/api/notifications')
check('notifikasi pribadi admin tidak muncul di superadmin', !r.json.some((n) => n.type === 'approval_approved'), r.json.map?.((n) => n.type))

// Room: name applies now, price waits
const room2 = aBoot.rooms.find((x) => x.propertyId === property.id)
r = await api('PATCH', `/api/rooms/${room2.id}`, { version: room2.version, name: `${room2.name} (A)`, price: { ...room2.price, monthly: room2.price.monthly + 250000 } }, A)
check('ubah harga kamar oleh admin → menunggu; nama langsung berubah', r.status === 202 && r.json.applied.name.endsWith('(A)') && r.json.applied.price.monthly === room2.price.monthly, r.json)
const priceReq = r.json.request
check('permintaan harga memuat rincian sebelum → sesudah', priceReq.changes.some((c) => c.field === 'price.monthly' && c.before !== c.after), priceReq.changes)
r = await api('PATCH', `/api/rooms/${room2.id}`, { version: room2.version + 1, price: { ...room2.price, monthly: 1 } }, S)
check('staf mengubah harga → permintaan lain ditolak selama masih ada yang menunggu', r.status === 409 && r.json.error.code === 'approval_pending', r.json)
r = await api('POST', `/api/approvals/${priceReq.id}/reject`, { note: '' })
check('menolak wajib dengan alasan', r.status === 400, r.json)
r = await api('POST', `/api/approvals/${priceReq.id}/reject`, { note: 'Harga tahun ini belum disepakati' })
check('superadmin menolak dengan alasan', r.status === 200 && r.json.status === 'rejected', r.json)
r = await api('GET', '/api/bootstrap')
check('harga kamar tetap setelah ditolak', r.json.rooms.find((x) => x.id === room2.id).price.monthly === room2.price.monthly)
r = await api('GET', '/api/notifications', undefined, A)
check('admin diberi tahu penolakan beserta alasannya', r.json.some((n) => n.type === 'approval_rejected' && /belum disepakati/.test(n.body)), r.json.map?.((n) => n.type))

// Property: bank details wait, the internal note applies now
r = await api('GET', '/api/bootstrap', undefined, A)
let prop2 = r.json.properties.find((p) => p.id === property.id)
r = await api('PATCH', `/api/properties/${property.id}`, {
  version: prop2.version, note: `Catatan uji ${Date.now()}`, paymentInfo: `Transfer ke BCA 999 a.n. Orang Lain (${Date.now()})`, approvalReason: 'rekening baru',
}, A)
check('ubah rekening oleh admin → menunggu; catatan langsung tersimpan', r.status === 202 && r.json.applied.note.startsWith('Catatan uji') && r.json.applied.paymentInfo === prop2.paymentInfo, r.json)
const bankReq = r.json.request
r = await api('PATCH', `/api/properties/${property.id}`, { version: prop2.version, note: 'draf lama' }, A)
check('simpan dari draf usang ditolak (tidak menimpa perubahan lain)', r.status === 409 && r.json.error.code === 'stale_version', r.json)
// Meanwhile the superadmin edits the same field directly → the request is now stale.
r = await api('GET', '/api/bootstrap')
prop2 = r.json.properties.find((p) => p.id === property.id)
r = await api('PATCH', `/api/properties/${property.id}`, { version: prop2.version, paymentInfo: `Transfer ke BCA 123 a.n. Pemilik (${Date.now()})` })
check('superadmin mengubah langsung (tanpa persetujuan)', r.status === 200 && r.json.paymentInfo.startsWith('Transfer ke BCA 123 a.n. Pemilik'), r.json)
r = await api('POST', `/api/approvals/${bankReq.id}/approve`, {})
check('permintaan yang sudah basi tidak diterapkan', r.status === 409 && r.json.error.code === 'approval_stale', r.json)
r = await api('POST', `/api/approvals/${bankReq.id}/reject`, { note: 'Sudah diubah langsung' })
check('permintaan basi bisa ditolak', r.status === 200, r.json)

// Admin cancels their own request; invoice void goes through approval
r = await api('GET', '/api/bootstrap', undefined, A)
const room3 = r.json.rooms.find((x) => x.id === room2.id)
r = await api('PATCH', `/api/rooms/${room3.id}`, { version: room3.version, price: { ...room3.price, monthly: room3.price.monthly + 100000 } }, A)
const cancelReq = r.json.request
r = await api('POST', `/api/approvals/${cancelReq.id}/cancel`, {}, S)
check('hanya pembuat yang bisa membatalkan permintaannya', r.status === 403, r.json)
r = await api('POST', `/api/approvals/${cancelReq.id}/cancel`, {}, A)
check('admin membatalkan permintaannya sendiri', r.status === 200 && r.json.status === 'canceled', r.json)

r = await api('GET', '/api/bootstrap', undefined, A)
const openInv = r.json.invoices.find((i) => i.propertyId === property.id && i.paidAmount === 0 && i.status !== 'batal')
if (openInv) {
  r = await api('POST', `/api/invoices/${openInv.id}/void`, { approvalReason: 'salah terbit' }, A)
  check('batalkan faktur oleh admin → menunggu', r.status === 202 && r.json.request.kind === 'invoice.void', r.json)
  r = await api('POST', `/api/approvals/${r.json.request.id}/approve`, {})
  check('disetujui → faktur batal', r.status === 200, r.json)
  r = await api('GET', '/api/bootstrap')
  check('status faktur menjadi batal', r.json.invoices.find((i) => i.id === openInv.id)?.status === 'batal')
}
r = await api('GET', '/api/approvals?status=history', undefined, A)
check('riwayat persetujuan terlihat oleh admin', Array.isArray(r.json) && r.json.length >= 3, r.json.length)

/* ---------------------------------------------------------------- workspaces: one owner never sees another's data */
const stamp = Date.now() % 1000000
r = await api('POST', '/api/users', { username: `owner${stamp}`, name: 'Pemilik Kedua', role: 'superadmin' })
check('superadmin membuat superadmin lain (pemilik terpisah)', r.status === 201 && r.json.separateWorkspace === true, r.json)
const B = { jar: { cookie: '' } }
await api('POST', '/api/auth/login', { username: `owner${stamp}`, password: r.json.temporaryPassword }, B)
await api('POST', '/api/auth/change-password', { currentPassword: r.json.temporaryPassword, newPassword: NEW_PASS }, B)
r = await api('GET', '/api/bootstrap', undefined, B)
check('pemilik baru mulai kosong: tidak melihat properti, penyewa, tagihan pemilik lain',
  r.status === 200 && r.json.properties.length === 0 && r.json.tenants.length === 0 && r.json.invoices.length === 0 && r.json.payments.length === 0,
  { props: r.json.properties?.length, tenants: r.json.tenants?.length })
check('pemilik baru hanya melihat akunnya sendiri', r.json.users.length === 1 && r.json.users[0].username === `owner${stamp}`, r.json.users?.map((u) => u.username))
r = await api('GET', '/api/notifications', undefined, B)
check('notifikasi pemilik lain tidak terlihat', Array.isArray(r.json) && r.json.every((n) => n.type === 'job_failed'), r.json.map?.((n) => n.type))
r = await api('PATCH', `/api/properties/${property.id}`, { version: 1, note: 'coba bobol' }, B)
check('pemilik lain tidak bisa mengubah properti ini', r.status === 403, r.json)
r = await api('GET', `/api/whatsapp/${property.id}/status`, undefined, B)
check('pemilik lain tidak bisa membuka WhatsApp properti ini', r.status === 403, r.json)
r = await api('PATCH', `/api/tenants/${tenant.id}`, { version: 1, job: 'bobol' }, B)
check('pemilik lain tidak bisa mengubah penyewa ini', r.status === 404, r.json)
r = await api('GET', `/api/files?ownerType=tenant&ownerId=${tenant.id}`, undefined, B)
check('pemilik lain tidak bisa melihat dokumen penyewa ini', r.status === 403, r.json)
r = await api('GET', '/api/trash', undefined, B)
check('tempat sampah pemilik lain tidak terlihat', Array.isArray(r.json) && r.json.length === 0, r.json.length)
r = await api('GET', '/api/audit', undefined, B)
check('log aktivitas hanya milik sendiri', Array.isArray(r.json) && r.json.every((e) => e.username === `owner${stamp}`), r.json.slice?.(0, 3).map((e) => e.username))
r = await api('POST', `/api/approvals/${delReq.id}/approve`, {}, B)
check('pemilik lain tidak bisa memproses persetujuan di sini', r.status === 404 || r.status === 409, r.json)
r = await api('POST', `/api/rentals`, {
  tenantId: tenant.id, roomId: freeRoom.id, startDate: addDays(today(), 60), endDate: null, rentType: 'monthly',
  price: 1000000, billingDay: 1, paymentMode: 'later', sendContract: false,
}, B)
check('pemilik lain tidak bisa membuat sewa di kamar ini', r.status === 403, r.json)

r = await api('POST', '/api/properties', {
  name: `Kost Mawar ${stamp}`, phone: `0819${String(stamp).padStart(8, '0')}`,
  address: { street: 'Jl. Mawar 1', postcode: '12345', province: 'DKI Jakarta', city: 'Jakarta', district: 'X', subdistrict: 'Y', lat: -6.2, lng: 106.8 },
}, B)
check('pemilik kedua membuat propertinya sendiri', r.status === 201, r.json)
const propB = r.json
r = await api('POST', '/api/properties', {
  name: 'Kode Bentrok', phone: `0818${String(stamp).padStart(8, '0')}`, code: property.code,
  address: { street: 'Jl. A', postcode: '12345', province: 'DKI Jakarta', city: 'Jakarta', district: 'X', subdistrict: 'Y', lat: -6.2, lng: 106.8 },
}, B)
check('kode faktur tidak boleh dipakai dua properti (nomor faktur unik)', r.status === 409, r.json)
r = await api('POST', '/api/tenants', { name: 'Penyewa Milik B', contacts: [{ id: 'b1', name: 'B', email: '', phone: '081299990123' }] }, B)
const tenantB = r.json
r = await api('GET', '/api/bootstrap')
check('pemilik pertama tidak melihat properti & penyewa pemilik kedua',
  !r.json.properties.some((p) => p.id === propB.id) && !r.json.tenants.some((t) => t.id === tenantB.id) && !r.json.users.some((u) => u.username === `owner${stamp}`))
r = await api('PATCH', `/api/properties/${propB.id}`, { version: propB.version, note: 'bobol' })
check('pemilik pertama tidak bisa mengubah properti pemilik kedua', r.status === 403, r.json)
r = await api('POST', '/api/users', { username: `admb${stamp}`, name: 'Admin B', role: 'admin', allProperties: true }, B)
const adminB = r.json.user
r = await api('POST', `/api/users/${adminB.id}/reset-password`, {})
check('pemilik pertama tidak bisa mereset password akun milik pemilik kedua', r.status === 404, r.json)
r = await api('POST', '/api/users', { username: `mix${stamp}`, name: 'Campur', role: 'admin', allProperties: false, propertyIds: [propB.id] })
check('akses ke properti orang lain tidak bisa diberikan', r.status === 403, r.json)

/* ---------------------------------------------------------------- developer: every feature, dummy data only */
const { execSync } = await import('node:child_process')
const devName = `dev${stamp}`
const out = execSync(`npm run cli:dev -- create-developer ${devName}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const devTemp = out.match(/Password sementara: (\S+)/)?.[1]
check('akun developer dibuat lewat CLI beserta sandbox', Boolean(devTemp), out.slice(-300))
const D = { jar: { cookie: '' } }
await api('POST', '/api/auth/login', { username: devName, password: devTemp }, D)
await api('POST', '/api/auth/change-password', { currentPassword: devTemp, newPassword: NEW_PASS }, D)
r = await api('GET', '/api/bootstrap', undefined, D)
const devBoot = r.json
check('developer punya data dummy lengkap (properti, kamar, penyewa, tagihan)',
  devBoot.properties.length === 2 && devBoot.rooms.length > 0 && devBoot.tenants.length > 0 && devBoot.invoices.length > 0, { p: devBoot.properties?.length })
check('developer tidak melihat satu pun data asli', devBoot.me.sandbox === true &&
  !devBoot.properties.some((p) => p.id === property.id || p.id === propB.id) && !devBoot.tenants.some((t) => t.id === tenant.id || t.id === tenantB.id))
r = await api('GET', `/api/whatsapp/${devBoot.properties[0].id}/status`, undefined, D)
check('WhatsApp sandbox selalu disimulasikan', r.json.driver === 'mock', r.json)
r = await api('PATCH', `/api/properties/${property.id}`, { version: 1, note: 'dev' }, D)
check('developer tidak bisa menyentuh properti asli', r.status === 403, r.json)
r = await api('POST', '/api/users', { username: `sup${stamp}`, name: 'Pemilik Palsu', role: 'superadmin' }, D)
check('developer tidak bisa membuat superadmin', r.status === 403, r.json)
r = await api('POST', '/api/users', { username: `devadm${stamp}`, name: 'Admin Uji Dev', role: 'admin', allProperties: true }, D)
check('developer bisa membuat akun uji di sandbox-nya', r.status === 201, r.json)
r = await api('GET', '/api/jobs', undefined, D)
check('developer punya akses fitur superadmin (log sistem)', r.status === 200, r.json)
const devRoom = devBoot.rooms[0]
r = await api('PATCH', `/api/rooms/${devRoom.id}`, { version: devRoom.version, price: { ...devRoom.price, monthly: devRoom.price.monthly + 1000 } }, D)
check('developer mengubah harga langsung (tanpa persetujuan) di sandbox', r.status === 200, r.json)
r = await api('POST', '/api/dev/reset-sandbox', {}, D)
check('developer bisa mereset data dummy', r.status === 200 && r.json.properties === 2, r.json)
r = await api('GET', '/api/bootstrap', undefined, D)
check('setelah reset: data dummy baru, data asli tetap tak terlihat', r.json.properties.length === 2 && !r.json.properties.some((p) => devBoot.properties.some((o) => o.id === p.id)))
r = await api('POST', '/api/dev/reset-sandbox', {})
check('superadmin tidak bisa memakai reset sandbox', r.status === 403, r.json)
r = await api('GET', '/api/bootstrap')
check('data pemilik pertama utuh setelah semua uji isolasi', r.json.properties.some((p) => p.id === property.id) && r.json.tenants.some((t) => t.id === tenant.id))

console.log(`\n${passed} pemeriksaan lulus.`)

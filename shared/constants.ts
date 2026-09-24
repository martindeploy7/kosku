import type {
  AgreementSettings, BookingPolicy, HouseRules, InvoicePdfSettings, LateFee, MessageTemplate,
  NotificationSettings, RentType, RuleGroupKey,
} from './types'

export const APP_NAME = 'Kosku'

/* ---------------- Rent ---------------- */

export const RENT_TYPES: { value: RentType; label: string; unit: string; days: number }[] = [
  { value: 'daily', label: 'Harian', unit: 'hari', days: 1 },
  { value: 'weekly', label: 'Mingguan', unit: 'minggu', days: 7 },
  { value: 'monthly', label: 'Bulanan', unit: 'bulan', days: 30 },
  { value: 'yearly', label: 'Tahunan', unit: 'tahun', days: 365 },
  { value: 'custom', label: 'Kustom', unit: 'periode', days: 30 },
]

export const rentTypeLabel = (t: RentType) => RENT_TYPES.find((r) => r.value === t)?.label ?? '-'
export const rentTypeUnit = (t: RentType) => RENT_TYPES.find((r) => r.value === t)?.unit ?? 'periode'

export const ROOM_CONDITIONS = [
  { value: 'bersih', label: 'Bersih', emoji: '⭐', tone: 'info' },
  { value: 'kotor', label: 'Kotor', emoji: '🪣', tone: 'warning' },
  { value: 'rusak', label: 'Rusak', emoji: '🛠️', tone: 'danger' },
] as const

export const ROOM_STATUSES = [
  { value: 'tersedia', label: 'Tersedia', short: 'Tersedia', tone: 'info' },
  { value: 'dipesan_dp', label: 'Dipesan · DP', short: 'DP', tone: 'warning' },
  { value: 'dipesan', label: 'Dipesan · Lunas', short: 'Dipesan', tone: 'primary' },
  { value: 'disewa', label: 'Terisi · Lunas', short: 'Terisi', tone: 'success' },
  { value: 'menunggak', label: 'Terisi · Menunggak', short: 'Menunggak', tone: 'danger' },
  { value: 'akan_tersedia', label: 'Akan tersedia', short: 'Akan kosong', tone: 'muted' },
] as const

export const TENANT_STATUSES = [
  { value: 'berjalan', label: 'Sewa berjalan', tone: 'success' },
  { value: 'akan_berakhir', label: 'Sewa akan berakhir', tone: 'warning' },
  { value: 'dipesan', label: 'Sudah pesan', tone: 'primary' },
  { value: 'belum_sewa', label: 'Belum sewa', tone: 'info' },
  { value: 'gagal_bayar', label: 'Gagal bayar', tone: 'danger' },
  { value: 'berakhir', label: 'Sewa berakhir', tone: 'muted' },
] as const

export const INVOICE_STATUSES = [
  { value: 'terjadwal', label: 'Terjadwal', tone: 'warning' },
  { value: 'belum_dibayar', label: 'Belum dibayar', tone: 'danger' },
  { value: 'sebagian', label: 'Dibayar sebagian', tone: 'info' },
  { value: 'lunas', label: 'Lunas', tone: 'success' },
  { value: 'batal', label: 'Batal', tone: 'muted' },
] as const

export const RENTAL_STATUSES = [
  { value: 'booked', label: 'Dipesan (DP)', tone: 'warning' },
  { value: 'active', label: 'Aktif', tone: 'success' },
  { value: 'ended', label: 'Selesai', tone: 'muted' },
  { value: 'lapsed', label: 'Gagal bayar', tone: 'danger' },
  { value: 'canceled', label: 'Dibatalkan', tone: 'muted' },
] as const

export const ROLE_LABELS = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  staff: 'Staf',
} as const

/**
 * Attributes a non-superadmin can't change directly: they become an approval
 * request (the server enforces this; the UI uses it to warn before saving).
 */
export const APPROVAL_GATED = {
  property: ['name', 'code', 'phone', 'paymentMethods', 'paymentInfo', 'lateFee', 'booking', 'rules', 'templates'],
  /** Inside `agreement`: the legal text and the landlord's identity/signature. */
  agreement: ['template', 'ownerName', 'ownerTitle', 'ownerSignatureFileId'],
  room: ['price', 'schemes'],
  invoice: ['items'],
} as const

export const APPROVAL_FIELD_LABELS: Record<string, string> = {
  name: 'nama properti', code: 'kode faktur', phone: 'nomor WhatsApp', paymentMethods: 'metode pembayaran',
  paymentInfo: 'info rekening', lateFee: 'denda', booking: 'kebijakan DP', rules: 'tata tertib', templates: 'template pesan',
  template: 'teks perjanjian', ownerName: 'nama pihak pertama', ownerTitle: 'jabatan pihak pertama',
  ownerSignatureFileId: 'tanda tangan pemilik', price: 'harga', schemes: 'skema sewa', items: 'nominal faktur',
}

export const ROLE_DESCRIPTIONS = {
  superadmin: 'Akses penuh ke semua properti: menyetujui penghapusan & perubahan penting, kelola pengguna, tempat sampah, dan log aktivitas.',
  admin: 'Operasional pada properti yang ditugaskan, termasuk dokumen penyewa. Penghapusan dan perubahan harga, rekening, denda, DP, perjanjian & tata tertib menunggu persetujuan superadmin.',
  staff: 'Frontdesk: catat pembayaran, kelola penyewa dan kamar. Tidak bisa menghapus atau melihat dokumen identitas; perubahan harga kamar & nominal faktur menunggu persetujuan superadmin.',
} as const

export const GENDERS = [
  { value: 'male', label: 'Laki-laki' },
  { value: 'female', label: 'Perempuan' },
]

export const MARITAL_STATUSES = [
  { value: 'single', label: 'Belum Menikah' },
  { value: 'married', label: 'Menikah' },
  { value: 'divorced', label: 'Cerai Hidup' },
  { value: 'widowed', label: 'Cerai Mati' },
]

export const FILE_KINDS = [
  { value: 'ktp', label: 'KTP', sensitive: true },
  { value: 'kk', label: 'Kartu Keluarga', sensitive: true },
  { value: 'foto', label: 'Foto penyewa', sensitive: false },
  { value: 'kontrak', label: 'Perjanjian', sensitive: false },
  { value: 'bukti_bayar', label: 'Bukti bayar', sensitive: false },
  { value: 'nota', label: 'Nota', sensitive: false },
  { value: 'ttd', label: 'Tanda tangan', sensitive: false },
  { value: 'lainnya', label: 'Lainnya', sensitive: true },
  { value: 'faktur', label: 'Faktur', sensitive: false },
  // Photos/PDFs a tenant sent on WhatsApp — usually transfer proofs. Anyone
  // holding the property's phone can already see them, so staff may too.
  { value: 'wa_media', label: 'Kiriman WhatsApp', sensitive: false },
] as const

/** Kinds staff may not open — identity documents are admin-only. */
export const SENSITIVE_FILE_KINDS = FILE_KINDS.filter((k) => k.sensitive).map((k) => k.value) as string[]

/* ---------------- Expenses ---------------- */

export const EXPENSE_CATEGORIES = [
  'Perawatan dan Perbaikan',
  'Perlengkapan',
  'Upah Karyawan',
  'Listrik & Air',
  'Internet',
  'Kebersihan',
  'Keamanan',
  'Pajak & Retribusi',
  'Pengeluaran Lainnya',
]

/* ---------------- House rules (tata tertib) ---------------- */

export const RULE_GROUPS: { key: RuleGroupKey; label: string; options: string[] }[] = [
  {
    key: 'accessHours',
    label: 'Jam akses',
    options: ['Akses 24 jam', 'Ada jam malam pukul 22.00', 'Check-in: 14:00-21:00', 'Check-out: maksimal 12:00'],
  },
  {
    key: 'tenantCriteria',
    label: 'Kriteria penyewa',
    options: [
      'Khusus pria/putra', 'Khusus wanita/putri', 'Khusus mahasiswa/pelajar',
      'Khusus karyawan', 'Khusus pasangan suami-istri', 'Khusus orang dewasa (tanpa anak)',
    ],
  },
  {
    key: 'generalPolicy',
    label: 'Kebijakan umum',
    options: [
      'Dilarang merokok di dalam kamar', 'Dilarang membawa hewan peliharaan',
      'Dilarang melakukan kegiatan ilegal (miras, narkoba, judi)', 'Wajib menjaga kebersihan kamar dan area bersama',
      'Wajib memberi tahu rencana keluar paling lambat 30 hari sebelumnya',
      'Dilarang membuat kegaduhan setelah pukul 22.00',
    ],
  },
  {
    key: 'paymentPolicy',
    label: 'Biaya dan pembayaran',
    options: [
      'Harga sudah termasuk listrik', 'Listrik ditanggung penyewa (token)',
      'Ada biaya tambahan untuk peralatan elektronik', 'Uang jaminan dikembalikan saat keluar setelah dikurangi kerusakan/tunggakan',
      'Keterlambatan pembayaran dikenakan denda', 'Uang muka (DP) hangus jika pelunasan melewati batas waktu',
    ],
  },
  {
    key: 'guestPolicy',
    label: 'Kebijakan tamu',
    options: [
      'Tamu boleh berkunjung sampai pukul 21.00', 'Tamu dilarang menginap',
      'Tamu lawan jenis dilarang masuk kamar', 'Tamu wajib lapor ke pengelola',
    ],
  },
  {
    key: 'requiredDocs',
    label: 'Persyaratan dokumen',
    options: ['KTP (Kartu Tanda Penduduk)', 'KK (Kartu Keluarga)', 'Surat nikah (untuk pasangan)', 'Kartu mahasiswa / surat keterangan kerja'],
  },
]

export const emptyHouseRules = (): HouseRules => ({
  groups: {
    accessHours: [], tenantCriteria: [], generalPolicy: [], paymentPolicy: [], guestPolicy: [], requiredDocs: [],
  },
  custom: [],
})

export const DEFAULT_HOUSE_RULES = (): HouseRules => ({
  groups: {
    accessHours: ['Akses 24 jam'],
    tenantCriteria: [],
    generalPolicy: [
      'Dilarang merokok di dalam kamar',
      'Dilarang melakukan kegiatan ilegal (miras, narkoba, judi)',
      'Wajib menjaga kebersihan kamar dan area bersama',
      'Wajib memberi tahu rencana keluar paling lambat 30 hari sebelumnya',
    ],
    paymentPolicy: ['Uang jaminan dikembalikan saat keluar setelah dikurangi kerusakan/tunggakan'],
    guestPolicy: ['Tamu dilarang menginap'],
    requiredDocs: ['KTP (Kartu Tanda Penduduk)'],
  },
  custom: [],
})

/* ---------------- WhatsApp message templates ---------------- */

export const DEFAULT_WA_TEMPLATES: MessageTemplate[] = [
  {
    id: 'billing',
    label: 'Tagihan',
    isDefault: true,
    body:
      'Halo {{penyewa}} 👋\n\nTagihan sewa {{properti}}:\nNo. Faktur: {{nomorFaktur}}\nKamar: {{kamar}}\nPeriode: {{periode}}\nJatuh tempo: {{jatuhTempo}}\nTotal: {{total}}\n\n{{infoPembayaran}}\n\nTerima kasih 🙏',
  },
  {
    id: 'reminder',
    label: 'Pengingat sebelum jatuh tempo',
    isDefault: true,
    body:
      'Halo {{penyewa}} 👋\n\nPengingat: tagihan sewa {{kamar}} di {{properti}} jatuh tempo pada {{jatuhTempo}}.\nNo. Faktur: {{nomorFaktur}}\nSisa tagihan: {{sisa}}\n\n{{infoPembayaran}}\n\nTerima kasih 🙏',
  },
  {
    id: 'due',
    label: 'Jatuh tempo hari ini',
    isDefault: true,
    body:
      'Halo {{penyewa}} 👋\n\nTagihan sewa {{kamar}} di {{properti}} jatuh tempo HARI INI ({{jatuhTempo}}).\nNo. Faktur: {{nomorFaktur}}\nSisa tagihan: {{sisa}}\n\n{{infoPembayaran}}\n\nTerima kasih 🙏',
  },
  {
    id: 'overdue',
    label: 'Tagihan terlambat',
    isDefault: true,
    body:
      'Halo {{penyewa}},\n\nTagihan sewa {{kamar}} di {{properti}} telah melewati jatuh tempo ({{jatuhTempo}}).\nNo. Faktur: {{nomorFaktur}}\nSisa tagihan: {{sisa}}\n\nMohon segera diselesaikan. Jika sudah membayar, abaikan pesan ini 🙏',
  },
  {
    id: 'receipt',
    label: 'Bukti pembayaran',
    isDefault: true,
    body:
      'Pembayaran Anda telah kami terima ✅\n\nNama: {{penyewa}}\nID Pembayaran: {{idPembayaran}}\nFaktur: {{nomorFaktur}}\nJumlah: {{total}}\nTanggal: {{tanggal}}\nSisa tagihan: {{sisa}}\n\nTerima kasih 🙏',
  },
  {
    id: 'booking',
    label: 'Konfirmasi pemesanan (DP)',
    isDefault: true,
    body:
      'Halo {{penyewa}} 👋\n\nPemesanan {{kamar}} di {{properti}} telah kami catat.\nUang muka: {{uangMuka}}\nSisa pelunasan: {{sisa}}\nBatas pelunasan: {{batasPelunasan}}\n\nKamar kami tahan sampai batas pelunasan. Jika belum lunas, pemesanan akan dibatalkan otomatis.\n\n{{infoPembayaran}}',
  },
  {
    id: 'lapsed',
    label: 'Pemesanan dibatalkan',
    isDefault: true,
    body:
      'Halo {{penyewa}},\n\nKarena pelunasan belum kami terima sampai {{batasPelunasan}}, pemesanan {{kamar}} di {{properti}} kami batalkan dan kamar dibuka kembali.\n\nSilakan hubungi kami jika ada pertanyaan 🙏',
  },
  {
    id: 'agreement',
    label: 'Perjanjian sewa & tata tertib',
    isDefault: true,
    body:
      'Halo {{penyewa}} 👋\n\nTerlampir Perjanjian Sewa beserta Tata Tertib {{properti}} untuk {{kamar}}. Mohon dibaca dengan saksama.\n\nSetelah membaca, tanda tangani secara elektronik melalui tautan berikut:\n{{link}}\n\nTautan berlaku sampai {{berlakuSampai}}. Terima kasih 🙏',
  },
  {
    id: 'agreementSigned',
    label: 'Perjanjian ditandatangani',
    isDefault: true,
    body:
      'Terima kasih {{penyewa}} ✅\n\nPerjanjian sewa {{kamar}} di {{properti}} telah ditandatangani. Salinannya terlampir untuk arsip Anda.',
  },
  {
    id: 'birthday',
    label: 'Ulang tahun',
    isDefault: true,
    body:
      '🎉 Selamat ulang tahun, {{penyewa}}!\n\nSemoga sehat, bahagia, dan sukses selalu. Salam hangat dari keluarga besar {{properti}} 🎂',
  },
]

export const TEMPLATE_VARIABLES = [
  '{{penyewa}}', '{{properti}}', '{{kamar}}', '{{nomorFaktur}}', '{{periode}}', '{{jatuhTempo}}',
  '{{total}}', '{{sisa}}', '{{tanggal}}', '{{idPembayaran}}', '{{infoPembayaran}}',
  '{{uangMuka}}', '{{batasPelunasan}}', '{{link}}', '{{berlakuSampai}}',
]

/** Replace `{{var}}` tokens. Unknown tokens are left visible so mistakes are noticed. */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? m : String(v)
  })
}

/* ---------------- Agreement (perjanjian sewa) ---------------- */

/* A small line format shared by the PDF renderer and the signing page:
 *   "# "  title        "## " section heading
 *   "1. " / "- "       list item          blank line  paragraph break */
export const DEFAULT_AGREEMENT_TEMPLATE = `# PERJANJIAN SEWA KAMAR
Nomor: {{nomorPerjanjian}}

Pada tanggal {{tanggalPerjanjian}}, yang bertanda tangan di bawah ini:

## Para Pihak
1. {{pemilik}}, selaku {{jabatanPemilik}} {{properti}}, beralamat di {{alamatProperti}}, selanjutnya disebut PIHAK PERTAMA.
2. {{penyewa}}, pemegang identitas nomor {{nomorIdentitas}}, nomor telepon {{teleponPenyewa}}, selanjutnya disebut PIHAK KEDUA.

PIHAK PERTAMA dan PIHAK KEDUA sepakat mengikatkan diri dalam perjanjian sewa kamar dengan ketentuan sebagai berikut.

## Pasal 1 - Objek Sewa
PIHAK PERTAMA menyewakan {{kamar}} di {{properti}} kepada PIHAK KEDUA untuk digunakan sebagai tempat tinggal.

## Pasal 2 - Jangka Waktu
Masa sewa dimulai pada {{tanggalMulai}} {{klausulBerakhir}}, dengan skema sewa {{periodeSewa}}.

## Pasal 3 - Harga Sewa dan Pembayaran
1. Harga sewa sebesar {{harga}} per {{satuanPeriode}}{{klausulLayanan}}.
2. Tagihan diterbitkan setiap tanggal {{tanggalTagihan}} dan wajib dibayar paling lambat pada tanggal jatuh tempo yang tercantum dalam tagihan.
3. Pembayaran dilakukan melalui {{metodePembayaran}}.
4. {{klausulDenda}}

## Pasal 4 - Uang Muka dan Uang Jaminan
1. {{klausulDp}}
2. {{klausulDeposit}}

## Pasal 5 - Kewajiban PIHAK KEDUA
1. Menjaga kebersihan, keamanan, dan ketertiban kamar serta lingkungan {{properti}}.
2. Tidak memindahtangankan atau menyewakan kembali kamar kepada pihak lain.
3. Bertanggung jawab atas kerusakan yang timbul akibat kelalaian PIHAK KEDUA.
4. Menaati Tata Tertib terlampir yang merupakan bagian tidak terpisahkan dari perjanjian ini.

## Pasal 6 - Berakhirnya Sewa
1. PIHAK KEDUA wajib memberitahukan rencana keluar paling lambat 30 hari sebelumnya.
2. Saat keluar, kamar diserahkan kembali dalam keadaan baik dan seluruh kunci dikembalikan.
3. PIHAK PERTAMA berhak mengakhiri perjanjian apabila PIHAK KEDUA melanggar Tata Tertib secara berat atau tidak membayar sewa sesuai ketentuan.

## Pasal 7 - Penutup
Perjanjian ini disetujui dan ditandatangani secara elektronik. Dengan menandatangani, PIHAK KEDUA menyatakan telah membaca, memahami, dan menyetujui seluruh isi perjanjian ini beserta Tata Tertib terlampir.`

export const AGREEMENT_VARIABLES = [
  '{{nomorPerjanjian}}', '{{tanggalPerjanjian}}', '{{pemilik}}', '{{jabatanPemilik}}', '{{properti}}',
  '{{alamatProperti}}', '{{penyewa}}', '{{nomorIdentitas}}', '{{teleponPenyewa}}', '{{kamar}}',
  '{{tanggalMulai}}', '{{klausulBerakhir}}', '{{periodeSewa}}', '{{harga}}', '{{satuanPeriode}}',
  '{{klausulLayanan}}', '{{tanggalTagihan}}', '{{metodePembayaran}}', '{{klausulDenda}}',
  '{{klausulDp}}', '{{klausulDeposit}}',
]

/* ---------------- Property defaults ---------------- */

export const defaultLateFee = (): LateFee => ({
  enabled: false, type: 'fixed', value: 0, graceDays: 0, frequency: 'once',
})

export const defaultBookingPolicy = (): BookingPolicy => ({
  dpHoldDays: 3, graceDays: 0, lapsePolicy: 'forfeit',
})

export const defaultInvoicePdf = (): InvoicePdfSettings => ({
  language: 'id', customLogo: false, logoSize: 65, font: 'Plus Jakarta Sans',
  fontSize: 9, textColor: '#111827', labelColor: '#6b7280', note: '',
})

export const defaultAgreement = (): AgreementSettings => ({
  template: DEFAULT_AGREEMENT_TEMPLATE,
  ownerName: '',
  ownerTitle: 'Pemilik',
  ownerSignatureFileId: null,
  linkExpiryDays: 7,
  autoSend: true,
})

export const defaultNotificationSettings = (): NotificationSettings => ({
  birthdayGreeting: true,
  billingReminder: {
    enabled: true,
    beforeDue: { enabled: true, days: 3 },
    onDue: { enabled: true },
    first: { enabled: true, days: 1 },
    second: { enabled: false, days: 3 },
    last: { enabled: false, days: 7 },
  },
  paymentReceipt: true,
  sendHour: 8,
})

/* ---------------- Invoice PDF (client side) ---------------- */

export const PDF_FONTS = ['Plus Jakarta Sans', 'Poppins', 'Inter', 'Helvetica', 'Times']
export const PDF_FONT_SIZES = [
  { label: 'Kecil', value: 9 },
  { label: 'Sedang', value: 11 },
  { label: 'Besar', value: 13 },
]
export const PDF_LOGO_SIZES = [
  { label: 'Kecil', value: 45 },
  { label: 'Sedang', value: 65 },
  { label: 'Besar', value: 90 },
]

/* ---------------- Report catalogue ---------------- */

export const REPORT_CATALOGUE = [
  {
    group: 'Keuangan',
    items: [
      { slug: 'cash-flow', title: 'Arus Kas', desc: 'Menampilkan semua transaksi berdasarkan akun dalam periode tertentu, termasuk kronologi pergerakan transaksinya.' },
      { slug: 'profit-loss', title: 'Laporan Laba Rugi', desc: 'Menampilkan semua pendapatan yang diperoleh dan biaya yang dikeluarkan dalam periode tertentu.' },
      { slug: 'ledger', title: 'Buku Besar', desc: 'Daftar lengkap transaksi debit dan kredit untuk setiap akun selama periode yang dipilih.' },
      { slug: 'balance-sheet', title: 'Laporan Neraca', desc: 'Merangkum aset, liabilitas, dan ekuitas untuk memberikan gambaran kondisi keuangan.' },
    ],
  },
  {
    group: 'Pembayaran',
    items: [
      { slug: 'income', title: 'Laporan Pendapatan', desc: 'Menampilkan semua transaksi penerimaan dari setiap penyewa dalam periode tertentu.' },
      { slug: 'expense', title: 'Laporan Pengeluaran', desc: 'Menampilkan semua pengeluaran dalam periode tertentu.' },
      { slug: 'deposit', title: 'Laporan Deposit', desc: 'Menampilkan semua transaksi uang jaminan dari setiap penyewa.' },
      { slug: 'invoices', title: 'Laporan Tagihan', desc: 'Menampilkan semua tagihan yang harus dibayar oleh penyewa dalam periode tertentu.' },
      { slug: 'settlement-time', title: 'Laporan Waktu Pelunasan Tagihan', desc: 'Rata-rata waktu yang dibutuhkan penyewa untuk melunasi tagihan mereka.' },
      { slug: 'overdue', title: 'Laporan Jatuh Tempo', desc: 'Semua penyewa aktif beserta jumlah pembayaran dan tagihan yang telah jatuh tempo.' },
    ],
  },
  {
    group: 'Penyewa',
    items: [
      { slug: 'tenants', title: 'Laporan Penyewa', desc: 'Daftar lengkap penyewa dalam periode yang dipilih.' },
      { slug: 'tenant-detail', title: 'Laporan Detail Penyewa', desc: 'Menampilkan detail lengkap data penyewa.' },
      { slug: 'occupancy', title: 'Laporan Okupansi', desc: 'Merangkum tingkat hunian, ketersediaan, dan pemesanan kamar.' },
      { slug: 'lease-duration', title: 'Laporan Durasi Sewa', desc: 'Rata-rata lama penyewa menyewa properti dalam periode yang dipilih.' },
      { slug: 'vehicles', title: 'Daftar Kendaraan Penyewa', desc: 'Daftar kendaraan milik penyewa saat ini atau calon penyewa yang akan masuk.' },
    ],
  },
]

export const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hari ini' },
  { value: 'week', label: '7 hari terakhir' },
  { value: 'month', label: 'Bulan ini' },
  { value: 'last-month', label: 'Bulan lalu' },
  { value: 'quarter', label: '3 bulan terakhir' },
  { value: 'year', label: 'Tahun ini' },
  { value: 'all', label: 'Semua waktu' },
]

export const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316']

/* Errors carry an Indonesian message meant for the admin, not a stack trace. */

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 423 | 429 | 500 | 503,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details)
export const unauthorized = (msg = 'Silakan masuk terlebih dahulu.') => new HttpError(401, msg, 'unauthorized')
export const forbidden = (msg = 'Anda tidak memiliki akses untuk tindakan ini.') => new HttpError(403, msg, 'forbidden')
export const notFound = (what = 'Data') => new HttpError(404, `${what} tidak ditemukan.`, 'not_found')
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, msg, code)

/** The row was changed by someone else since this admin loaded it. */
export const staleVersion = () =>
  new HttpError(
    409,
    'Data ini baru saja diubah oleh admin lain. Muat ulang untuk melihat versi terbaru, lalu ulangi perubahan Anda.',
    'stale_version',
  )

/* Map Postgres constraint violations to messages an admin can act on. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  rentals_no_overlap: 'Kamar ini sudah dipesan atau disewa pada tanggal tersebut. Pilih kamar atau tanggal lain.',
  rentals_dates_ck: 'Tanggal selesai harus setelah tanggal mulai.',
  rentals_booked_deadline_ck: 'Pemesanan dengan DP wajib memiliki batas pelunasan.',
  properties_phone_uq: 'Nomor WhatsApp ini sudah dipakai properti lain. Satu properti hanya boleh memakai satu nomor, dan satu nomor hanya untuk satu properti.',
  users_username_uq: 'Username sudah dipakai. Pilih username lain.',
  properties_code_uq: 'Kode faktur ini sudah dipakai properti lain. Pilih kode lain.',
  invoices_rental_period_uq: 'Tagihan untuk periode ini sudah ada.',
  payments_amount_ck: 'Jumlah pembayaran tidak boleh nol.',
}

export function mapDbError(e: unknown): HttpError | null {
  const err = e as { code?: string; constraint_name?: string; constraint?: string }
  // drizzle wraps driver errors; the original sits on `cause`.
  const src = (err && typeof err === 'object' && 'cause' in err ? (err as { cause: typeof err }).cause : err) ?? err
  const code = src?.code
  if (!code) return null
  const constraint = src.constraint_name ?? src.constraint ?? ''
  const known = CONSTRAINT_MESSAGES[constraint]
  if (code === '23P01') return conflict(known ?? 'Jadwal bertabrakan dengan data lain.', 'overlap')
  if (code === '23505') return conflict(known ?? 'Data dengan nilai yang sama sudah ada.', 'duplicate')
  if (code === '23514') return badRequest(known ?? 'Data tidak memenuhi aturan validasi.')
  if (code === '23503') return badRequest('Data terkait tidak ditemukan atau sudah dihapus.')
  return null
}

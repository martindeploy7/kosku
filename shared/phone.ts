/* Phone numbers are stored as E.164 digits without the plus: `628123456789`.
 *
 * One canonical form is what makes "the number set on the property" and "the
 * number that scanned the WhatsApp QR" comparable at all — `0812…`,
 * `+62 812-…` and `62812…` are the same line and must compare equal. */

export function normalizePhone(input: string | null | undefined, defaultCountry = '62'): string {
  if (!input) return ''
  const raw = String(input).trim()
  const hadPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  let out: string
  if (hadPlus) out = digits
  else if (digits.startsWith('00')) out = digits.slice(2)
  else if (digits.startsWith('0')) out = defaultCountry + digits.slice(1)
  else if (digits.startsWith(defaultCountry)) out = digits
  // A bare local number such as "8123456789".
  else if (digits.startsWith('8') && defaultCountry === '62') out = defaultCountry + digits
  else out = digits
  // "+62 0812…" — the local trunk 0 typed after the country code. No Indonesian number continues 620….
  if (out.startsWith('620')) out = '62' + out.slice(3).replace(/^0+/, '')
  return out
}

export function samePhone(a: string | null | undefined, b: string | null | undefined) {
  const na = normalizePhone(a)
  return na !== '' && na === normalizePhone(b)
}

/** Rough sanity check: Indonesian mobiles are 62 8xx, 10–13 digits after 62. */
export function isValidPhone(input: string | null | undefined) {
  const n = normalizePhone(input)
  return /^\d{9,15}$/.test(n)
}

/** Pull the phone out of a WhatsApp JID: `628123:14@s.whatsapp.net` → `628123`. */
export function phoneFromJid(jid: string | null | undefined): string {
  if (!jid) return ''
  const user = jid.split('@')[0] ?? ''
  return user.split(':')[0].replace(/\D/g, '')
}

export function formatPhoneDisplay(phone: string | null | undefined) {
  const n = normalizePhone(phone)
  if (!n) return '-'
  if (n.startsWith('62')) {
    const rest = n.slice(2)
    return '+62 ' + (rest.match(/.{1,4}/g) || []).join(' ')
  }
  return '+' + n
}

/** Link that opens a WhatsApp chat with a pre-filled message — the manual fallback. */
export function waMeLink(phone: string, text?: string) {
  const n = normalizePhone(phone)
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

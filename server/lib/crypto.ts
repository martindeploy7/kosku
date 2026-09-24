import { createHash, randomBytes, randomInt } from 'node:crypto'

export const sha256 = (input: string | Buffer) => createHash('sha256').update(input).digest('hex')

/** URL-safe random token (256 bits by default). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** Human-typable transaction id, e.g. TRF-6K2Q9M4P. */
export function transactionId(prefix: string) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += alphabet[randomInt(alphabet.length)]
  return `${prefix}-${s}`
}

/**
 * Temporary password handed to a new admin in person. Avoids look-alike
 * characters so it can be read aloud or copied from a phone screen.
 */
export function temporaryPassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < length; i++) s += alphabet[randomInt(alphabet.length)]
  // Group for readability: abcd-efgh-jkmn
  return s.match(/.{1,4}/g)!.join('-')
}

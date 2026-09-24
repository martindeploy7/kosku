import { hash, verify } from '@node-rs/argon2'

/* argon2id with OWASP's baseline parameters (19 MiB, t=2, p=1). */
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export const hashPassword = (password: string) => hash(password, OPTS)

export async function verifyPassword(stored: string, password: string) {
  try {
    return await verify(stored, password)
  } catch {
    return false
  }
}

/** A fixed hash to verify against when the username doesn't exist, so a
 *  wrong username and a wrong password take the same time. */
let dummyHash: Promise<string> | null = null
export async function burnVerifyTime(password: string) {
  dummyHash ??= hashPassword('kosku-timing-equaliser')
  await verifyPassword(await dummyHash, password)
}

const COMMON = new Set([
  'password', 'password1', 'password123', '123456789012', '1234567890', 'qwertyuiop', 'qwerty123456',
  'iloveyou', 'admin12345', 'administrator', 'welcome123', 'passw0rd', 'kosku12345', 'kosku123456',
  'bismillah123', 'indonesia123', 'rahasia12345', 'sayang123456', 'superadmin', 'superadmin123',
  '1q2w3e4r5t6y', 'abcdefghijkl', 'aaaaaaaaaaaa',
])

export const MIN_PASSWORD_LENGTH = 12

/** Length over complexity rules (NIST 800-63B): long, not common, not the username. */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`
  if (password.length > 128) return 'Password maksimal 128 karakter.'
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) return 'Password ini terlalu umum. Gunakan kalimat yang mudah Anda ingat.'
  if (/^(.)\1+$/.test(password)) return 'Password tidak boleh berisi satu karakter berulang.'
  if (username && lower.includes(username.toLowerCase())) return 'Password tidak boleh memuat username.'
  return null
}

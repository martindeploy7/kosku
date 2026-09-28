import type { Context, MiddlewareHandler } from 'hono'
import type { Role } from '@shared/types'
import { env } from '../env'
import { forbidden, HttpError, unauthorized } from '../lib/errors'
import { readSession, type SessionUser } from './session'

export type AppEnv = {
  Variables: {
    user: SessionUser | null
    sessionId: string | null
    ip: string
  }
}
export type Ctx = Context<AppEnv>

export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const cf = c.req.header('cf-connecting-ip')
    if (cf) return cf
    const xff = c.req.header('x-forwarded-for')
    if (xff) return xff.split(',')[0].trim()
    const real = c.req.header('x-real-ip')
    if (real) return real
  }
  // @hono/node-server exposes the socket on env.incoming
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  return incoming?.socket?.remoteAddress ?? 'unknown'
}

/** Resolves the session (if any) for every /api request. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('ip', clientIp(c))
  const s = await readSession(c)
  c.set('user', s?.user ?? null)
  c.set('sessionId', s?.sessionId ?? null)
  await next()
}

/**
 * CSRF guard: state-changing requests must carry a custom header. Browsers
 * refuse to send custom headers cross-site without a CORS preflight, and this
 * API grants none — so a forged form post from another site can't get through.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && c.req.header('x-kosku') !== '1') {
    throw new HttpError(403, 'Permintaan ditolak (header keamanan tidak ada).', 'csrf')
  }
  await next()
}

export function requireUser(c: Ctx): SessionUser {
  const u = c.get('user')
  if (!u) throw unauthorized()
  if (u.mustChangePassword) {
    throw new HttpError(403, 'Anda wajib mengganti password sebelum melanjutkan.', 'must_change_password')
  }
  return u
}

/** Superadmin-level: a workspace owner, or a developer inside their sandbox (same features, dummy data). */
export const isSuper = (u: Pick<SessionUser, 'role'>) => u.role === 'superadmin' || u.role === 'developer'

export function requireRole(c: Ctx, ...roles: Role[]): SessionUser {
  const u = requireUser(c)
  // A developer can use everything a superadmin can — only ever on their own sandbox data.
  if (!roles.includes(u.role) && !(u.role === 'developer' && roles.includes('superadmin'))) throw forbidden()
  return u
}

export const canDelete = (u: SessionUser) => isSuper(u) || u.role === 'admin'
export const canSeeSensitiveDocs = (u: SessionUser) => isSuper(u) || u.role === 'admin'

/** The properties the user may access — always an explicit list (their workspace only). */
export const accessibleProperties = (u: SessionUser): string[] => u.propertyIds

/** A property id belongs to this user's reach. Anything outside their workspace is invisible. */
export function canAccessProperty(u: SessionUser, propertyId: string | null | undefined) {
  if (!propertyId) return true
  return u.propertyIds.includes(propertyId)
}

/** Records without a property (tenants, users, trash…) are checked by workspace instead. */
export function assertSameWorkspace(u: SessionUser, ownerId: string | null | undefined) {
  if (ownerId !== u.ownerId) throw forbidden('Data ini bukan milik Anda.')
}

export function assertPropertyAccess(u: SessionUser, propertyId: string | null | undefined) {
  if (!canAccessProperty(u, propertyId)) throw forbidden('Anda tidak memiliki akses ke properti ini.')
}

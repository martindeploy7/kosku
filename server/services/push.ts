import { and, eq, inArray, isNull } from 'drizzle-orm'
import webpush from 'web-push'
import { workspaceOf } from '../auth/session'
import { db, schema } from '../db/client'
import { env } from '../env'
import { errMeta, log } from '../lib/log'

/* Web push to admins' phones and laptops. VAPID keys come from the
 * environment, or are generated once and kept in the settings table so
 * existing subscriptions survive restarts. */

let vapid: { publicKey: string; privateKey: string } | null = null

export async function initPush() {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  } else {
    const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, 'vapid') })
    if (row) {
      vapid = row.value as typeof vapid
    } else {
      vapid = webpush.generateVAPIDKeys()
      await db.insert(schema.settings).values({ key: 'vapid', value: vapid }).onConflictDoNothing()
      log.info('Kunci VAPID untuk web push dibuat dan disimpan')
    }
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, vapid!.publicKey, vapid!.privateKey)
}

export const vapidPublicKey = () => vapid?.publicKey ?? null

export interface PushPayload {
  title: string
  body: string
  link: string
  tag?: string
}

async function recipients(scope: PushScope) {
  const users = await db
    .select({
      id: schema.users.id, role: schema.users.role, ownerId: schema.users.ownerId,
      all: schema.users.allProperties, props: schema.users.propertyIds,
    })
    .from(schema.users)
    .where(and(eq(schema.users.isActive, true), isNull(schema.users.deletedAt)))
  const owners = (u: { role: string }) => u.role === 'superadmin' || u.role === 'developer'
  return users
    // Never outside the workspace the notice belongs to.
    .filter((u) => (scope.ownerId ? workspaceOf(u as never) === scope.ownerId : owners(u)))
    .filter((u) => (scope.audience === 'superadmin' ? owners(u) : true))
    .filter((u) => !scope.propertyId || owners(u) || u.all || u.props.includes(scope.propertyId))
    .map((u) => u.id)
}

type PushScope = { propertyId: string | null; audience: 'all' | 'superadmin'; ownerId: string | null }

export async function sendPushToAudience(
  scope: PushScope,
  payload: PushPayload,
) {
  if (!vapid) return
  const userIds = await recipients(scope)
  if (!userIds.length) return
  const subs = await db.select().from(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.userId, userIds))
  await Promise.all(subs.map((s) => deliver(s, payload)))
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!vapid) return 0
  const subs = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId))
  await Promise.all(subs.map((s) => deliver(s, payload)))
  return subs.length
}

async function deliver(sub: typeof schema.pushSubscriptions.$inferSelect, payload: PushPayload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 },
    )
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) {
      // The browser dropped this subscription; forget it.
      await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id))
    } else {
      log.warn('Web push gagal', { status, ...errMeta(e) })
    }
  }
}

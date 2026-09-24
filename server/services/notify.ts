import { and, desc, eq, inArray, isNull, or, sql as dsql } from 'drizzle-orm'
import type { AppNotification, NotificationSeverity } from '@shared/types'
import type { SessionUser } from '../auth/session'
import { type Executor, db, iso, schema } from '../db/client'
import type { Effects } from '../lib/effects'
import { bumpRev } from '../lib/rev'
import { sendPushToAudience, sendPushToUser } from './push'

export interface NotifyInput {
  type: string
  severity: NotificationSeverity
  title: string
  body?: string
  link?: string | null
  propertyId?: string | null
  audience?: 'all' | 'superadmin'
  /** Only this user sees it (and gets the push). */
  userId?: string | null
  /** Same key → created once. Scheduled alerts use it to stay idempotent. */
  dedupeKey?: string | null
  /** Also send a web push to subscribed devices. */
  push?: boolean
}

/** Insert a notification (deduplicated). Push goes out only after commit. */
export async function notify(exec: Executor, input: NotifyInput, fx?: Effects) {
  const rows = await exec
    .insert(schema.notifications)
    .values({
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body ?? '',
      link: input.link ?? null,
      propertyId: input.propertyId ?? null,
      audience: input.audience ?? 'all',
      userId: input.userId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: schema.notifications.dedupeKey })
    .returning()

  const created = rows[0]
  if (!created) return null
  bumpRev()
  if (input.push !== false && (input.severity === 'warning' || input.severity === 'danger' || input.push)) {
    const payload = { title: created.title, body: created.body, link: created.link ?? '/notifications', tag: created.type }
    const job = () =>
      created.userId
        ? sendPushToUser(created.userId, payload).then(() => undefined)
        : sendPushToAudience({ propertyId: created.propertyId, audience: created.audience }, payload)
    if (fx) fx.push(job)
    else void job()
  }
  return created
}

/** Visibility: property-scoped notices go to users with access to that property. */
function visibleTo(user: SessionUser) {
  const n = schema.notifications
  const audience = user.role === 'superadmin' ? dsql`true` : eq(n.audience, 'all')
  const scope = user.allProperties
    ? dsql`true`
    : or(isNull(n.propertyId), user.propertyIds.length ? inArray(n.propertyId, user.propertyIds) : dsql`false`)
  // Personal notices reach exactly their user, whatever the role.
  return or(eq(n.userId, user.id), and(isNull(n.userId), audience, scope))
}

export async function listNotifications(user: SessionUser, limit = 50): Promise<AppNotification[]> {
  const n = schema.notifications
  const r = schema.notificationReads
  const rows = await db
    .select({ n, readAt: r.readAt })
    .from(n)
    .leftJoin(r, and(eq(r.notificationId, n.id), eq(r.userId, user.id)))
    .where(visibleTo(user))
    .orderBy(desc(n.createdAt))
    .limit(limit)
  return rows.map(({ n: row, readAt }) => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    link: row.link,
    propertyId: row.propertyId,
    createdAt: iso(row.createdAt)!,
    read: Boolean(readAt),
  }))
}

export async function unreadCount(user: SessionUser) {
  const n = schema.notifications
  const r = schema.notificationReads
  const rows = await db
    .select({ c: dsql<number>`count(*)` })
    .from(n)
    .leftJoin(r, and(eq(r.notificationId, n.id), eq(r.userId, user.id)))
    .where(and(visibleTo(user), isNull(r.notificationId), dsql`${n.createdAt} > now() - interval '30 days'`))
  return Number(rows[0]?.c ?? 0)
}

export async function markRead(user: SessionUser, ids: string[] | 'all') {
  const n = schema.notifications
  let targetIds: string[]
  if (ids === 'all') {
    const rows = await db.select({ id: n.id }).from(n).where(visibleTo(user)).orderBy(desc(n.createdAt)).limit(500)
    targetIds = rows.map((r) => r.id)
  } else {
    targetIds = ids
  }
  if (!targetIds.length) return
  await db
    .insert(schema.notificationReads)
    .values(targetIds.map((id) => ({ notificationId: id, userId: user.id })))
    .onConflictDoNothing()
}

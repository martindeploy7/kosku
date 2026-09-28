import { eq } from 'drizzle-orm'
import { defaultNotificationSettings } from '@shared/constants'
import type { AppSettings } from '@shared/types'
import { type Executor, db, schema } from '../db/client'

/** One settings row per workspace (owner). */
const keyOf = (ownerId: string) => `app:${ownerId}`

const defaults = (): AppSettings => ({
  notifications: defaultNotificationSettings(),
  requireIdNumber: false,
})

/** Deep-merge stored settings over defaults so new fields appear after upgrades. */
function merge(stored: Partial<AppSettings> | undefined): AppSettings {
  const d = defaults()
  if (!stored) return d
  return {
    ...d,
    ...stored,
    notifications: {
      ...d.notifications,
      ...(stored.notifications ?? {}),
      billingReminder: {
        ...d.notifications.billingReminder,
        ...(stored.notifications?.billingReminder ?? {}),
      },
    },
  }
}

export async function getAppSettings(ownerId: string, exec: Executor = db): Promise<AppSettings> {
  const rows = await exec.select().from(schema.settings).where(eq(schema.settings.key, keyOf(ownerId))).limit(1)
  return merge(rows[0]?.value as Partial<AppSettings> | undefined)
}

export async function saveAppSettings(ownerId: string, next: AppSettings, exec: Executor = db) {
  await exec
    .insert(schema.settings)
    .values({ key: keyOf(ownerId), value: next })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next, updatedAt: new Date().toISOString() } })
  return next
}

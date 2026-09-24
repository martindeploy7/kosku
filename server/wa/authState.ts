import { and, eq, inArray } from 'drizzle-orm'
import {
  type AuthenticationCreds, type AuthenticationState, BufferJSON, initAuthCreds, proto, type SignalDataTypeMap,
} from 'baileys'
import { db, schema } from '../db/client'

/* Baileys' credentials and Signal keys, stored in Postgres instead of files.
 * Being in the database means they are included in every backup: restoring a
 * backup does not force anyone to re-scan the QR code. */

const encode = (v: unknown) => JSON.stringify(v, BufferJSON.replacer)
const decode = <T>(s: string): T => JSON.parse(s, BufferJSON.reviver) as T

export async function usePgAuthState(propertyId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
}> {
  const t = schema.waAuth

  const write = async (key: string, value: unknown) => {
    await db
      .insert(t)
      .values({ propertyId, key, value: encode(value) })
      .onConflictDoUpdate({ target: [t.propertyId, t.key], set: { value: encode(value) } })
  }

  const credsRow = await db.query.waAuth.findFirst({ where: and(eq(t.propertyId, propertyId), eq(t.key, 'creds')) })
  const creds: AuthenticationCreds = credsRow ? decode<AuthenticationCreds>(credsRow.value) : initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {}
          if (!ids.length) return out
          const rows = await db
            .select()
            .from(t)
            .where(and(eq(t.propertyId, propertyId), inArray(t.key, ids.map((id) => `${type}-${id}`))))
          const byKey = new Map(rows.map((r) => [r.key, r.value]))
          for (const id of ids) {
            const raw = byKey.get(`${type}-${id}`)
            if (!raw) continue
            let value = decode<unknown>(raw)
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object)
            }
            out[id] = value as SignalDataTypeMap[T]
          }
          return out
        },
        set: async (data) => {
          const upserts: { key: string; value: unknown }[] = []
          const deletes: string[] = []
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            const entries = data[category] ?? {}
            for (const id of Object.keys(entries)) {
              const value = (entries as Record<string, unknown>)[id]
              const key = `${category}-${id}`
              if (value) upserts.push({ key, value })
              else deletes.push(key)
            }
          }
          await db.transaction(async (tx) => {
            for (const u of upserts) {
              await tx
                .insert(t)
                .values({ propertyId, key: u.key, value: encode(u.value) })
                .onConflictDoUpdate({ target: [t.propertyId, t.key], set: { value: encode(u.value) } })
            }
            if (deletes.length) await tx.delete(t).where(and(eq(t.propertyId, propertyId), inArray(t.key, deletes)))
          })
        },
      },
    },
    saveCreds: () => write('creds', creds),
  }
}

export async function clearAuthState(propertyId: string) {
  await db.delete(schema.waAuth).where(eq(schema.waAuth.propertyId, propertyId))
}

export async function hasAuthState(propertyId: string) {
  const row = await db.query.waAuth.findFirst({
    where: and(eq(schema.waAuth.propertyId, propertyId), eq(schema.waAuth.key, 'creds')),
  })
  if (!row) return false
  return Boolean(decode<AuthenticationCreds>(row.value).me?.id)
}

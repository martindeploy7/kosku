import { and, eq, inArray, isNull, sql as dsql } from 'drizzle-orm'
import { hashPassword } from './auth/password'
import { db, schema } from './db/client'
import { temporaryPassword } from './lib/crypto'
import { log } from './lib/log'
import { bumpRev } from './lib/rev'
import { seedDemo } from './seed'

/* ---------------------------------------------------------------------------
 * Developer sandbox.
 *
 * A developer account has every feature a superadmin has, but works in its own
 * workspace filled with dummy data. It can never see an owner's real
 * properties, tenants or finances (workspace isolation), and WhatsApp is always
 * simulated for sandbox properties, so dummy tenants are never messaged.
 * ------------------------------------------------------------------------- */

const findUser = (username: string) => db.query.users.findFirst({
  where: and(dsql`lower(${schema.users.username}) = ${username.toLowerCase()}`, isNull(schema.users.deletedAt)),
})

/** Create a developer account with a fresh sandbox. Returns the temporary password. */
export async function createDeveloper(username: string, name = 'Developer') {
  if (await findUser(username)) throw new Error(`Username "${username}" sudah dipakai.`)
  const temp = temporaryPassword()
  const user = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.users).values({
      username: username.toLowerCase(), name, role: 'developer', allProperties: true,
      passwordHash: await hashPassword(temp), mustChangePassword: true,
    }).returning()
    const [own] = await tx.update(schema.users).set({ ownerId: created.id }).where(eq(schema.users.id, created.id)).returning()
    return own
  })
  try {
    await seedDemo({ ownerId: user.id })
  } catch (e) {
    // All or nothing: no developer account without its sandbox.
    await db.delete(schema.users).where(eq(schema.users.id, user.id))
    throw e
  }
  return { user, temp }
}

/** Throw away the sandbox's dummy data and seed a fresh set. Developer workspaces only. */
export async function resetSandbox(developerId: string) {
  const dev = await db.query.users.findFirst({ where: eq(schema.users.id, developerId) })
  if (dev?.role !== 'developer') throw new Error('Hanya workspace developer yang dapat direset.')
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    const props = await tx.select({ id: schema.properties.id }).from(schema.properties)
      .where(and(eq(schema.properties.ownerId, developerId), eq(schema.properties.sandbox, true)))
    const ids = props.map((p) => p.id)
    const gone = { deletedAt: now, deletedBy: developerId } as never
    if (ids.length) {
      for (const t of [schema.rooms, schema.services, schema.rentals, schema.invoices, schema.payments, schema.expenses, schema.contracts]) {
        await tx.update(t).set(gone).where(and(inArray(t.propertyId, ids), isNull(t.deletedAt)))
      }
      await tx.update(schema.properties).set(gone).where(inArray(schema.properties.id, ids))
      await tx.delete(schema.waMessages).where(inArray(schema.waMessages.propertyId, ids))
      await tx.delete(schema.waSessions).where(inArray(schema.waSessions.propertyId, ids))
    }
    await tx.update(schema.tenants).set(gone).where(and(eq(schema.tenants.ownerId, developerId), isNull(schema.tenants.deletedAt)))
    // Accounts the developer made for role testing go too; the developer stays.
    await tx.update(schema.users).set(gone).where(and(eq(schema.users.ownerId, developerId), dsql`${schema.users.id} <> ${developerId}`))
    await tx.delete(schema.approvalRequests).where(eq(schema.approvalRequests.ownerId, developerId))
    await tx.delete(schema.trash).where(eq(schema.trash.ownerId, developerId))
  })
  const result = await seedDemo({ ownerId: developerId, force: true })
  bumpRev()
  return result
}

/** Development convenience: INITIAL_DEVELOPER_USERNAME creates the developer on first boot. */
export async function ensureInitialDeveloper() {
  const username = process.env.INITIAL_DEVELOPER_USERNAME
  if (!username) return
  const existing = await findUser(username)
  if (existing) {
    // Repair a sandbox left empty (e.g. a seed that failed on an older version).
    if (existing.role !== 'developer') return
    const props = await db.select({ id: schema.properties.id }).from(schema.properties)
      .where(and(eq(schema.properties.ownerId, existing.id), isNull(schema.properties.deletedAt))).limit(1)
    if (!props.length) await seedDemo({ ownerId: existing.id })
    return
  }
  const { temp } = await createDeveloper(username)
  const bar = '='.repeat(64)
  console.log(`\n${bar}\n  AKUN DEVELOPER DIBUAT (sandbox data dummy)\n  Username : ${username.toLowerCase()}\n  Password : ${temp}\n${bar}\n`)
  log.info('Developer awal dibuat', { username })
}

import { sql } from 'drizzle-orm'
import {
  bigint, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type {
  ActiveSchemes, Address, AgreementSettings, BookingPolicy, Contact, ExpenseItem, ExpenseRecurrence, HouseRules,
  InvoiceItem, InvoicePdfSettings, LateFee, MessageTemplate, PriceSet,
} from '@shared/types'
import type { AgreementSnapshot } from '@shared/agreement'

/* Conventions
 * - Money: bigint rupiah (mode "number" — rupiah amounts stay far below 2^53).
 * - Business dates: `date` as YYYY-MM-DD strings. Instants: timestamptz.
 * - Soft delete: nothing user-facing is ever hard-deleted. A delete stamps
 *   deleted_at + a delete_batch id on the row and on everything it cascades to;
 *   restoring the batch brings the whole group back together.
 * - Optimistic locking: `version` is bumped on every update; writes carry the
 *   version they read, so two admins can't silently overwrite each other. */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })
const money = (name: string) => bigint(name, { mode: 'number' })

const audit = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}

const softDelete = {
  deletedAt: ts('deleted_at'),
  deletedBy: uuid('deleted_by'),
  deleteBatch: uuid('delete_batch'),
}

/* ------------------------------------------------------------------ users & auth */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    role: text('role', { enum: ['superadmin', 'admin', 'staff'] }).notNull(),
    allProperties: boolean('all_properties').notNull().default(true),
    propertyIds: uuid('property_ids').array().notNull().default(sql`'{}'::uuid[]`),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    ...audit,
    ...softDelete,
  },
  (t) => [uniqueIndex('users_username_uq').on(sql`lower(${t.username})`).where(sql`${t.deletedAt} is null`)],
)

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the cookie token — a DB leak does not leak live sessions. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    userAgent: text('user_agent').notNull().default(''),
    ip: text('ip').notNull().default(''),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull().default(0),
})

/* ------------------------------------------------------------------ properties */

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    phone: text('phone').notNull(),
    note: text('note').notNull().default(''),
    address: jsonb('address').$type<Address>().notNull(),
    paymentMethods: jsonb('payment_methods').$type<{ cash: boolean; transfer: boolean }>().notNull(),
    paymentInfo: text('payment_info').notNull().default(''),
    lateFee: jsonb('late_fee').$type<LateFee>().notNull(),
    booking: jsonb('booking').$type<BookingPolicy>().notNull(),
    invoicePdf: jsonb('invoice_pdf').$type<InvoicePdfSettings>().notNull(),
    templates: jsonb('templates').$type<{ whatsapp: MessageTemplate[] }>().notNull(),
    rules: jsonb('rules').$type<HouseRules>().notNull(),
    agreement: jsonb('agreement').$type<AgreementSettings>().notNull(),
    ...audit,
    ...softDelete,
  },
  // One property ↔ one WhatsApp number: two live properties can never share it.
  (t) => [uniqueIndex('properties_phone_uq').on(t.phone).where(sql`${t.deletedAt} is null`)],
)

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    name: text('name').notNull(),
    price: jsonb('price').$type<PriceSet>().notNull(),
    schemes: jsonb('schemes').$type<ActiveSchemes>().notNull(),
    condition: text('condition', { enum: ['bersih', 'kotor', 'rusak'] }).notNull().default('bersih'),
    note: text('note').notNull().default(''),
    ...audit,
    ...softDelete,
  },
  (t) => [index('rooms_property_idx').on(t.propertyId)],
)

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    name: text('name').notNull(),
    price: jsonb('price').$type<PriceSet>().notNull(),
    ...audit,
    ...softDelete,
  },
  (t) => [index('services_property_idx').on(t.propertyId)],
)

/* ------------------------------------------------------------------ tenants & rentals */

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    idNumber: text('id_number').notNull().default(''),
    gender: text('gender').notNull().default(''),
    dob: date('dob', { mode: 'string' }),
    maritalStatus: text('marital_status').notNull().default(''),
    emergencyContact: text('emergency_contact').notNull().default(''),
    job: text('job').notNull().default(''),
    vehiclePlate: text('vehicle_plate').notNull().default(''),
    checkInNote: text('check_in_note').notNull().default(''),
    checkOutNote: text('check_out_note').notNull().default(''),
    avatarColor: text('avatar_color').notNull().default('bg-indigo-500'),
    phone: text('phone').notNull().default(''),
    contacts: jsonb('contacts').$type<Contact[]>().notNull().default([]),
    isWaitlist: boolean('is_waitlist').notNull().default(false),
    waitlistPropertyId: uuid('waitlist_property_id').references(() => properties.id),
    ...audit,
    ...softDelete,
  },
  (t) => [index('tenants_phone_idx').on(t.phone)],
)

export const rentals = pgTable(
  'rentals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    roomId: uuid('room_id').notNull().references(() => rooms.id),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    rentType: text('rent_type', { enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'] }).notNull(),
    price: money('price').notNull(),
    billingDay: integer('billing_day').notNull(),
    depositAmount: money('deposit_amount').notNull().default(0),
    dpAmount: money('dp_amount').notNull().default(0),
    serviceIds: jsonb('service_ids').$type<string[]>().notNull().default([]),
    status: text('status', { enum: ['booked', 'active', 'ended', 'lapsed', 'canceled'] }).notNull(),
    paymentDeadline: date('payment_deadline', { mode: 'string' }),
    lapseResolution: text('lapse_resolution', { enum: ['pending', 'forfeit', 'refund'] }),
    activatedAt: ts('activated_at'),
    endedAt: ts('ended_at'),
    endNote: text('end_note').notNull().default(''),
    createdBy: uuid('created_by'),
    ...audit,
    ...softDelete,
  },
  // The no-double-booking EXCLUDE constraint lives in the custom migration
  // (drizzle cannot express it): drizzle/0001_constraints.sql.
  (t) => [
    index('rentals_room_idx').on(t.roomId),
    index('rentals_tenant_idx').on(t.tenantId),
    index('rentals_property_status_idx').on(t.propertyId, t.status),
  ],
)

/* ------------------------------------------------------------------ billing */

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    rentalId: uuid('rental_id').notNull().references(() => rentals.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    roomId: uuid('room_id').notNull().references(() => rooms.id),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    sentAt: ts('sent_at'),
    items: jsonb('items').$type<InvoiceItem[]>().notNull(),
    subtotal: money('subtotal').notNull(),
    lateFee: money('late_fee').notNull().default(0),
    total: money('total').notNull(),
    paidAmount: money('paid_amount').notNull().default(0),
    status: text('status', { enum: ['terjadwal', 'belum_dibayar', 'sebagian', 'lunas', 'batal'] }).notNull(),
    isFirst: boolean('is_first').notNull().default(false),
    note: text('note').notNull().default(''),
    ...audit,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('invoices_number_uq').on(t.number),
    // Deliberately NOT partial on deleted_at: an invoice an admin deleted must
    // stay "taken", or the nightly job would quietly re-issue it.
    uniqueIndex('invoices_rental_period_uq').on(t.rentalId, t.periodStart),
    index('invoices_property_due_idx').on(t.propertyId, t.dueDate),
  ],
)

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: text('transaction_id').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    rentalId: uuid('rental_id').references(() => rentals.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    date: date('date', { mode: 'string' }).notNull(),
    method: text('method', { enum: ['cash', 'transfer'] }).notNull(),
    amount: money('amount').notNull(),
    kind: text('kind', { enum: ['rent', 'deposit', 'dp', 'other'] }).notNull(),
    category: text('category'),
    note: text('note').notNull().default(''),
    attachmentFileId: uuid('attachment_file_id'),
    createdBy: uuid('created_by'),
    ...audit,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('payments_trx_uq').on(t.transactionId),
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_rental_idx').on(t.rentalId),
    index('payments_property_date_idx').on(t.propertyId, t.date),
  ],
)

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    roomId: uuid('room_id').references(() => rooms.id),
    category: text('category').notNull(),
    name: text('name').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    items: jsonb('items').$type<ExpenseItem[]>().notNull(),
    total: money('total').notNull(),
    note: text('note').notNull().default(''),
    attachmentFileId: uuid('attachment_file_id'),
    recurring: boolean('recurring').notNull().default(false),
    recurrence: text('recurrence', { enum: ['weekly', 'monthly', 'yearly'] }).$type<ExpenseRecurrence>(),
    recurrenceEndDate: date('recurrence_end_date', { mode: 'string' }),
    recurrenceParentId: uuid('recurrence_parent_id').references((): AnyPgColumn => expenses.id),
    createdBy: uuid('created_by'),
    ...audit,
    ...softDelete,
  },
  (t) => [
    index('expenses_property_date_idx').on(t.propertyId, t.date),
    uniqueIndex('expenses_recurrence_instance_uq').on(t.recurrenceParentId, t.date),
  ],
)

/* ------------------------------------------------------------------ files & contracts */

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: text('owner_type', { enum: ['tenant', 'payment', 'expense', 'contract', 'property', 'invoice'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    kind: text('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: uuid('uploaded_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    ...softDelete,
  },
  (t) => [index('files_owner_idx').on(t.ownerType, t.ownerId)],
)

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    rentalId: uuid('rental_id').notNull().references(() => rentals.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    status: text('status', { enum: ['draft', 'sent', 'viewed', 'signed', 'void'] }).notNull(),
    /** sha256 of the signing-link token. The raw token only ever exists in the link. */
    tokenHash: text('token_hash'),
    tokenExpiresAt: ts('token_expires_at'),
    snapshot: jsonb('snapshot').$type<AgreementSnapshot>().notNull(),
    pdfFileId: uuid('pdf_file_id'),
    signedPdfFileId: uuid('signed_pdf_file_id'),
    signatureFileId: uuid('signature_file_id'),
    /** sha256 of the unsigned PDF — printed on the signing certificate. */
    docHash: text('doc_hash'),
    signedName: text('signed_name'),
    signedAt: ts('signed_at'),
    signedIp: text('signed_ip'),
    signedUserAgent: text('signed_user_agent'),
    sentAt: ts('sent_at'),
    viewedAt: ts('viewed_at'),
    voidedAt: ts('voided_at'),
    createdBy: uuid('created_by'),
    ...audit,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('contracts_number_uq').on(t.number),
    uniqueIndex('contracts_token_uq').on(t.tokenHash),
    index('contracts_rental_idx').on(t.rentalId),
  ],
)

/* ------------------------------------------------------------------ WhatsApp */

export const waSessions = pgTable('wa_sessions', {
  propertyId: uuid('property_id').primaryKey().references(() => properties.id),
  status: text('status', { enum: ['disconnected', 'connecting', 'qr', 'connected', 'mismatch'] }).notNull(),
  phone: text('phone'),
  lastError: text('last_error'),
  connectedAt: ts('connected_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

/** Baileys auth state (creds + signal keys) — kept in Postgres so backups include it. */
export const waAuth = pgTable(
  'wa_auth',
  {
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.key] })],
)

export const waMessages = pgTable(
  'wa_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    phone: text('phone').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    type: text('type', { enum: ['text', 'document', 'image'] }).notNull(),
    body: text('body').notNull().default(''),
    fileId: uuid('file_id'),
    fileName: text('file_name'),
    status: text('status', {
      enum: ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'received'],
    }).notNull(),
    waMessageId: text('wa_message_id'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    /** Idempotency key for automated messages, e.g. `reminder:<invoice>:before`. */
    dedupeKey: text('dedupe_key'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
    readAt: ts('read_at'),
  },
  (t) => [
    uniqueIndex('wa_messages_dedupe_uq').on(t.dedupeKey),
    index('wa_messages_thread_idx').on(t.propertyId, t.phone, t.createdAt),
    index('wa_messages_status_idx').on(t.status),
  ],
)

/* ------------------------------------------------------------------ notifications */

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    severity: text('severity', { enum: ['info', 'success', 'warning', 'danger'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    propertyId: uuid('property_id'),
    /** `all` = everyone with access to the property; `superadmin` = system alerts. */
    audience: text('audience', { enum: ['all', 'superadmin'] }).notNull().default('all'),
    /** Set → only this user sees it (e.g. "your request was approved"). */
    userId: uuid('user_id'),
    /** Makes scheduled notifications idempotent (one "due today" per invoice per day). */
    dedupeKey: text('dedupe_key'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notifications_dedupe_uq').on(t.dedupeKey), index('notifications_created_idx').on(t.createdAt)],
)

export const notificationReads = pgTable(
  'notification_reads',
  {
    notificationId: uuid('notification_id').notNull().references(() => notifications.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    readAt: ts('read_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
)

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/* ------------------------------------------------------------------ audit, trash, jobs */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    username: text('username').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    propertyId: uuid('property_id'),
    summary: text('summary').notNull(),
    meta: jsonb('meta'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_entity_idx').on(t.entityType, t.entityId)],
)

/** One row per delete operation; its id is the delete_batch stamped on every affected row. */
export const trash = pgTable(
  'trash',
  {
    id: uuid('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    label: text('label').notNull(),
    propertyId: uuid('property_id'),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    deletedBy: uuid('deleted_by'),
    deletedByName: text('deleted_by_name').notNull(),
    deletedAt: ts('deleted_at').notNull().defaultNow(),
    restoredAt: ts('restored_at'),
    restoredBy: uuid('restored_by'),
  },
  (t) => [index('trash_deleted_idx').on(t.deletedAt)],
)

/**
 * Four-eyes control: deletes and changes to money/legal attributes made by an
 * admin wait here until a superadmin approves (the change is then applied by the
 * server) or rejects it.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** delete | property.update | room.update | invoice.update | invoice.void */
    kind: text('kind').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    propertyId: uuid('property_id'),
    label: text('label').notNull(),
    /** What will be applied (the patch, or delete options). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** The requested fields' values when the request was made — to detect conflicting edits. */
    before: jsonb('before').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason').notNull().default(''),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'canceled', 'failed'] }).notNull().default('pending'),
    requestedBy: uuid('requested_by').notNull(),
    requestedByName: text('requested_by_name').notNull(),
    reviewedBy: uuid('reviewed_by'),
    reviewedByName: text('reviewed_by_name'),
    reviewNote: text('review_note'),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    reviewedAt: ts('reviewed_at'),
  },
  (t) => [
    uniqueIndex('approval_requests_pending_uq').on(t.kind, t.entityId).where(sql`status = 'pending'`),
    index('approval_requests_status_idx').on(t.status, t.createdAt),
  ],
)

export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: text('status', { enum: ['running', 'ok', 'error'] }).notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    result: jsonb('result'),
    error: text('error'),
  },
  (t) => [index('job_runs_started_idx').on(t.startedAt)],
)

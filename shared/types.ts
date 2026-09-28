/* Domain types shared by the web app and the API.
 * Money is integer rupiah. Business dates are `YYYY-MM-DD`; instants are ISO timestamps. */

export type ID = string

/** developer: superadmin features inside an isolated sandbox with dummy data (for maintenance). */
export type Role = 'superadmin' | 'admin' | 'staff' | 'developer'
export type RentType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
export type RoomCondition = 'bersih' | 'kotor' | 'rusak'

/** What a room is doing *today*, derived from its rentals and their invoices. */
export type RoomStatus =
  | 'tersedia' // free
  | 'dipesan_dp' // held by a down payment, not yet fully paid — temporarily unavailable
  | 'dipesan' // fully paid, move-in date still in the future
  | 'disewa' // occupied, account in good standing
  | 'menunggak' // occupied, has an overdue unpaid invoice
  | 'akan_tersedia' // occupied, lease ends within 30 days

/**
 * booked   — reserved with (or awaiting) a down payment; first invoice not fully paid yet.
 * active   — first invoice fully paid (or an existing tenant imported as-is).
 * ended    — checked out.
 * lapsed   — booking not paid off by its deadline; the room was released automatically.
 * canceled — booking cancelled by an admin.
 */
export type RentalStatus = 'booked' | 'active' | 'ended' | 'lapsed' | 'canceled'
export type InvoiceStatus = 'terjadwal' | 'belum_dibayar' | 'sebagian' | 'lunas' | 'batal'
export type PaymentMethod = 'cash' | 'transfer'
export type PaymentKind = 'rent' | 'deposit' | 'dp' | 'other'
export type TenantStatus = 'berjalan' | 'akan_berakhir' | 'dipesan' | 'belum_sewa' | 'berakhir' | 'gagal_bayar'

export interface Address {
  street: string
  postcode: string
  province: string
  city: string
  district: string
  subdistrict: string
  lat: number
  lng: number
}

export interface PriceSet {
  daily: number
  weekly: number
  monthly: number
  yearly: number
}

export interface ActiveSchemes {
  daily: boolean
  weekly: boolean
  monthly: boolean
  yearly: boolean
}

export interface LateFee {
  enabled: boolean
  type: 'fixed' | 'percent'
  value: number
  graceDays: number
  frequency: 'once' | 'daily'
}

/** How down-payment bookings behave for a property. */
export interface BookingPolicy {
  /** Default days a DP holds a room before the balance is due. */
  dpHoldDays: number
  /** Extra days after the deadline before the room is released automatically. */
  graceDays: number
  /** What happens to the DP when a booking lapses. */
  lapsePolicy: 'forfeit' | 'manual'
}

export interface InvoicePdfSettings {
  language: 'id' | 'en'
  customLogo: boolean
  logoSize: number
  font: string
  fontSize: number
  textColor: string
  labelColor: string
  note: string
}

export interface MessageTemplate {
  id: string
  label: string
  body: string
  isDefault: boolean
}

export type RuleGroupKey =
  | 'accessHours' | 'tenantCriteria' | 'generalPolicy' | 'paymentPolicy' | 'guestPolicy' | 'requiredDocs'

/** Tata tertib — picked from presets plus free-form lines. */
export interface HouseRules {
  groups: Record<RuleGroupKey, string[]>
  custom: string[]
}

/** Perjanjian sewa settings. The template is merged with the house rules into one PDF. */
export interface AgreementSettings {
  template: string
  ownerName: string
  ownerTitle: string
  /** File id of the owner's signature image, stamped on every contract. */
  ownerSignatureFileId: string | null
  /** Days the tenant's signing link stays valid. */
  linkExpiryDays: number
  /** Send the contract over WhatsApp automatically when a booking is created. */
  autoSend: boolean
}

export interface Property {
  id: ID
  name: string
  /** Short prefix for invoice numbers, e.g. "MLT". */
  code: string
  /** The property's single WhatsApp number (E.164 digits). The QR scan must match it. */
  phone: string
  note: string
  address: Address
  paymentMethods: { cash: boolean; transfer: boolean }
  /** Bank account / transfer instructions shown on invoices and messages. */
  paymentInfo: string
  lateFee: LateFee
  booking: BookingPolicy
  invoicePdf: InvoicePdfSettings
  templates: { whatsapp: MessageTemplate[] }
  rules: HouseRules
  agreement: AgreementSettings
  createdAt: string
  version: number
}

export interface Service {
  id: ID
  propertyId: ID
  name: string
  price: PriceSet
  version: number
}

export interface Room {
  id: ID
  propertyId: ID
  name: string
  price: PriceSet
  schemes: ActiveSchemes
  condition: RoomCondition
  note: string
  createdAt: string
  version: number
}

export interface Contact {
  id: ID
  name: string
  email: string
  phone: string
}

export interface Tenant {
  id: ID
  name: string
  idNumber: string
  gender: 'male' | 'female' | ''
  dob: string
  maritalStatus: 'single' | 'married' | 'divorced' | 'widowed' | ''
  emergencyContact: string
  job: string
  vehiclePlate: string
  checkInNote: string
  checkOutNote: string
  avatarColor: string
  /** Primary WhatsApp number (E.164 digits), mirrored from contacts[0]. */
  phone: string
  contacts: Contact[]
  isWaitlist: boolean
  waitlistPropertyId: ID | null
  createdAt: string
  version: number
}

export interface Rental {
  id: ID
  tenantId: ID
  roomId: ID
  propertyId: ID
  startDate: string
  endDate: string | null
  rentType: RentType
  price: number
  billingDay: number
  /** `paid` is derived by the server from recorded payments. */
  deposit: { amount: number; paid: boolean }
  downPayment: { amount: number; paid: boolean }
  serviceIds: ID[]
  status: RentalStatus
  /** For `booked`: the date the balance must be paid by, or the room is released. */
  paymentDeadline: string | null
  /** For `lapsed`: what happened to the DP. */
  lapseResolution: 'pending' | 'forfeit' | 'refund' | null
  createdAt: string
  version: number
}

export interface InvoiceItem {
  name: string
  amount: number
}

export interface Invoice {
  id: ID
  number: string
  rentalId: ID
  tenantId: ID
  roomId: ID
  propertyId: ID
  periodStart: string
  periodEnd: string
  dueDate: string
  sentDate: string | null
  items: InvoiceItem[]
  subtotal: number
  lateFee: number
  total: number
  paidAmount: number
  status: InvoiceStatus
  isFirst: boolean
  createdAt: string
  version: number
}

export interface Payment {
  id: ID
  transactionId: string
  invoiceId: ID | null
  rentalId: ID | null
  tenantId: ID
  propertyId: ID
  date: string
  method: PaymentMethod
  /** Signed: refunds and reversals are negative. */
  amount: number
  note: string
  /** File id of the transfer proof, if any. */
  attachment: string | null
  kind: PaymentKind
  /** Ledger account override, e.g. "DP Hangus". */
  category: string | null
  createdByName: string
  createdAt: string
  version: number
}

export interface ExpenseItem {
  name: string
  amount: number
}

export type ExpenseRecurrence = 'weekly' | 'monthly' | 'yearly'

export interface Expense {
  id: ID
  propertyId: ID
  roomId: ID | null
  category: string
  name: string
  date: string
  items: ExpenseItem[]
  total: number
  note: string
  attachment: string | null
  recurring: boolean
  recurrence: ExpenseRecurrence | null
  recurrenceEndDate: string | null
  /** Set on transactions created automatically from a recurring template. */
  recurrenceParentId: ID | null
  createdAt: string
  version: number
}

export interface User {
  id: ID
  username: string
  name: string
  phone: string
  role: Role
  allProperties: boolean
  propertyIds: ID[]
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  version: number
}

export type FileOwnerType = 'tenant' | 'payment' | 'expense' | 'contract' | 'property' | 'invoice'
export type FileKind =
  | 'ktp' | 'kk' | 'foto' | 'kontrak' | 'bukti_bayar' | 'nota' | 'ttd' | 'lainnya' | 'faktur' | 'wa_media'

export interface FileMeta {
  id: ID
  ownerType: FileOwnerType
  ownerId: ID
  kind: FileKind
  originalName: string
  mime: string
  size: number
  uploadedByName: string
  createdAt: string
}

export type ContractStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'void'

export interface Contract {
  id: ID
  number: string
  rentalId: ID
  tenantId: ID
  propertyId: ID
  status: ContractStatus
  pdfFileId: ID | null
  signedPdfFileId: ID | null
  sentAt: string | null
  viewedAt: string | null
  signedAt: string | null
  signedName: string | null
  tokenExpiresAt: string | null
  createdAt: string
}

export type WaConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'mismatch'

export interface WaSession {
  propertyId: ID
  status: WaConnectionStatus
  /** Number of the device actually linked. */
  phone: string | null
  /** Number configured on the property — the only one allowed to link. */
  expectedPhone: string
  lastError: string | null
  qr: string | null
  driver: 'baileys' | 'mock'
}

export interface WaMessage {
  id: ID
  propertyId: ID
  tenantId: ID | null
  phone: string
  direction: 'in' | 'out'
  type: 'text' | 'document' | 'image'
  body: string
  fileId: ID | null
  fileName: string | null
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'
  error: string | null
  createdAt: string
  readAt: string | null
  createdByName: string | null
}

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger'

export interface AppNotification {
  id: ID
  type: string
  severity: NotificationSeverity
  title: string
  body: string
  link: string | null
  propertyId: ID | null
  createdAt: string
  read: boolean
}

export interface ReminderStage {
  enabled: boolean
  days: number
}

/** Automated WhatsApp messages to tenants. */
export interface NotificationSettings {
  birthdayGreeting: boolean
  billingReminder: {
    enabled: boolean
    beforeDue: ReminderStage
    onDue: { enabled: boolean }
    first: ReminderStage
    second: ReminderStage
    last: ReminderStage
  }
  /** Send the WhatsApp receipt automatically when a payment is recorded. */
  paymentReceipt: boolean
  /** Hour (0-23, app timezone) when the daily reminders go out. */
  sendHour: number
}

export interface AppSettings {
  notifications: NotificationSettings
  requireIdNumber: boolean
}

export interface TrashItem {
  id: ID
  entityType: string
  entityId: ID
  label: string
  propertyId: ID | null
  deletedByName: string
  deletedAt: string
  counts: Record<string, number>
}

export interface AuditEntry {
  id: ID
  username: string
  action: string
  entityType: string
  entityId: ID | null
  summary: string
  ip: string | null
  createdAt: string
}

export interface JobRun {
  id: ID
  name: string
  status: 'running' | 'ok' | 'error'
  startedAt: string
  finishedAt: string | null
  result: Record<string, unknown> | null
  error: string | null
}

/** Names of soft-deleted rows so history (invoices, payments) can still label them. */
export interface DeletedNames {
  properties: Record<ID, string>
  rooms: Record<ID, string>
  tenants: Record<ID, string>
}

export interface Me {
  id: ID
  username: string
  name: string
  role: Role
  allProperties: boolean
  /** Properties this account can access (resolved server-side, own workspace only). */
  propertyIds: ID[]
  /** Workspace owner (the superadmin whose data this is). */
  ownerId: ID
  /** Developer sandbox: dummy data, WhatsApp simulated. */
  sandbox: boolean
  mustChangePassword: boolean
}

/* ---------------- Approvals (four-eyes control) ---------------- */

export type ApprovalKind = 'delete' | 'property.update' | 'room.update' | 'invoice.update' | 'invoice.void'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'canceled' | 'failed'

/** One human-readable line of "what would change". */
export interface ApprovalChange {
  field: string
  label: string
  before: string
  after: string
  /** Images to compare (e.g. the landlord's signature). */
  fileIds?: { before: ID | null; after: ID | null }
}

export interface ApprovalRequest {
  id: ID
  kind: ApprovalKind
  entityType: string
  entityId: ID
  propertyId: ID | null
  label: string
  reason: string
  status: ApprovalStatus
  /** Field keys the request touches (for "pending" markers in the UI). */
  fields: string[]
  changes: ApprovalChange[]
  requestedById: ID
  requestedByName: string
  reviewedByName: string | null
  reviewNote: string | null
  error: string | null
  createdAt: string
  reviewedAt: string | null
}

/** Returned (HTTP 202) instead of the entity when a change waits for a superadmin. */
export interface PendingApproval {
  pendingApproval: true
  request: ApprovalRequest
  /** Part of the change that did not need approval and was applied right away (e.g. the property). */
  applied?: unknown
}

/** Everything the web app keeps in memory. Small by design: 1–3 properties. */
export interface Bootstrap {
  me: Me
  today: string
  timezone: string
  rev: number
  properties: Property[]
  rooms: Room[]
  services: Service[]
  tenants: Tenant[]
  rentals: Rental[]
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  contracts: Contract[]
  users: User[]
  settings: AppSettings
  deletedNames: DeletedNames
  /** Pending approval requests the user can see (superadmin: all; others: their properties). */
  approvals: ApprovalRequest[]
}

export interface Toast {
  id: ID
  title: string
  description?: string
  variant: 'success' | 'error' | 'info' | 'warning'
}

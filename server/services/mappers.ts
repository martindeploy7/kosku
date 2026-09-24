import type {
  Contract, Expense, FileMeta, Invoice, Payment, Property, Rental, Room, Service, Tenant, User,
} from '@shared/types'
import { iso, schema } from '../db/client'

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect']

export const toProperty = (p: Row<typeof schema.properties>): Property => ({
  id: p.id,
  name: p.name,
  code: p.code,
  phone: p.phone,
  note: p.note,
  address: p.address,
  paymentMethods: p.paymentMethods,
  paymentInfo: p.paymentInfo,
  lateFee: p.lateFee,
  booking: p.booking,
  invoicePdf: p.invoicePdf,
  templates: p.templates,
  rules: p.rules,
  agreement: p.agreement,
  createdAt: iso(p.createdAt)!,
  version: p.version,
})

export const toRoom = (r: Row<typeof schema.rooms>): Room => ({
  id: r.id,
  propertyId: r.propertyId,
  name: r.name,
  price: r.price,
  schemes: r.schemes,
  condition: r.condition,
  note: r.note,
  createdAt: iso(r.createdAt)!,
  version: r.version,
})

export const toService = (s: Row<typeof schema.services>): Service => ({
  id: s.id,
  propertyId: s.propertyId,
  name: s.name,
  price: s.price,
  version: s.version,
})

export const toTenant = (t: Row<typeof schema.tenants>): Tenant => ({
  id: t.id,
  name: t.name,
  idNumber: t.idNumber,
  gender: t.gender as Tenant['gender'],
  dob: t.dob ?? '',
  maritalStatus: t.maritalStatus as Tenant['maritalStatus'],
  emergencyContact: t.emergencyContact,
  job: t.job,
  vehiclePlate: t.vehiclePlate,
  checkInNote: t.checkInNote,
  checkOutNote: t.checkOutNote,
  avatarColor: t.avatarColor,
  phone: t.phone,
  contacts: t.contacts,
  isWaitlist: t.isWaitlist,
  waitlistPropertyId: t.waitlistPropertyId,
  createdAt: iso(t.createdAt)!,
  version: t.version,
})

/** `paid` flags are derived from recorded deposit / DP payments. */
export const toRental = (
  r: Row<typeof schema.rentals>,
  received: { deposit: number; dp: number } = { deposit: 0, dp: 0 },
): Rental => ({
  id: r.id,
  tenantId: r.tenantId,
  roomId: r.roomId,
  propertyId: r.propertyId,
  startDate: r.startDate,
  endDate: r.endDate,
  rentType: r.rentType,
  price: r.price,
  billingDay: r.billingDay,
  deposit: { amount: r.depositAmount, paid: r.depositAmount > 0 && received.deposit >= r.depositAmount },
  downPayment: { amount: r.dpAmount, paid: r.dpAmount > 0 && received.dp >= r.dpAmount },
  serviceIds: r.serviceIds,
  status: r.status,
  paymentDeadline: r.paymentDeadline,
  lapseResolution: r.lapseResolution,
  createdAt: iso(r.createdAt)!,
  version: r.version,
})

export const toInvoice = (i: Row<typeof schema.invoices>): Invoice => ({
  id: i.id,
  number: i.number,
  rentalId: i.rentalId,
  tenantId: i.tenantId,
  roomId: i.roomId,
  propertyId: i.propertyId,
  periodStart: i.periodStart,
  periodEnd: i.periodEnd,
  dueDate: i.dueDate,
  sentDate: i.sentAt ? iso(i.sentAt)!.slice(0, 10) : null,
  items: i.items,
  subtotal: i.subtotal,
  lateFee: i.lateFee,
  total: i.total,
  paidAmount: i.paidAmount,
  status: i.status,
  isFirst: i.isFirst,
  createdAt: iso(i.createdAt)!,
  version: i.version,
})

export const toPayment = (p: Row<typeof schema.payments>, names: Map<string, string>): Payment => ({
  id: p.id,
  transactionId: p.transactionId,
  invoiceId: p.invoiceId,
  rentalId: p.rentalId,
  tenantId: p.tenantId,
  propertyId: p.propertyId,
  date: p.date,
  method: p.method,
  amount: p.amount,
  note: p.note,
  attachment: p.attachmentFileId,
  kind: p.kind,
  category: p.category,
  createdByName: (p.createdBy && names.get(p.createdBy)) || 'Sistem',
  createdAt: iso(p.createdAt)!,
  version: p.version,
})

export const toExpense = (e: Row<typeof schema.expenses>): Expense => ({
  id: e.id,
  propertyId: e.propertyId,
  roomId: e.roomId,
  category: e.category,
  name: e.name,
  date: e.date,
  items: e.items,
  total: e.total,
  note: e.note,
  attachment: e.attachmentFileId,
  recurring: e.recurring,
  createdAt: iso(e.createdAt)!,
  version: e.version,
})

export const toUser = (u: Row<typeof schema.users>): User => ({
  id: u.id,
  username: u.username,
  name: u.name,
  phone: u.phone,
  role: u.role,
  allProperties: u.allProperties,
  propertyIds: u.propertyIds,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: iso(u.lastLoginAt),
  createdAt: iso(u.createdAt)!,
  version: u.version,
})

export const toContract = (c: Row<typeof schema.contracts>): Contract => ({
  id: c.id,
  number: c.number,
  rentalId: c.rentalId,
  tenantId: c.tenantId,
  propertyId: c.propertyId,
  status: c.status,
  pdfFileId: c.pdfFileId,
  signedPdfFileId: c.signedPdfFileId,
  sentAt: iso(c.sentAt),
  viewedAt: iso(c.viewedAt),
  signedAt: iso(c.signedAt),
  signedName: c.signedName,
  tokenExpiresAt: iso(c.tokenExpiresAt),
  createdAt: iso(c.createdAt)!,
})

export const toFileMeta = (f: Row<typeof schema.files>, names: Map<string, string>): FileMeta => ({
  id: f.id,
  ownerType: f.ownerType,
  ownerId: f.ownerId,
  kind: f.kind as FileMeta['kind'],
  originalName: f.originalName,
  mime: f.mime,
  size: f.size,
  uploadedByName: (f.uploadedBy && names.get(f.uploadedBy)) || 'Sistem',
  createdAt: iso(f.createdAt)!,
})

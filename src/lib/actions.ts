import type {
  AppNotification, AppSettings, ApprovalRequest, AuditEntry, Contract, Expense, FileKind, FileMeta, FileOwnerType, ID, Invoice,
  InvoiceItem, JobRun, Payment, PaymentKind, PaymentMethod, Property, Rental, RentType, Room, Service, Tenant,
  PendingApproval, TrashItem, User, WaMessage, WaSession,
} from './types'
import { api } from './api'
import { useStore } from './store'

/* One typed function per API endpoint. Updates carry the version the admin
 * loaded (optimistic locking) — looked up from the store automatically. */

const v = (kind: Parameters<ReturnType<typeof useStore.getState>['versionOf']>[0], id: ID) =>
  useStore.getState().versionOf(kind, id)

export interface CreateRentalInput {
  tenantId: ID
  roomId: ID
  startDate: string
  endDate: string | null
  rentType: RentType
  price: number
  billingDay: number
  serviceIds: ID[]
  depositAmount: number
  depositPaid: boolean
  paymentMode: 'full' | 'dp' | 'later'
  dpAmount: number
  paymentDeadline: string | null
  method: PaymentMethod
  paymentDate?: string
  sendContract: boolean
}

export interface CreateRentalResult {
  rental: Rental
  contract: { link: string; queued: boolean } | null
  contractError: string | null
}

export type CreateExpenseInput = Omit<Expense, 'id' | 'createdAt' | 'version' | 'total' | 'recurrenceParentId'>

export interface Conversation {
  phone: string
  tenantId: ID | null
  lastBody: string
  lastAt: string
  lastDirection: 'in' | 'out'
  lastStatus: string
  unread: number
  total: number
}

export interface SessionInfo {
  id: string
  current: boolean
  userAgent: string
  ip: string
  createdAt: string
  lastSeenAt: string
}

/** A delete by a superadmin returns the trash batch; anyone else gets a pending request (HTTP 202). */
type Del = { batch: string; label: string } | PendingApproval

export { isPending as isPendingApproval } from './store'

/** Append the admin's reason to a delete URL (the superadmin sees it with the request). */
const withReason = (url: string, reason?: string) =>
  reason?.trim() ? `${url}${url.includes('?') ? '&' : '?'}reason=${encodeURIComponent(reason.trim())}` : url

export const actions = {
  /* auth */
  login: (username: string, password: string) =>
    api.post<{ user: import('./types').Me }>('/auth/login', { username, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  sessions: () => api.get<{ sessions: SessionInfo[] }>('/auth/sessions'),
  logoutOthers: () => api.post('/auth/logout-others'),

  /* properties */
  createProperty: (input: { name: string; phone: string; code?: string; address?: Property['address'] }) =>
    api.post<Property>('/properties', input),
  /** Pass `version` when editing a draft: it must be the version the draft started from. */
  updateProperty: (id: ID, patch: Partial<Omit<Property, 'id' | 'version' | 'createdAt'>>, version?: number, approvalReason?: string) =>
    api.patch<Property | PendingApproval>(`/properties/${id}`, { version: version ?? v('properties', id), ...patch, approvalReason }),
  deleteProperty: (id: ID, reason?: string) => api.del<Del>(withReason(`/properties/${id}?version=${v('properties', id)}`, reason)),

  /* rooms & services */
  addRooms: (input: Omit<Room, 'id' | 'createdAt' | 'version'> & { bulkCount?: number }) => api.post<Room[]>('/rooms', input),
  updateRoom: (id: ID, patch: Partial<Pick<Room, 'name' | 'price' | 'schemes' | 'condition' | 'note'>>, approvalReason?: string) =>
    api.patch<Room | PendingApproval>(`/rooms/${id}`, { version: v('rooms', id), ...patch, approvalReason }),
  deleteRoom: (id: ID, reason?: string) => api.del<Del>(withReason(`/rooms/${id}?version=${v('rooms', id)}`, reason)),
  addService: (input: Omit<Service, 'id' | 'version'>) => api.post<Service>('/services', input),
  deleteService: (id: ID, reason?: string) => api.del<Del>(withReason(`/services/${id}`, reason)),

  /* tenants */
  addTenant: (input: Partial<Omit<Tenant, 'id' | 'version' | 'createdAt' | 'phone'>> & Pick<Tenant, 'name' | 'contacts'>) =>
    api.post<Tenant>('/tenants', input),
  updateTenant: (id: ID, patch: Partial<Omit<Tenant, 'id' | 'version' | 'createdAt' | 'phone'>>) =>
    api.patch<Tenant>(`/tenants/${id}`, { version: v('tenants', id), ...patch }),
  deleteTenant: (id: ID, reason?: string) => api.del<Del>(withReason(`/tenants/${id}?version=${v('tenants', id)}`, reason)),

  /* rentals */
  createRental: (input: CreateRentalInput) => api.post<CreateRentalResult>('/rentals', input),
  updateRental: (id: ID, patch: { paymentDeadline?: string; endDate?: string | null; billingDay?: number }) =>
    api.patch<Rental>(`/rentals/${id}`, { version: v('rentals', id), ...patch }),
  endRental: (id: ID, input: { endDate: string; refundAmount: number; convertToIncome: boolean; note: string; checkOutNote: string }) =>
    api.post<Rental>(`/rentals/${id}/end`, { version: v('rentals', id), ...input }),
  cancelBooking: (id: ID, input: { dpAction: 'forfeit' | 'refund'; note: string }) =>
    api.post<Rental>(`/rentals/${id}/cancel`, { version: v('rentals', id), ...input }),
  resolveDp: (id: ID, action: 'forfeit' | 'refund') => api.post(`/rentals/${id}/resolve-dp`, { action }),

  /* invoices & payments */
  addInvoice: (input: { rentalId: ID; periodStart: string; periodEnd: string; dueDate: string; items: InvoiceItem[]; note?: string }) =>
    api.post<Invoice>('/invoices', input),
  updateInvoice: (id: ID, patch: { dueDate?: string; items?: InvoiceItem[]; note?: string }, approvalReason?: string) =>
    api.patch<Invoice | PendingApproval>(`/invoices/${id}`, { version: v('invoices', id), ...patch, approvalReason }),
  voidInvoice: (id: ID, approvalReason?: string) => api.post<Invoice | PendingApproval>(`/invoices/${id}/void`, { approvalReason }),
  sendInvoice: (id: ID) => api.post<{ queued: boolean; message: string }>(`/invoices/${id}/send`),
  deleteInvoice: (id: ID, reason?: string) => api.del<Del>(withReason(`/invoices/${id}`, reason)),
  addPayment: (input: {
    invoiceId: ID | null; rentalId?: ID | null; tenantId: ID; date: string; method: PaymentMethod; amount: number;
    kind?: PaymentKind; note?: string; attachment?: ID | null; sendReceipt?: boolean
  }) => api.post<Payment>('/payments', input),
  deletePayment: (id: ID, reason?: string) => api.del<Del>(withReason(`/payments/${id}`, reason)),

  /* expenses */
  addExpense: (input: CreateExpenseInput) => api.post<Expense>('/expenses', input),
  addExpensesBatch: (expenses: CreateExpenseInput[]) => api.post<Expense[]>('/expenses/batch', { expenses }),
  updateExpense: (id: ID, patch: Partial<Omit<Expense, 'id' | 'createdAt' | 'version' | 'total' | 'recurrenceParentId'>>) =>
    api.patch<Expense>(`/expenses/${id}`, { version: v('expenses', id), ...patch }),
  deleteExpense: (id: ID, reason?: string) => api.del<Del>(withReason(`/expenses/${id}?version=${v('expenses', id)}`, reason)),

  /* files & contracts */
  uploadFile: (file: File, ownerType: FileOwnerType, ownerId: ID, kind: FileKind) => {
    const f = new FormData()
    f.append('file', file)
    f.append('ownerType', ownerType)
    f.append('ownerId', ownerId)
    f.append('kind', kind)
    return api.upload<FileMeta>('/files', f)
  },
  listFiles: (ownerType: FileOwnerType, ownerId: ID) =>
    api.get<(FileMeta & { restricted: boolean })[]>(`/files?ownerType=${ownerType}&ownerId=${ownerId}`),
  deleteFile: (id: ID, reason?: string) => api.del<Del>(withReason(`/files/${id}`, reason)),
  createContract: (rentalId: ID, send: boolean) =>
    api.post<{ contract: Contract; link: string; queued: boolean }>('/contracts', { rentalId, send }),
  resendContract: (id: ID) => api.post<{ contract: Contract; link: string; queued: boolean }>(`/contracts/${id}/resend`),
  voidContract: (id: ID) => api.post<Contract>(`/contracts/${id}/void`),

  /* whatsapp */
  waStatus: (propertyId: ID) => api.get<WaSession>(`/whatsapp/${propertyId}/status`),
  waConnect: (propertyId: ID) => api.post<WaSession>(`/whatsapp/${propertyId}/connect`),
  waDisconnect: (propertyId: ID) => api.post<WaSession>(`/whatsapp/${propertyId}/disconnect`),
  waConversations: (propertyId: ID) => api.get<Conversation[]>(`/whatsapp/${propertyId}/conversations`),
  waMessages: (propertyId: ID, phone: string) => api.get<WaMessage[]>(`/whatsapp/${propertyId}/messages?phone=${phone}`),
  waSend: (propertyId: ID, phone: string, body: string, tenantId: ID | null) =>
    api.post<WaMessage>(`/whatsapp/${propertyId}/messages`, { phone, body, tenantId }),
  waRetry: (messageId: ID) => api.post(`/whatsapp/messages/${messageId}/retry`),

  /* settings & admin */
  saveSettings: (s: AppSettings) => api.put<AppSettings>('/settings', s),
  notifications: () => api.get<AppNotification[]>('/notifications'),
  markNotificationsRead: (ids: ID[] | 'all') => api.post('/notifications/read', { ids }),
  pushKey: () => api.get<{ publicKey: string | null }>('/push/key'),
  pushSubscribe: (sub: PushSubscriptionJSON) => api.post('/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => api.post('/push/unsubscribe', { endpoint }),
  pushTest: () => api.post<{ devices: number }>('/push/test'),

  createUser: (input: Pick<User, 'username' | 'name' | 'role' | 'allProperties' | 'propertyIds' | 'phone'>) =>
    api.post<{ user: User; temporaryPassword: string }>('/users', input),
  updateUser: (id: ID, patch: Partial<Pick<User, 'name' | 'role' | 'allProperties' | 'propertyIds' | 'isActive' | 'phone'>>) =>
    api.patch<User>(`/users/${id}`, { version: v('users', id), ...patch }),
  resetUserPassword: (id: ID) => api.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
  unlockUser: (id: ID) => api.post(`/users/${id}/unlock`),
  logoutUser: (id: ID) => api.post(`/users/${id}/logout`),
  deleteUser: (id: ID) => api.del<Del>(`/users/${id}`),

  /* approvals (four-eyes) */
  approvals: (status: 'pending' | 'history') => api.get<ApprovalRequest[]>(`/approvals?status=${status}`),
  approve: (id: ID, note = '') => api.post<ApprovalRequest>(`/approvals/${id}/approve`, { note }),
  reject: (id: ID, note: string) => api.post<ApprovalRequest>(`/approvals/${id}/reject`, { note }),
  cancelApproval: (id: ID) => api.post<ApprovalRequest>(`/approvals/${id}/cancel`),

  trash: () => api.get<TrashItem[]>('/trash'),
  restore: (id: ID) => api.post<{ ok: boolean; label: string }>(`/trash/${id}/restore`),
  audit: (params: { before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.before) q.set('before', params.before)
    if (params.limit) q.set('limit', String(params.limit))
    return api.get<AuditEntry[]>(`/audit?${q}`)
  },
  jobs: () => api.get<JobRun[]>('/jobs'),
  runDaily: () => api.post<Record<string, unknown>>('/jobs/daily/run'),
}

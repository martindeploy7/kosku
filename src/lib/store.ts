import * as React from 'react'
import { create } from 'zustand'
import {
  deriveRoomStatus, deriveTenantStatus, getActiveRental as sharedActiveRental,
} from '@shared/finance'
import type {
  ApprovalRequest, AppSettings, Bootstrap, Contract, DeletedNames, Expense, ID, Invoice, Me, Payment, Property, Rental, Room,
  PendingApproval, RoomStatus, Service, Tenant, TenantStatus, Toast, User, WaConnectionStatus,
} from './types'
import { api, ApiError, onAuthProblem } from './api'
import { todayISO, uid } from './utils'

/* ---------------------------------------------------------------------------
 * The store is an in-memory mirror of GET /api/bootstrap — small by design
 * (1–3 properties). The server is the source of truth: every action calls the
 * API, then re-reads. Other admins' changes arrive through a cheap /api/sync
 * poll that only triggers a refetch when the data revision moved.
 * ------------------------------------------------------------------------- */

const EMPTY_SETTINGS: AppSettings = {
  requireIdNumber: false,
  notifications: {
    birthdayGreeting: true, paymentReceipt: true, sendHour: 8,
    billingReminder: {
      enabled: true, beforeDue: { enabled: true, days: 3 }, onDue: { enabled: true },
      first: { enabled: true, days: 1 }, second: { enabled: false, days: 3 }, last: { enabled: false, days: 7 },
    },
  },
}

interface DataState {
  me: Me | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  loadError: string | null
  today: string
  rev: number
  unread: number
  waStatus: Record<ID, WaConnectionStatus>
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
  /** Pending four-eyes requests (see Approvals page). */
  approvals: ApprovalRequest[]
}

interface UiState {
  toasts: Toast[]
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
}

interface Actions {
  load: () => Promise<void>
  refresh: () => Promise<void>
  sync: () => Promise<void>
  setMe: (me: Me | null) => void
  logout: () => Promise<void>
  reset: () => void

  /**
   * Run an API call: on failure show the server's message and return undefined.
   * When the change was turned into an approval request (HTTP 202), a "waiting
   * for the superadmin" toast replaces the success message.
   */
  run: <T>(fn: () => Promise<T>, opts?: { success?: string; refresh?: boolean }) => Promise<T | undefined>
  versionOf: (kind: 'properties' | 'rooms' | 'tenants' | 'rentals' | 'invoices' | 'expenses' | 'users', id: ID) => number

  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: ID) => void
  toggleSidebar: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

export type Store = DataState & UiState & Actions

const PREFS_KEY = 'kosku-prefs'
function loadPrefs(): Partial<UiState> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}
function savePrefs(p: Pick<UiState, 'sidebarCollapsed' | 'theme'>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* private mode — preferences just won't persist */
  }
}

const prefs = loadPrefs()

const emptyData = (): DataState => ({
  me: null,
  status: 'idle',
  loadError: null,
  today: todayISO(),
  rev: 0,
  unread: 0,
  waStatus: {},
  properties: [],
  rooms: [],
  services: [],
  tenants: [],
  rentals: [],
  invoices: [],
  payments: [],
  expenses: [],
  contracts: [],
  users: [],
  settings: EMPTY_SETTINGS,
  deletedNames: { properties: {}, rooms: {}, tenants: {} },
  approvals: [],
})

let inflight: Promise<void> | null = null

export const useStore = create<Store>()((set, get) => ({
  ...emptyData(),
  toasts: [],
  sidebarCollapsed: prefs.sidebarCollapsed ?? false,
  theme: prefs.theme ?? 'light',

  load: async () => {
    if (get().status === 'loading') return inflight ?? undefined
    set({ status: get().status === 'ready' ? 'ready' : 'loading', loadError: null })
    await get().refresh()
  },

  refresh: async () => {
    // Coalesce overlapping refreshes (e.g. an action finishing while a poll fires).
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const b = await api.get<Bootstrap>('/bootstrap')
        set({ ...b, me: b.me, status: 'ready', loadError: null })
        // WhatsApp link state lives in /sync; fetch it now rather than waiting for the first poll.
        if (!Object.keys(get().waStatus).length) {
          void api.get<{ unread: number; wa: Record<string, WaConnectionStatus> }>('/sync')
            .then((s) => set({ unread: s.unread, waStatus: s.wa }))
            .catch(() => {})
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.code === 'must_change_password')) return
        set({ status: get().status === 'ready' ? 'ready' : 'error', loadError: e instanceof Error ? e.message : String(e) })
      } finally {
        inflight = null
      }
    })()
    return inflight
  },

  sync: async () => {
    if (!get().me || get().status !== 'ready') return
    try {
      const s = await api.get<{ rev: number; unread: number; wa: Record<string, WaConnectionStatus>; today: string }>('/sync')
      set({ unread: s.unread, waStatus: s.wa })
      if (s.rev !== get().rev || s.today !== get().today) await get().refresh()
    } catch {
      /* offline for a moment; the next poll retries */
    }
  },

  setMe: (me) => set({ me }),

  logout: async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      get().reset()
    }
  },

  reset: () => set({ ...emptyData() }),

  run: async (fn, opts = {}) => {
    try {
      const result = await fn()
      if (isPending(result)) {
        await get().refresh()
        get().toast({
          title: 'Menunggu persetujuan superadmin',
          description: `"${result.request.label}" sudah dikirim. Perubahan diterapkan setelah disetujui.`,
          variant: 'info',
        })
        return result
      }
      if (opts.refresh !== false) await get().refresh()
      if (opts.success) get().toast({ title: opts.success, variant: 'success' })
      return result
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : String(e))
      if (err.code === 'stale_version') {
        await get().refresh()
        get().toast({ title: 'Data sudah berubah', description: err.message, variant: 'warning' })
      } else if (err.status !== 401) {
        get().toast({ title: 'Gagal', description: err.message, variant: 'error' })
      }
      return undefined
    }
  },

  versionOf: (kind, id) => {
    const list = get()[kind] as { id: ID; version: number }[]
    return list.find((x) => x.id === id)?.version ?? 1
  },

  toast: (t) => {
    const id = uid('toast')
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.variant === 'error' ? 7000 : 4000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  toggleSidebar: () => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
    savePrefs({ sidebarCollapsed: get().sidebarCollapsed, theme: get().theme })
  },
  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
    savePrefs({ sidebarCollapsed: get().sidebarCollapsed, theme })
  },
}))

// A lost session anywhere sends the user back to the login screen.
onAuthProblem((e) => {
  const s = useStore.getState()
  if (e.status === 401) {
    s.reset()
    if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/sign/')) {
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
    }
  } else if (e.code === 'must_change_password' && !location.pathname.startsWith('/change-password')) {
    location.assign('/change-password')
  }
})

export const isPending = (x: unknown): x is PendingApproval =>
  Boolean(x && typeof x === 'object' && (x as PendingApproval).pendingApproval === true)

/* ------------------------------------------------------------------ *
 * Derived helpers (plain functions over a snapshot)
 * ------------------------------------------------------------------ */

export function getRoomStatus(roomId: ID, rentals: Rental[], invoices: Invoice[] = [], today = todayISO()): RoomStatus {
  return deriveRoomStatus(roomId, rentals, invoices, today)
}

export function getTenantStatus(tenantId: ID, rentals: Rental[], today = todayISO()): TenantStatus {
  return deriveTenantStatus(tenantId, rentals, today)
}

export const getActiveRental = sharedActiveRental

/* ------------------------------------------------------------------ *
 * Role helpers
 * ------------------------------------------------------------------ */

export const useMe = () => useStore((s) => s.me)
export const useIsSuper = () => useStore((s) => s.me?.role === 'superadmin')
export const useCanDelete = () => useStore((s) => s.me?.role === 'superadmin' || s.me?.role === 'admin')
export const useCanManage = () => useStore((s) => s.me?.role === 'superadmin' || s.me?.role === 'admin')
/** Deletes and money/legal edits by this user become requests for a superadmin. */
export const useNeedsApproval = () => useStore((s) => Boolean(s.me) && s.me?.role !== 'superadmin')

/** Pending requests touching one record (optionally one kind), for "menunggu persetujuan" markers. */
export function usePendingFor(entityId: ID | null | undefined, kind?: ApprovalRequest['kind']) {
  const approvals = useStore((s) => s.approvals)
  return React.useMemo(
    () => (entityId ? approvals.filter((a) => a.entityId === entityId && (!kind || a.kind === kind)) : []),
    [approvals, entityId, kind],
  )
}

/** Letterhead for exported reports: the property name, or all of them. */
export function companyName() {
  const names = useStore.getState().properties.map((p) => p.name)
  return names.length ? names.join(' · ') : 'Kosku'
}

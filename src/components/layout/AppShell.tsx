import * as React from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, Building2, CalendarClock, ChevronLeft, ClipboardCheck, History, KeyRound, LayoutDashboard, Loader2, LogOut, Menu,
  MessageCircle, Moon, PanelsTopLeft, PieChart, Settings, ShieldCheck, Sun, Trash2, Users, UsersRound, Wallet,
  WifiOff, X,
} from 'lucide-react'
import { Avatar, Badge, Button, Popover } from '@/components/ui'
import { Toaster } from '@/components/shared'
import { NotificationList } from '@/components/shared/NotificationList'
import { api, ApiError } from '@/lib/api'
import { ROLE_LABELS } from '@/lib/constants'
import { useStore } from '@/lib/store'
import type { Me, Role } from '@/lib/types'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles?: Role[]
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dasbor', icon: LayoutDashboard },
  { to: '/frontdesk', label: 'Frontdesk', icon: PanelsTopLeft },
  { to: '/tenants', label: 'Penyewa', icon: Users },
  { to: '/rooms', label: 'Kamar', icon: CalendarClock },
  { to: '/properties', label: 'Properti', icon: Building2 },
  { to: '/chat', label: 'WhatsApp', icon: MessageCircle },
  { to: '/expenses', label: 'Pengeluaran', icon: Wallet },
  { to: '/reports', label: 'Laporan', icon: PieChart },
  { to: '/approvals', label: 'Persetujuan', icon: ClipboardCheck },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
]

const ADMIN_NAV: NavItem[] = [
  { to: '/users', label: 'Pengguna', icon: UsersRound, roles: ['superadmin'] },
  { to: '/trash', label: 'Tempat Sampah', icon: Trash2, roles: ['superadmin'] },
  { to: '/activity', label: 'Log & Sistem', icon: History, roles: ['superadmin'] },
]

const POLL_MS = 15_000

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5 px-2 h-16 shrink-0 focus-ring rounded-md">
      <span className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center font-extrabold text-sm shrink-0">
        K
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block font-extrabold text-[15px] tracking-tight leading-none">Kosku</span>
          <span className="block text-[10px] text-muted-foreground font-medium mt-0.5">Manajemen internal</span>
        </span>
      )}
    </Link>
  )
}

function NavGroup({ items, collapsed, onNavigate, badges = {} }: {
  items: NavItem[]; collapsed: boolean; onNavigate?: () => void; badges?: Record<string, number>
}) {
  return (
    <>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-md px-3 h-10 text-sm font-semibold transition-all focus-ring',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && !collapsed && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary" />}
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!!badges[item.to] && (
                  <span
                    aria-label={`${badges[item.to]} menunggu`}
                    className={cn(
                      'h-5 min-w-5 px-1 rounded-full bg-warning text-white text-[10px] font-bold grid place-items-center',
                      collapsed ? 'absolute top-1 right-1' : 'ml-auto',
                    )}
                  >
                    {badges[item.to]}
                  </span>
                )}
              </>
            )}
          </NavLink>
        )
      })}
    </>
  )
}

function SidebarNav({ collapsed, onNavigate, me }: { collapsed: boolean; onNavigate?: () => void; me: Me }) {
  const admin = ADMIN_NAV.filter((i) => !i.roles || i.roles.includes(me.role))
  const pending = useStore((s) => s.approvals.length)
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
      <NavGroup items={NAV} collapsed={collapsed} onNavigate={onNavigate} badges={{ '/approvals': pending }} />
      {admin.length > 0 && (
        <>
          {!collapsed ? (
            <p className="px-3 pt-5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Superadmin</p>
          ) : (
            <div className="my-3 mx-3 border-t border-border" />
          )}
          <NavGroup items={admin} collapsed={collapsed} onNavigate={onNavigate} />
        </>
      )}
    </nav>
  )
}

function Topbar({ onOpenMobileNav, me }: { onOpenMobileNav: () => void; me: Me }) {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const unread = useStore((s) => s.unread)
  const logout = useStore((s) => s.logout)
  const navigate = useNavigate()
  const location = useLocation()
  const current = [...NAV, ...ADMIN_NAV, { to: '/notifications', label: 'Notifikasi', icon: Bell }]
    .find((n) => location.pathname.startsWith(n.to))

  return (
    <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md border-b border-border pt-[env(safe-area-inset-top)]">
      <div className="h-16 px-4 sm:px-6 flex items-center gap-3">
        <button onClick={onOpenMobileNav} className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted transition focus-ring" aria-label="Buka menu">
          <Menu className="h-5 w-5" />
        </button>
        <h2 className="font-extrabold text-lg tracking-tight truncate">{current?.label ?? 'Kosku'}</h2>

        <div className="ml-auto flex items-center gap-1">
          <Popover
            width="w-[min(400px,calc(100vw-1rem))]"
            trigger={({ toggle, open }) => (
              <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Notifikasi${unread ? ` (${unread} belum dibaca)` : ''}`} className={cn('relative', open && 'bg-muted')}>
                <Bell className="h-[18px] w-[18px]" />
                {unread > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-danger text-white text-[9px] font-bold grid place-items-center">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Button>
            )}
          >
            {(close) => <NotificationList compact onNavigate={close} />}
          </Popover>

          <Button variant="ghost" size="icon" aria-label="Ganti tema" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Popover
            width="w-64"
            trigger={({ toggle }) => (
              <button onClick={toggle} className="flex items-center gap-2 pl-1.5 pr-2 h-9 rounded-md hover:bg-muted transition focus-ring">
                <Avatar name={me.name} size="sm" color="bg-primary" />
                <span className="hidden sm:block text-sm font-semibold truncate max-w-[140px]">{me.name}</span>
              </button>
            )}
          >
            {(close) => (
              <div>
                <div className="p-4 border-b border-border">
                  <p className="font-bold text-sm truncate">{me.name}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">@{me.username}</p>
                  <Badge tone={me.role === 'superadmin' ? 'primary' : me.role === 'admin' ? 'info' : 'muted'} className="mt-2">
                    <ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[me.role]}
                  </Badge>
                </div>
                <div className="p-1.5">
                  <Link to="/settings" onClick={close} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium hover:bg-muted transition">
                    <KeyRound className="h-4 w-4" /> Akun & keamanan
                  </Link>
                  <button
                    onClick={async () => { close(); await logout(); navigate('/login', { replace: true }) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-danger hover:bg-danger-soft transition"
                  >
                    <LogOut className="h-4 w-4" /> Keluar
                  </button>
                </div>
              </div>
            )}
          </Popover>
        </div>
      </div>
    </header>
  )
}

/** Resolves the session before rendering anything behind the login. */
function useSessionGate() {
  const me = useStore((s) => s.me)
  const status = useStore((s) => s.status)
  const setMe = useStore((s) => s.setMe)
  const load = useStore((s) => s.load)
  const [gate, setGate] = React.useState<'checking' | 'ok' | 'login' | 'change'>(me ? 'ok' : 'checking')

  React.useEffect(() => {
    if (me) {
      if (me.mustChangePassword) setGate('change')
      else {
        setGate('ok')
        if (status === 'idle') void load()
      }
      return
    }
    let alive = true
    api.get<{ user: Me }>('/auth/me')
      .then(({ user }) => {
        if (!alive) return
        setMe(user)
      })
      .catch((e) => {
        if (!alive) return
        setGate(e instanceof ApiError && e.status === 401 ? 'login' : 'login')
      })
    return () => { alive = false }
  }, [me, status, setMe, load])

  return gate
}

export default function AppShell() {
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const theme = useStore((s) => s.theme)
  const me = useStore((s) => s.me)
  const status = useStore((s) => s.status)
  const loadError = useStore((s) => s.loadError)
  const sync = useStore((s) => s.sync)
  const refresh = useStore((s) => s.refresh)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [online, setOnline] = React.useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const location = useLocation()
  const gate = useSessionGate()

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  React.useEffect(() => {
    setMobileOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  // Keep every admin's screen current: poll a cheap revision, refetch on change,
  // and catch up immediately when the tab/app comes back to the foreground.
  React.useEffect(() => {
    if (gate !== 'ok') return
    const tick = () => { if (document.visibilityState === 'visible') void sync() }
    const id = window.setInterval(tick, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void sync() }
    const onOnline = () => { setOnline(true); void refresh() }
    const onOffline = () => setOnline(false)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void sync()
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [gate, sync, refresh])

  if (gate === 'login') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (gate === 'change') return <Navigate to="/change-password" replace />
  if (gate === 'checking' || !me || status === 'idle' || status === 'loading') {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm">Memuat data…</p>
        </div>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6 text-center">
        <div className="max-w-sm">
          <WifiOff className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="font-bold mt-3">Data tidak dapat dimuat</p>
          <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
          <Button className="mt-5" onClick={() => void refresh()}>Coba lagi</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-background">
      <aside className={cn(
        'hidden lg:flex flex-col border-r border-border bg-surface transition-all duration-200 sticky top-0 h-screen shrink-0',
        collapsed ? 'w-[68px]' : 'w-[248px]',
      )}>
        <Logo collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} me={me} />
        <div className="p-2 border-t border-border">
          <button
            onClick={toggleSidebar}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 h-9 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition focus-ring',
              collapsed && 'justify-center px-0',
            )}
          >
            <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
            {!collapsed && 'Ciutkan menu'}
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px] animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-[268px] max-w-[85vw] bg-surface border-r border-border flex flex-col animate-slide-up pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between pr-2">
              <Logo collapsed={false} />
              <button onClick={() => setMobileOpen(false)} className="p-2 rounded-md hover:bg-muted transition" aria-label="Tutup menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav collapsed={false} me={me} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {!online && (
          <div className="bg-warning text-white text-[13px] font-medium px-4 py-2 text-center flex items-center justify-center gap-2">
            <WifiOff className="h-4 w-4" /> Anda sedang offline — perubahan belum bisa disimpan.
          </div>
        )}
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} me={me} />
        <main className="flex-1 px-4 sm:px-6 py-6">
          <Outlet />
        </main>
        <footer className="px-4 sm:px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-border text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Kosku · Aplikasi manajemen internal</span>
          <span>Masuk sebagai @{me.username} · {ROLE_LABELS[me.role]}</span>
        </footer>
      </div>

      <Toaster />
    </div>
  )
}

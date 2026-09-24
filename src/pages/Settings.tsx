import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  History, KeyRound, Laptop, Loader2, LogOut, Moon, Save, ShieldCheck, Smartphone, Sun, Trash2, UsersRound,
} from 'lucide-react'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Field, Input, Select, Switch,
} from '@/components/ui'
import { PageHeader, Tabs } from '@/components/shared'
import { PushToggle } from '@/components/shared/PushToggle'
import { actions, type SessionInfo } from '@/lib/actions'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/constants'
import { useCanManage, useIsSuper, useStore } from '@/lib/store'
import type { AppSettings, ReminderStage } from '@/lib/types'
import { relativeTime } from '@/lib/utils'

function deviceLabel(ua: string) {
  const os = /iphone|ipad/i.test(ua) ? 'iPhone/iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Perangkat'
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /firefox\//i.test(ua) ? 'Firefox' : /safari\//i.test(ua) ? 'Safari' : 'Browser'
  return `${browser} · ${os}`
}

function AccountTab() {
  const me = useStore((s) => s.me)!
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const run = useStore((s) => s.run)
  const navigate = useNavigate()
  const [sessions, setSessions] = React.useState<SessionInfo[] | null>(null)

  const load = React.useCallback(async () => {
    setSessions((await actions.sessions().catch(() => ({ sessions: [] }))).sessions)
  }, [])
  React.useEffect(() => { void load() }, [load])

  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start">
      <div className="space-y-6 min-w-0">
        <Card>
          <CardHeader><CardTitle>Akun</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nama"><Input value={me.name} disabled /></Field>
              <Field label="Username"><Input value={`@${me.username}`} disabled /></Field>
            </div>
            <div className="rounded-lg bg-muted/50 p-3.5 flex gap-3">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <Badge tone="primary">{ROLE_LABELS[me.role]}</Badge>
                <p className="mt-1.5 text-muted-foreground">{ROLE_DESCRIPTIONS[me.role]}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Nama, peran, dan akses properti diatur oleh superadmin.</p>
            <Button variant="outline" onClick={() => navigate('/change-password')}><KeyRound className="h-4 w-4" /> Ganti password</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tampilan</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {(['light', 'dark'] as const).map((t) => (
                <button key={t} onClick={() => setTheme(t)}
                  className={`rounded-lg border-2 p-4 flex items-center gap-2 font-semibold text-sm transition ${theme === t ? 'border-primary bg-primary-soft/60' : 'border-border hover:border-primary/40'}`}>
                  {t === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {t === 'light' ? 'Terang' : 'Gelap'}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6 min-w-0">
        <Card><CardContent className="pt-5"><PushToggle /></CardContent></Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Perangkat yang masuk</CardTitle>
            <Button variant="outline" size="sm" disabled={!sessions || sessions.length < 2}
              onClick={async () => { await run(() => actions.logoutOthers(), { refresh: false, success: 'Perangkat lain dikeluarkan' }); void load() }}>
              <LogOut className="h-3.5 w-3.5" /> Keluarkan yang lain
            </Button>
          </CardHeader>
          <CardContent>
            {sessions === null ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <ul className="divide-y divide-border">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <span className="h-9 w-9 rounded-lg bg-muted grid place-items-center shrink-0">
                      {/iphone|android|mobile/i.test(s.userAgent) ? <Smartphone className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{deviceLabel(s.userAgent)} {s.current && <Badge tone="success" className="ml-1">Perangkat ini</Badge>}</p>
                      <p className="text-xs text-muted-foreground">Aktif {relativeTime(s.lastSeenAt)} · IP {s.ip}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Stage({ label, stage, onChange, suffix }: { label: string; stage: ReminderStage; onChange: (s: ReminderStage) => void; suffix: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3.5">
      <Checkbox checked={stage.enabled} onChange={(v) => onChange({ ...stage, enabled: v })} label={label} className="flex-1 min-w-[180px]" />
      <div className="flex items-center gap-2 text-sm">
        <Input type="number" min={1} max={30} value={stage.days} disabled={!stage.enabled} className="w-20"
          onChange={(e) => onChange({ ...stage, days: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })} />
        <span className="text-muted-foreground">{suffix}</span>
      </div>
    </div>
  )
}

function AutomationTab() {
  const settings = useStore((s) => s.settings)
  const run = useStore((s) => s.run)
  const [draft, setDraft] = React.useState<AppSettings>(settings)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => setDraft(settings), [settings])

  const n = draft.notifications
  const br = n.billingReminder
  const setN = (p: Partial<AppSettings['notifications']>) => setDraft((d) => ({ ...d, notifications: { ...d.notifications, ...p } }))
  const setBr = (p: Partial<typeof br>) => setN({ billingReminder: { ...br, ...p } })
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const save = async () => {
    setSaving(true)
    await run(() => actions.saveSettings(draft), { success: 'Pengaturan otomatisasi disimpan' })
    setSaving(false)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start">
      <Card>
        <CardHeader>
          <CardTitle>Pengingat tagihan ke penyewa</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Dikirim otomatis dari WhatsApp masing-masing properti, sekali per tagihan per tahap.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Switch checked={br.enabled} onChange={(v) => setBr({ enabled: v })} label="Aktifkan pengingat otomatis" />
          {br.enabled && (
            <div className="space-y-2.5">
              <Stage label="Sebelum jatuh tempo" stage={br.beforeDue} onChange={(s) => setBr({ beforeDue: s })} suffix="hari sebelumnya" />
              <div className="rounded-lg border border-border p-3.5">
                <Checkbox checked={br.onDue.enabled} onChange={(v) => setBr({ onDue: { enabled: v } })} label="Tepat di hari jatuh tempo" />
              </div>
              <Stage label="Terlambat — pengingat 1" stage={br.first} onChange={(s) => setBr({ first: s })} suffix="hari setelahnya" />
              <Stage label="Terlambat — pengingat 2" stage={br.second} onChange={(s) => setBr({ second: s })} suffix="hari setelahnya" />
              <Stage label="Terlambat — terakhir" stage={br.last} onChange={(s) => setBr({ last: s })} suffix="hari setelahnya" />
              <p className="text-xs text-muted-foreground">Pemesanan DP mendapat satu pengingat sehari sebelum batas pelunasan.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6 min-w-0">
        <Card>
          <CardHeader><CardTitle>Pesan otomatis lainnya</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Switch checked={n.paymentReceipt} onChange={(v) => setN({ paymentReceipt: v })} label="Kuitansi pembayaran"
              description="Dikirim saat pembayaran dicatat (bisa dimatikan per pembayaran)." />
            <Switch checked={n.birthdayGreeting} onChange={(v) => setN({ birthdayGreeting: v })} label="Ucapan ulang tahun"
              description="Untuk penyewa aktif yang tanggal lahirnya terisi." />
            <Field label="Jam pengiriman pesan otomatis" hint="Zona waktu server. Pesan tidak pernah dikirim setelah pukul 21.00.">
              <Select value={String(n.sendHour)} onChange={(v) => setN({ sendHour: Number(v) })}
                options={Array.from({ length: 17 }, (_, i) => i + 5).map((h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Data penyewa</CardTitle></CardHeader>
          <CardContent>
            <Switch checked={draft.requireIdNumber} onChange={(v) => setDraft((d) => ({ ...d, requireIdNumber: v }))}
              label="Wajibkan NIK" description="Penyewa baru tidak bisa disimpan tanpa nomor identitas." />
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(settings)}>Batalkan</Button>
          <Button onClick={save} loading={saving} disabled={!dirty}><Save className="h-4 w-4" /> Simpan</Button>
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const canManage = useCanManage()
  const isSuper = useIsSuper()
  const navigate = useNavigate()
  const [tab, setTab] = React.useState(params.get('tab') === 'automation' && canManage ? 'automation' : 'account')

  React.useEffect(() => {
    setParams(tab === 'account' ? {} : { tab }, { replace: true })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Pengaturan"
        actions={isSuper ? (
          <>
            <Button variant="outline" onClick={() => navigate('/users')}><UsersRound className="h-4 w-4" /> Pengguna</Button>
            <Button variant="outline" onClick={() => navigate('/trash')}><Trash2 className="h-4 w-4" /> Tempat sampah</Button>
            <Button variant="outline" onClick={() => navigate('/activity')}><History className="h-4 w-4" /> Log & sistem</Button>
          </>
        ) : undefined}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: 'account', label: 'Akun & keamanan' },
          ...(canManage ? [{ value: 'automation', label: 'Pengingat otomatis' }] : []),
        ]}
      />
      {tab === 'account' ? <AccountTab /> : <AutomationTab />}
    </>
  )
}

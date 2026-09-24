import * as React from 'react'
import {
  AlertTriangle, CheckCircle2, Link2Off, Loader2, QrCode, ShieldAlert, Smartphone, Unplug,
} from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Field, PhoneInput } from '@/components/ui'
import { actions } from '@/lib/actions'
import { useCanManage, useStore } from '@/lib/store'
import type { Property, WaSession } from '@/lib/types'
import { formatPhoneDisplay, normalizePhone } from '@/lib/utils'

const STATUS: Record<WaSession['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' | 'info' }> = {
  connected: { label: 'Terhubung', tone: 'success' },
  qr: { label: 'Menunggu pindai QR', tone: 'info' },
  connecting: { label: 'Menghubungkan…', tone: 'info' },
  disconnected: { label: 'Tidak terhubung', tone: 'muted' },
  mismatch: { label: 'Nomor tidak cocok', tone: 'danger' },
}

/**
 * Link the property's single WhatsApp number by scanning a QR code. The
 * server only accepts the phone whose number equals the property's number;
 * anything else is unlinked immediately and reported here.
 */
export function WhatsAppPanel({ property }: { property: Property }) {
  const run = useStore((s) => s.run)
  const canManage = useCanManage()
  const [session, setSession] = React.useState<WaSession | null>(null)
  const [phone, setPhone] = React.useState(property.phone)
  const [busy, setBusy] = React.useState(false)
  const [confirmOff, setConfirmOff] = React.useState(false)

  React.useEffect(() => setPhone(property.phone), [property.phone])

  const poll = React.useCallback(async () => {
    try {
      setSession(await actions.waStatus(property.id))
    } catch {
      /* transient */
    }
  }, [property.id])

  // Poll fast while a QR is on screen, slowly otherwise.
  React.useEffect(() => {
    void poll()
    const fast = session?.status === 'qr' || session?.status === 'connecting'
    const id = window.setInterval(poll, fast ? 2000 : 10000)
    return () => window.clearInterval(id)
  }, [poll, session?.status])

  const connect = async () => {
    setBusy(true)
    const s = await run(() => actions.waConnect(property.id), { refresh: false })
    if (s) setSession(s)
    setBusy(false)
  }

  const disconnect = async () => {
    setBusy(true)
    const s = await run(() => actions.waDisconnect(property.id), { success: 'WhatsApp diputuskan' })
    if (s) setSession(s)
    setBusy(false)
  }

  const savePhone = async () => {
    setBusy(true)
    await run(() => actions.updateProperty(property.id, { phone }), { success: 'Nomor WhatsApp properti disimpan' })
    setBusy(false)
  }

  const st = session ? STATUS[session.status] : null
  const linked = session?.status === 'connected'
  const phoneChanged = normalizePhone(phone) !== normalizePhone(property.phone)
  const canEditPhone = canManage && (session?.status === 'disconnected' || session?.status === 'mismatch')

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>WhatsApp properti</CardTitle>
          {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">Nomor properti</p>
              <p className="font-bold text-lg mt-1 tabular-nums">{formatPhoneDisplay(property.phone)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Hanya nomor ini yang boleh terhubung.</p>
            </div>
            <div className={`rounded-lg border p-4 ${linked ? 'border-success/40 bg-success-soft/50' : 'border-border'}`}>
              <p className="text-xs text-muted-foreground">Perangkat tertaut</p>
              <p className="font-bold text-lg mt-1 tabular-nums">{session?.phone ? formatPhoneDisplay(session.phone) : '—'}</p>
              {linked && <p className="text-[11px] text-success mt-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sama dengan nomor properti</p>}
            </div>
          </div>

          {session?.status === 'mismatch' && session.lastError && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-4 flex gap-3">
              <ShieldAlert className="h-5 w-5 text-danger shrink-0" />
              <div className="text-sm leading-relaxed">
                <p className="font-bold text-danger">Tautan ditolak</p>
                <p className="mt-1">{session.lastError}</p>
              </div>
            </div>
          )}
          {session?.status === 'disconnected' && session.lastError && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-3.5 flex gap-2.5 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" /> {session.lastError}
            </div>
          )}

          {session?.status === 'qr' && session.qr && (
            <div className="flex flex-col sm:flex-row gap-5 items-center rounded-xl border-2 border-dashed border-primary/40 p-5">
              <img src={session.qr} alt="Kode QR WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2 shrink-0" />
              <ol className="text-sm space-y-2 list-decimal pl-5 leading-relaxed">
                <li>Buka WhatsApp di HP dengan nomor <strong>{formatPhoneDisplay(property.phone)}</strong>.</li>
                <li>Ketuk <strong>⋮ / Pengaturan → Perangkat tertaut → Tautkan perangkat</strong>.</li>
                <li>Arahkan kamera ke kode QR ini. QR diperbarui otomatis.</li>
                <li className="text-danger font-medium">HP dengan nomor lain akan ditolak dan langsung dikeluarkan.</li>
              </ol>
            </div>
          )}
          {session?.status === 'connecting' && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Menghubungkan ke WhatsApp…</p>
          )}

          {canManage && (
            <div className="flex flex-wrap gap-2">
              {linked ? (
                <Button variant="outline" onClick={() => setConfirmOff(true)} loading={busy}><Unplug className="h-4 w-4" /> Putuskan</Button>
              ) : session?.status === 'qr' || session?.status === 'connecting' ? (
                <Button variant="outline" onClick={disconnect} loading={busy}><Link2Off className="h-4 w-4" /> Batalkan</Button>
              ) : (
                <Button onClick={connect} loading={busy} disabled={phoneChanged}><QrCode className="h-4 w-4" /> Hubungkan dengan QR</Button>
              )}
            </div>
          )}
          {session?.driver === 'mock' && (
            <p className="text-xs text-muted-foreground">Mode simulasi (WA_DRIVER=mock): tidak ada pesan yang benar-benar dikirim.</p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {canManage && (
          <Card>
            <CardHeader><CardTitle>Ganti nomor</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Field label="Nomor WhatsApp properti" hint={canEditPhone ? undefined : 'Putuskan WhatsApp dulu untuk mengganti nomor.'}>
                <PhoneInput value={phone} onChange={setPhone} disabled={!canEditPhone} />
              </Field>
              <Button variant="outline" className="w-full" onClick={savePhone} disabled={!canEditPhone || !phoneChanged} loading={busy}>
                Simpan nomor
              </Button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Satu properti = satu nomor, dan satu nomor tidak bisa dipakai properti lain. Penyewa selalu menerima pesan dari nomor
                yang sama.
              </p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-5 space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p className="font-bold text-foreground flex items-center gap-1.5"><Smartphone className="h-4 w-4" /> Agar nomor tetap aman</p>
            <p>Koneksi memakai WhatsApp Web (bukan API resmi). Gunakan nomor khusus kos, bukan nomor pribadi, dan jangan kirim pesan massal ke orang yang bukan penyewa.</p>
            <p>HP harus tetap aktif dan terhubung internet minimal sekali setiap 14 hari agar tautan tidak kedaluwarsa.</p>
            <p>Pesan dikirim berurutan dengan jeda beberapa detik. Jika WhatsApp terputus, pesan menunggu di antrean dan terkirim setelah tersambung lagi.</p>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Putuskan WhatsApp?"
        confirmLabel="Putuskan"
        message="Perangkat dikeluarkan dari WhatsApp di HP. Pesan otomatis ke penyewa berhenti sampai Anda memindai QR lagi."
        onConfirm={disconnect}
      />
    </div>
  )
}

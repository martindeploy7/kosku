import * as React from 'react'
import { BellRing, Smartphone } from 'lucide-react'
import { Button, Switch } from '@/components/ui'
import { actions } from '@/lib/actions'
import { useStore } from '@/lib/store'

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone

/** Enable/disable push notifications on this device (phone or laptop). */
export function PushToggle() {
  const toast = useStore((s) => s.toast)
  const [enabled, setEnabled] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [permission, setPermission] = React.useState<NotificationPermission | 'unsupported'>(
    supported() ? Notification.permission : 'unsupported',
  )

  React.useEffect(() => {
    if (!supported()) return
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => setEnabled(Boolean(sub)))
  }, [])

  const enable = async () => {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') {
        toast({ title: 'Izin notifikasi ditolak', description: 'Aktifkan izin notifikasi untuk situs ini di pengaturan browser.', variant: 'warning' })
        return
      }
      const { publicKey } = await actions.pushKey()
      if (!publicKey) throw new Error('Server belum siap mengirim notifikasi.')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
      await actions.pushSubscribe(sub.toJSON())
      setEnabled(true)
      await actions.pushTest()
      toast({ title: 'Notifikasi aktif di perangkat ini', variant: 'success' })
    } catch (e) {
      toast({ title: 'Gagal mengaktifkan notifikasi', description: e instanceof Error ? e.message : String(e), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await actions.pushUnsubscribe(sub.endpoint)
        await sub.unsubscribe()
      }
      setEnabled(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BellRing className="h-4 w-4 text-primary" />
        <p className="font-bold text-sm">Notifikasi di perangkat ini</p>
      </div>
      {permission === 'unsupported' ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isIos() && !isStandalone()
            ? 'Di iPhone/iPad, pasang aplikasi ke Layar Utama dulu (Bagikan → Tambahkan ke Layar Utama), lalu buka dari ikon tersebut.'
            : 'Browser ini tidak mendukung notifikasi push.'}
        </p>
      ) : (
        <>
          <Switch
            checked={enabled}
            disabled={busy}
            onChange={(v) => void (v ? enable() : disable())}
            label={enabled ? 'Aktif' : 'Nonaktif'}
            description="Peringatan jatuh tempo, DP, gagal bayar, perjanjian ditandatangani, dan pesan WhatsApp masuk — muncul walau aplikasi tertutup."
          />
          {enabled && (
            <Button variant="outline" size="sm" onClick={() => void actions.pushTest()}>
              <Smartphone className="h-3.5 w-3.5" /> Kirim notifikasi uji
            </Button>
          )}
          {permission === 'denied' && (
            <p className="text-xs text-danger">Izin notifikasi diblokir. Buka pengaturan situs di browser untuk mengizinkannya.</p>
          )}
        </>
      )}
    </div>
  )
}

import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react'
import { Button, Field, Input } from '@/components/ui'
import { actions } from '@/lib/actions'
import { api, ApiError } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'

const MIN = 12

/** First login (temporary password) and voluntary changes both land here. */
export default function ChangePassword() {
  const navigate = useNavigate()
  const me = useStore((s) => s.me)
  const setMe = useStore((s) => s.setMe)
  const load = useStore((s) => s.load)
  const [checking, setChecking] = React.useState(!me)
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (me) return
    api.get<{ user: Me }>('/auth/me')
      .then(({ user }) => setMe(user))
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setChecking(false))
  }, [me, setMe, navigate])

  const rules = [
    { ok: next.length >= MIN, label: `Minimal ${MIN} karakter` },
    { ok: next.length > 0 && next !== current, label: 'Berbeda dari password saat ini' },
    { ok: next.length > 0 && next === confirm, label: 'Konfirmasi sama' },
  ]
  const valid = rules.every((r) => r.ok)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setLoading(true)
    setError(null)
    try {
      await actions.changePassword(current, next)
      const { user } = await api.get<{ user: Me }>('/auth/me')
      setMe(user)
      await load()
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengganti password.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  }

  const forced = me?.mustChangePassword

  return (
    <div className="min-h-screen grid place-items-center bg-background p-6">
      <div className="w-full max-w-md card p-6 sm:p-8">
        <span className="h-11 w-11 rounded-xl bg-primary-soft text-primary grid place-items-center">
          <KeyRound className="h-5 w-5" />
        </span>
        <h1 className="text-xl font-extrabold tracking-tight mt-4">
          {forced ? 'Buat password baru' : 'Ganti password'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          {forced
            ? `Halo ${me?.name ?? ''}, Anda masuk dengan password sementara. Buat password pribadi sebelum melanjutkan.`
            : 'Semua perangkat lain akan dikeluarkan setelah password diganti.'}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label={forced ? 'Password sementara' : 'Password saat ini'} required>
            <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Password baru" required hint="Tips: pakai kalimat pendek yang mudah Anda ingat, mis. 'kamar tiga lantai atas'.">
            <Input type="password" required value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Ulangi password baru" required>
            <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>

          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r.label} className={cn('flex items-center gap-2 text-xs', r.ok ? 'text-success' : 'text-muted-foreground')}>
                {r.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {r.label}
              </li>
            ))}
          </ul>

          {error && <p role="alert" className="text-sm text-danger font-medium bg-danger-soft rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-2">
            {!forced && <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Batal</Button>}
            <Button type="submit" size="lg" className="flex-1" loading={loading} disabled={!valid}>
              <ShieldCheck className="h-4 w-4" /> Simpan password
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

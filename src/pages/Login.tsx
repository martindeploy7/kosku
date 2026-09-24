import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, BellRing, Eye, EyeOff, FileSignature, KeyRound, ShieldCheck, Wallet } from 'lucide-react'
import { Button, Field, Input } from '@/components/ui'
import { actions } from '@/lib/actions'
import { ApiError } from '@/lib/api'
import { useStore } from '@/lib/store'

const HIGHLIGHTS = [
  { icon: BellRing, title: 'Jatuh tempo tidak terlewat', desc: 'Ringkasan "hari ini", notifikasi, dan pengingat WhatsApp otomatis ke penyewa.' },
  { icon: Wallet, title: 'DP, lunas, gagal bayar', desc: 'Kamar ditahan saat DP dan dilepas otomatis bila tidak dilunasi tepat waktu.' },
  { icon: FileSignature, title: 'Perjanjian + tata tertib', desc: 'Satu PDF dikirim via WhatsApp, dibaca, lalu ditandatangani penyewa secara elektronik.' },
]

/** Only same-app paths are allowed as a post-login destination. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/dashboard'
}

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setMe = useStore((s) => s.setMe)
  const load = useStore((s) => s.load)

  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPass, setShowPass] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { user } = await actions.login(username.trim(), password)
      setMe(user)
      if (user.mustChangePassword) {
        navigate('/change-password', { replace: true })
        return
      }
      await load()
      navigate(safeNext(params.get('next')), { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal masuk. Coba lagi.')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-primary via-indigo-600 to-violet-700 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'radial-gradient(circle at 20% 20%, white 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
        <div className="relative flex items-center gap-3">
          <span className="h-11 w-11 rounded-2xl bg-white/15 backdrop-blur grid place-items-center font-extrabold text-lg">K</span>
          <div>
            <p className="font-extrabold text-xl tracking-tight leading-none">Kosku</p>
            <p className="text-xs text-white/70 mt-1">Manajemen kos internal</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-extrabold tracking-tight leading-tight">
            Semua urusan kos, <span className="text-amber-300">satu tempat</span>.
          </h1>
          <div className="mt-8 space-y-4">
            {HIGHLIGHTS.map((h) => {
              const Icon = h.icon
              return (
                <div key={h.title} className="flex items-start gap-3">
                  <span className="h-9 w-9 rounded-xl bg-white/15 backdrop-blur grid place-items-center shrink-0">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-bold text-sm">{h.title}</p>
                    <p className="text-xs text-white/70 mt-0.5 leading-relaxed">{h.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <p className="relative text-xs text-white/60 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Akses hanya untuk pengelola yang didaftarkan superadmin.
        </p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <span className="h-10 w-10 rounded-xl bg-primary text-primary-foreground grid place-items-center font-extrabold">K</span>
            <span className="font-extrabold text-lg tracking-tight">Kosku</span>
          </div>

          <h2 className="text-2xl font-extrabold tracking-tight">Masuk</h2>
          <p className="text-sm text-muted-foreground mt-2">Gunakan username dan password dari superadmin.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Username" required>
              <Input
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>

            <Field label="Password" required htmlFor="login-password">
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded hover:bg-muted transition"
                  aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPass ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </button>
              </div>
            </Field>

            {error && (
              <p role="alert" className="text-sm text-danger font-medium bg-danger-soft rounded-md px-3 py-2">{error}</p>
            )}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Masuk {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-8 rounded-lg border border-border bg-muted/40 p-4 flex gap-3">
            <KeyRound className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Lupa password?</strong> Hubungi superadmin untuk direset. Anda akan
              menerima password sementara dan wajib menggantinya saat masuk.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

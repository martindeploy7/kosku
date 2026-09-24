import * as React from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDown, CheckCircle2, Download, FileSignature, Loader2, Lock, ScrollText,
} from 'lucide-react'
import { Button, Checkbox, Field, Input } from '@/components/ui'
import { SignaturePad, type SignaturePadHandle } from '@/components/shared/SignaturePad'
import type { AgreementBlock, AgreementSnapshot } from '@shared/agreement'
import { cn, formatDate } from '@/lib/utils'

interface PublicContract {
  number: string
  status: 'pending' | 'signed'
  snapshot: AgreementSnapshot
  signedAt: string | null
  signedName: string | null
  expiresAt: string | null
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/public/contracts/${path}`, init)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message ?? 'Terjadi kesalahan. Coba lagi.')
  return data as T
}

function Block({ b }: { b: AgreementBlock }) {
  switch (b.type) {
    case 'title':
      return <h2 className="text-lg sm:text-xl font-extrabold text-center tracking-tight uppercase">{b.text}</h2>
    case 'heading':
      return <h3 className="font-bold text-[15px] mt-6 mb-2">{b.text}</h3>
    case 'para':
      return /^nomor\s*:/i.test(b.text)
        ? <p className="text-center text-xs text-muted-foreground -mt-1 mb-4">{b.text}</p>
        : <p className="text-sm leading-relaxed sm:text-justify my-2">{b.text}</p>
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag className={cn('text-sm leading-relaxed space-y-1.5 pl-6 my-2', b.ordered ? 'list-decimal' : 'list-disc')}>
          {b.items.map((it, i) => <li key={i} className="sm:text-justify pl-1">{it}</li>)}
        </Tag>
      )
    }
  }
}

/**
 * The page a tenant opens from WhatsApp. No login: access is the unguessable
 * token in the link. The signature area stays locked until the whole document
 * — agreement and house rules — has been scrolled through.
 */
export default function SignContract() {
  const { token = '' } = useParams()
  const [data, setData] = React.useState<PublicContract | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [readAll, setReadAll] = React.useState(false)
  const [agree, setAgree] = React.useState(false)
  const [name, setName] = React.useState('')
  const [sigEmpty, setSigEmpty] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const endRef = React.useRef<HTMLDivElement>(null)
  const signRef = React.useRef<HTMLDivElement>(null)
  const padRef = React.useRef<SignaturePadHandle>(null)

  React.useEffect(() => {
    document.title = 'Perjanjian Sewa — Tanda Tangan'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    call<PublicContract>(token).then(setData).catch((e) => setError(e.message))
    return () => meta.remove()
  }, [token])

  React.useEffect(() => {
    const el = endRef.current
    if (!el || readAll) return
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setReadAll(true), { threshold: 0.9 })
    io.observe(el)
    return () => io.disconnect()
  }, [data, readAll])

  const submit = async () => {
    if (!padRef.current || padRef.current.isEmpty()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await call<{ status: 'signed'; signedAt: string; signedName: string }>(`${token}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kosku': '1' },
        body: JSON.stringify({ name, agree, signature: padRef.current.toDataURL() }),
      })
      setData((d) => (d ? { ...d, status: 'signed', signedAt: res.signedAt, signedName: res.signedName } : d))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Gagal mengirim tanda tangan.')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6 text-center">
        <div className="max-w-sm">
          <AlertTriangle className="h-10 w-10 mx-auto text-warning" />
          <h1 className="font-extrabold text-lg mt-4">Perjanjian tidak dapat dibuka</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{error}</p>
        </div>
      </div>
    )
  }
  if (!data) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  }

  const s = data.snapshot
  const signed = data.status === 'signed'
  const pdfHref = `/api/public/contracts/${token}/pdf`
  const canSign = readAll && agree && name.trim().length >= 3 && !sigEmpty && !submitting

  return (
    <div className="min-h-screen bg-background pb-[env(safe-area-inset-bottom)]">
      <header className="bg-surface border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0">
            <FileSignature className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-extrabold truncate">{s.propertyName}</p>
            <p className="text-xs text-muted-foreground truncate">Perjanjian Sewa & Tata Tertib · {s.roomName}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {signed ? (
          <div className="card p-5 border-success/30 bg-success-soft/50 flex gap-3">
            <CheckCircle2 className="h-6 w-6 text-success shrink-0" />
            <div>
              <p className="font-bold">Perjanjian telah ditandatangani</p>
              <p className="text-sm text-muted-foreground mt-1">
                Oleh {data.signedName} pada {data.signedAt ? new Date(data.signedAt).toLocaleString('id-ID') : '-'}.
                Salinan PDF juga dikirim ke WhatsApp Anda.
              </p>
              <a href={`${pdfHref}?download=1`} className="inline-flex mt-3">
                <Button size="sm"><Download className="h-4 w-4" /> Unduh salinan bertanda tangan</Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="card p-4 flex gap-3 items-start">
            <ScrollText className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm leading-relaxed">
              Halo <strong>{s.tenantName}</strong>, baca perjanjian dan tata tertib di bawah sampai selesai.
              Bagian tanda tangan akan terbuka setelah Anda menggulir sampai akhir dokumen.
              {data.expiresAt && <> Tautan berlaku sampai <strong>{formatDate(data.expiresAt.slice(0, 10), 'long')}</strong>.</>}
            </p>
          </div>
        )}

        <div className="card p-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
          {s.summary.map((row) => (
            <div key={row.label} className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{row.label}</p>
              <p className="text-sm font-semibold truncate">{row.value}</p>
            </div>
          ))}
        </div>

        <article className="card p-5 sm:p-8">
          {s.blocks.map((b, i) => <Block key={i} b={b} />)}

          <div className="mt-10 pt-6 border-t-2 border-dashed border-border">
            <h2 className="text-lg font-extrabold text-center">LAMPIRAN — TATA TERTIB</h2>
            <p className="text-center text-xs text-muted-foreground mt-1 mb-5">Bagian tidak terpisahkan dari perjanjian {data.number}</p>
            {s.rules.length === 0 && <p className="text-sm text-muted-foreground">Belum ada tata tertib khusus.</p>}
            {(() => {
              let n = 0
              return s.rules.map((sec) => (
                <section key={sec.label} className="mb-4">
                  <h3 className="font-bold text-sm mb-1.5">{sec.label}</h3>
                  <ol className="text-sm leading-relaxed space-y-1 pl-6 list-decimal" start={n + 1}>
                    {sec.items.map((it) => { n += 1; return <li key={it} className="pl-1">{it}</li> })}
                  </ol>
                </section>
              ))
            })()}
          </div>
          <div ref={endRef} className="h-2" />
        </article>

        <a href={pdfHref} target="_blank" rel="noreferrer" className="block">
          <Button variant="outline" className="w-full"><Download className="h-4 w-4" /> Buka versi PDF</Button>
        </a>

        {!signed && (
          <div ref={signRef} className={cn('card p-5 sm:p-6 space-y-4 transition', !readAll && 'opacity-60')}>
            <div className="flex items-center gap-2">
              {readAll ? <FileSignature className="h-5 w-5 text-primary" /> : <Lock className="h-5 w-5 text-muted-foreground" />}
              <h2 className="font-bold">Tanda tangan elektronik</h2>
            </div>
            {!readAll && (
              <button
                onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
                className="w-full text-sm text-muted-foreground bg-muted rounded-md py-3 flex items-center justify-center gap-2"
              >
                <ArrowDown className="h-4 w-4" /> Gulir sampai akhir dokumen untuk membuka bagian ini
              </button>
            )}
            <Checkbox
              checked={agree}
              onChange={setAgree}
              disabled={!readAll}
              label="Saya telah membaca, memahami, dan menyetujui Perjanjian Sewa beserta Tata Tertib di atas."
            />
            <Field label="Nama lengkap sesuai KTP" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!readAll}
                placeholder={s.tenantName}
                autoComplete="name"
              />
            </Field>
            <Field label="Tanda tangan" required>
              <SignaturePad ref={padRef} onChange={setSigEmpty} disabled={!readAll} />
            </Field>
            {submitError && <p role="alert" className="text-sm text-danger font-medium bg-danger-soft rounded-md px-3 py-2">{submitError}</p>}
            <Button size="lg" className="w-full" onClick={submit} disabled={!canSign} loading={submitting}>
              <FileSignature className="h-4 w-4" /> Tanda tangani perjanjian
            </Button>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Tanda tangan elektronik ini dicatat beserta waktu, alamat IP, dan perangkat Anda sebagai bukti persetujuan.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

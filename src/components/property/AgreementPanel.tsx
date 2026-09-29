import * as React from 'react'
import { Eye, Loader2, PenLine, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import {
  Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Field, Input, Modal, Switch, Textarea,
} from '@/components/ui'
import { SignaturePad, type SignaturePadHandle } from '@/components/shared/SignaturePad'
import { actions } from '@/lib/actions'
import { ApiError, fileUrl } from '@/lib/api'
import { AGREEMENT_VARIABLES, DEFAULT_AGREEMENT_TEMPLATE, RULE_GROUPS } from '@/lib/constants'
import { useStore } from '@/lib/store'
import type { AgreementSettings, BookingPolicy, HouseRules, LateFee, Property, RuleGroupKey } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Props {
  property: Property
  agreement: AgreementSettings
  rules: HouseRules
  booking: BookingPolicy
  lateFee: LateFee
  onAgreement: (a: AgreementSettings) => void
  onRules: (r: HouseRules) => void
}

function PropertyLogo({ property, fileId, onChange }: { property: Property; fileId: string | null; onChange: (id: string | null) => void }) {
  const run = useStore((s) => s.run)
  const [busy, setBusy] = React.useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    const f = await run(() => actions.uploadFile(file, 'property', property.id, 'logo'), { refresh: false })
    setBusy(false)
    if (f) onChange(f.id)
  }

  return (
    <div className="space-y-2">
      <div className="h-20 rounded-lg border border-border bg-white grid place-items-center overflow-hidden">
        {busy ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          : fileId ? <img src={fileUrl(fileId)} alt="Logo kop surat" className="max-h-16 object-contain" />
          : <span className="text-xs text-gray-400">Belum ada logo</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <label>
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-semibold cursor-pointer hover:bg-muted">
            <Upload className="h-3.5 w-3.5" /> Unggah logo
          </span>
          <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        </label>
        {fileId && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /> Hapus</Button>}
      </div>
    </div>
  )
}

function OwnerSignature({ property, fileId, onChange }: { property: Property; fileId: string | null; onChange: (id: string | null) => void }) {
  const run = useStore((s) => s.run)
  const [drawOpen, setDrawOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const pad = React.useRef<SignaturePadHandle>(null)

  const upload = async (file: File) => {
    setBusy(true)
    const f = await run(() => actions.uploadFile(file, 'property', property.id, 'ttd'), { refresh: false })
    setBusy(false)
    if (f) onChange(f.id)
  }

  const saveDrawing = async () => {
    if (!pad.current || pad.current.isEmpty()) return
    const blob = await (await fetch(pad.current.toDataURL())).blob()
    setDrawOpen(false)
    await upload(new File([blob], 'ttd-pemilik.png', { type: 'image/png' }))
  }

  return (
    <div className="space-y-2">
      <div className="h-28 rounded-lg border border-border bg-white grid place-items-center overflow-hidden">
        {busy ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          : fileId ? <img src={fileUrl(fileId)} alt="Tanda tangan pemilik" className="max-h-24 object-contain" />
          : <span className="text-xs text-gray-400">Belum ada tanda tangan</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setDrawOpen(true)}><PenLine className="h-3.5 w-3.5" /> Gambar</Button>
        <label>
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-semibold cursor-pointer hover:bg-muted">
            <Upload className="h-3.5 w-3.5" /> Unggah gambar
          </span>
          <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        </label>
        {fileId && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /> Hapus</Button>}
      </div>
      <Modal open={drawOpen} onClose={() => setDrawOpen(false)} title="Tanda tangan pemilik"
        footer={<><Button variant="ghost" onClick={() => setDrawOpen(false)}>Batal</Button><Button onClick={saveDrawing}>Pakai tanda tangan</Button></>}>
        <SignaturePad ref={pad} />
      </Modal>
    </div>
  )
}

export function AgreementPanel({ property, agreement, rules, booking, lateFee, onAgreement, onRules }: Props) {
  const toast = useStore((s) => s.toast)
  const tplRef = React.useRef<HTMLTextAreaElement>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [newRule, setNewRule] = React.useState('')

  const setA = (patch: Partial<AgreementSettings>) => onAgreement({ ...agreement, ...patch })
  const toggleRule = (key: RuleGroupKey, option: string, on: boolean) => {
    const list = rules.groups[key] ?? []
    onRules({ ...rules, groups: { ...rules.groups, [key]: on ? [...list, option] : list.filter((x) => x !== option) } })
  }

  const insertVar = (v: string) => {
    const el = tplRef.current
    const body = agreement.template
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    setA({ template: body.slice(0, start) + v + body.slice(end) })
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + v.length, start + v.length) })
  }

  const preview = async () => {
    setPreviewing(true)
    // Open the tab synchronously so pop-up blockers allow it, then fill it.
    const win = window.open('', '_blank')
    try {
      const res = await fetch(`/api/properties/${property.id}/agreement-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kosku': '1' },
        body: JSON.stringify({ agreement, rules, booking, lateFee }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => null)
        throw new ApiError(res.status, e?.error?.message ?? 'Gagal membuat pratinjau.')
      }
      const url = URL.createObjectURL(await res.blob())
      if (win) win.location.href = url
      else window.open(url, '_blank')
    } catch (e) {
      win?.close()
      toast({ title: 'Pratinjau gagal', description: e instanceof Error ? e.message : String(e), variant: 'error' })
    } finally {
      setPreviewing(false)
    }
  }

  const selectedCount = RULE_GROUPS.reduce((a, g) => a + (rules.groups[g.key]?.length ?? 0), 0) + rules.custom.length

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/25 bg-primary-soft/50 p-4 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm">Satu dokumen: perjanjian sewa + tata tertib</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Saat penyewa baru dibuat, PDF gabungan dikirim dari WhatsApp properti. Penyewa wajib membaca sampai akhir sebelum bisa
            menandatangani secara elektronik.
          </p>
        </div>
        <Button variant="outline" onClick={preview} loading={previewing}><Eye className="h-4 w-4" /> Pratinjau PDF</Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card>
          <CardHeader><CardTitle>Penanda tangan & pengiriman</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Logo kop surat" hint="Ditampilkan di bagian atas setiap halaman PDF, menggantikan nama properti polos.">
              <PropertyLogo property={property} fileId={agreement.logoFileId} onChange={(id) => setA({ logoFileId: id })} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nama pemilik / pengelola" required><Input value={agreement.ownerName} onChange={(e) => setA({ ownerName: e.target.value })} /></Field>
              <Field label="Jabatan"><Input value={agreement.ownerTitle} onChange={(e) => setA({ ownerTitle: e.target.value })} placeholder="Pemilik" /></Field>
            </div>
            <Field label="Email kontak" hint="Ditampilkan di footer setiap halaman PDF bersama alamat & telepon properti. Kosongkan jika tidak perlu.">
              <Input type="email" value={agreement.contactEmail} onChange={(e) => setA({ contactEmail: e.target.value })} placeholder="nama@contoh.com" />
            </Field>
            <Field label="Tanda tangan pemilik" hint="Dibubuhkan otomatis pada setiap perjanjian.">
              <OwnerSignature property={property} fileId={agreement.ownerSignatureFileId} onChange={(id) => setA({ ownerSignatureFileId: id })} />
            </Field>
            <Field label="Masa berlaku tautan tanda tangan (hari)">
              <Input type="number" min={1} max={60} className="w-28" value={agreement.linkExpiryDays}
                onChange={(e) => setA({ linkExpiryDays: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
            <Switch checked={agreement.autoSend} onChange={(v) => setA({ autoSend: v })} label="Kirim otomatis saat sewa/pemesanan dibuat"
              description="Bisa dimatikan per penyewa di formulir sewa." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Tata tertib</CardTitle>
            <span className="text-xs text-muted-foreground">{selectedCount} aturan</span>
          </CardHeader>
          <CardContent className="space-y-5">
            {RULE_GROUPS.map((g) => {
              const selected = rules.groups[g.key] ?? []
              const extras = selected.filter((s) => !g.options.includes(s))
              return (
                <div key={g.key}>
                  <p className="text-xs font-bold text-muted-foreground mb-2">{g.label}</p>
                  <div className="space-y-2">
                    {[...g.options, ...extras].map((opt) => (
                      <Checkbox key={opt} checked={selected.includes(opt)} onChange={(v) => toggleRule(g.key, opt, v)} label={opt} />
                    ))}
                  </div>
                </div>
              )
            })}
            <div>
              <p className="text-xs font-bold text-muted-foreground mb-2">Ketentuan tambahan</p>
              <ul className="space-y-1.5 mb-2">
                {rules.custom.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm rounded-md bg-muted/50 px-3 py-2">
                    <span className="flex-1">{r}</span>
                    <button aria-label="Hapus aturan" onClick={() => onRules({ ...rules, custom: rules.custom.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </button>
                  </li>
                ))}
              </ul>
              <form className="flex gap-2" onSubmit={(e) => {
                e.preventDefault()
                if (!newRule.trim()) return
                onRules({ ...rules, custom: [...rules.custom, newRule.trim()] })
                setNewRule('')
              }}>
                <Input value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="mis. Parkir motor hanya di area belakang" />
                <Button type="submit" variant="outline" size="icon" aria-label="Tambah aturan"><Plus className="h-4 w-4" /></Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Isi perjanjian</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              <code># Judul</code>, <code>## Pasal</code>, <code>1.</code> daftar bernomor. Klausul DP, denda, dan jaminan terisi otomatis dari
              pengaturan pembayaran.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setA({ template: DEFAULT_AGREEMENT_TEMPLATE })}><RotateCcw className="h-3.5 w-3.5" /> Kembalikan bawaan</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea ref={tplRef} value={agreement.template} onChange={(e) => setA({ template: e.target.value })}
            className={cn('min-h-[420px] font-mono text-xs leading-relaxed')} spellCheck={false} />
          <div className="flex flex-wrap gap-1.5">
            {AGREEMENT_VARIABLES.map((v) => (
              <button key={v} type="button" onClick={() => insertVar(v)}
                className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] font-semibold hover:border-primary hover:text-primary transition">
                {v}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

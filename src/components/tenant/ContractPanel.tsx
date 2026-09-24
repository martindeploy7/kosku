import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Ban, CheckCircle2, Copy, Eye, FileSignature, FileText, Loader2, MessageCircle, RefreshCw, Send, WifiOff,
} from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, ConfirmDialog, EmptyState, Modal } from '@/components/ui'
import { actions } from '@/lib/actions'
import { fileUrl } from '@/lib/api'
import { isCurrentRental } from '@/lib/finance'
import { useStore } from '@/lib/store'
import type { Contract, Tenant } from '@/lib/types'
import { copyText, formatDate, relativeTime, waMeLink } from '@/lib/utils'

const STATUS: Record<Contract['status'], { label: string; tone: 'muted' | 'primary' | 'info' | 'success' | 'danger' }> = {
  draft: { label: 'Belum terkirim', tone: 'muted' },
  sent: { label: 'Terkirim', tone: 'primary' },
  viewed: { label: 'Sudah dibuka', tone: 'info' },
  signed: { label: 'Ditandatangani', tone: 'success' },
  void: { label: 'Dibatalkan', tone: 'muted' },
}

function LinkModal({ info, tenant, onClose }: {
  info: { link: string; queued: boolean; propertyId: string } | null
  tenant: Tenant
  onClose: () => void
}) {
  const toast = useStore((s) => s.toast)
  const waStatus = useStore((s) => s.waStatus)
  const property = useStore((s) => s.properties.find((p) => p.id === info?.propertyId))
  const connected = info ? waStatus[info.propertyId] === 'connected' : false
  const message = info
    ? `Halo ${tenant.name}, berikut Perjanjian Sewa & Tata Tertib ${property?.name ?? ''}. Mohon dibaca lalu ditandatangani di tautan ini:\n${info.link}`
    : ''

  return (
    <Modal
      open={Boolean(info)}
      onClose={onClose}
      title="Perjanjian siap ditandatangani"
      description="Tautan unik ini hanya untuk penyewa. Siapa pun yang memegangnya bisa menandatangani, jadi jangan dibagikan ke grup."
      footer={<Button onClick={onClose}>Selesai</Button>}
    >
      {info && (
        <div className="space-y-4">
          {info.queued && connected ? (
            <div className="rounded-lg border border-success/30 bg-success-soft p-3.5 flex gap-2.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              PDF perjanjian + tautan tanda tangan sedang dikirim dari WhatsApp {property?.name}.
            </div>
          ) : (
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-3.5 flex gap-2.5 text-sm">
              <WifiOff className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <span>
                WhatsApp {property?.name} belum terhubung. Pesan tetap diantrekan dan terkirim otomatis setelah terhubung —
                atau kirim manual sekarang lewat tombol di bawah.
              </span>
            </div>
          )}
          <div className="rounded-lg bg-muted p-3 font-mono text-xs break-all select-all">{info.link}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={async () => toast({ title: (await copyText(info.link)) ? 'Tautan disalin' : 'Gagal menyalin', variant: 'info' })}>
              <Copy className="h-3.5 w-3.5" /> Salin tautan
            </Button>
            <a href={waMeLink(tenant.phone, message)} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm"><MessageCircle className="h-3.5 w-3.5" /> Kirim manual via WhatsApp</Button>
            </a>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Rental agreement + house rules: create, send, track, resend. */
export function ContractPanel({ tenant }: { tenant: Tenant }) {
  const contracts = useStore((s) => s.contracts)
  const rentals = useStore((s) => s.rentals)
  const properties = useStore((s) => s.properties)
  const run = useStore((s) => s.run)
  const [creating, setCreating] = React.useState(false)
  const [send, setSend] = React.useState(true)
  const [linkInfo, setLinkInfo] = React.useState<{ link: string; queued: boolean; propertyId: string } | null>(null)
  const [voidTarget, setVoidTarget] = React.useState<Contract | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const rental = rentals.find((r) => r.tenantId === tenant.id && isCurrentRental(r))
  const list = contracts.filter((c) => c.tenantId === tenant.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const live = rental ? list.find((c) => c.rentalId === rental.id && c.status !== 'void') : undefined
  const property = rental ? properties.find((p) => p.id === rental.propertyId) : undefined

  const create = async () => {
    if (!rental) return
    setCreating(true)
    const res = await run(() => actions.createContract(rental.id, send))
    setCreating(false)
    if (res) setLinkInfo({ link: res.link, queued: res.queued, propertyId: rental.propertyId })
  }

  const resend = async (c: Contract) => {
    setBusy(c.id)
    const res = await run(() => actions.resendContract(c.id))
    setBusy(null)
    if (res) setLinkInfo({ link: res.link, queued: res.queued, propertyId: c.propertyId })
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
      <Card>
        <CardHeader><CardTitle>Perjanjian sewa & tata tertib</CardTitle></CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title="Belum ada perjanjian"
              description={rental ? 'Buat satu PDF berisi perjanjian sewa dan tata tertib, lalu kirim ke WhatsApp penyewa untuk ditandatangani.' : 'Perjanjian dibuat untuk sewa atau pemesanan yang sedang berjalan.'}
              className="py-8"
            />
          ) : (
            <ul className="space-y-3">
              {list.map((c) => {
                const st = STATUS[c.status]
                const pdf = c.signedPdfFileId ?? c.pdfFileId
                const steps = [
                  { label: 'Dibuat', at: c.createdAt },
                  { label: 'Terkirim', at: c.sentAt },
                  { label: 'Dibuka penyewa', at: c.viewedAt },
                  { label: `Ditandatangani${c.signedName ? ` oleh ${c.signedName}` : ''}`, at: c.signedAt },
                ]
                return (
                  <li key={c.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold">{c.number}</p>
                        <Badge tone={st.tone} className="mt-1.5">{st.label}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {pdf && (
                          <a href={fileUrl(pdf)} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="outline"><Eye className="h-3.5 w-3.5" /> {c.signedPdfFileId ? 'PDF bertanda tangan' : 'Lihat PDF'}</Button>
                          </a>
                        )}
                        {(c.status === 'draft' || c.status === 'sent' || c.status === 'viewed') && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => resend(c)} loading={busy === c.id}>
                              <Send className="h-3.5 w-3.5" /> Kirim ulang
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setVoidTarget(c)} aria-label="Batalkan perjanjian">
                              <Ban className="h-3.5 w-3.5 text-danger" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {c.status !== 'void' && (
                      <ol className="mt-4 grid sm:grid-cols-4 gap-2">
                        {steps.map((s) => (
                          <li key={s.label} className={`rounded-md px-2.5 py-2 text-[11px] ${s.at ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}>
                            <p className="font-semibold leading-tight">{s.label}</p>
                            <p className="mt-0.5 opacity-80">{s.at ? relativeTime(s.at) : '—'}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                    {c.status !== 'signed' && c.status !== 'void' && c.tokenExpiresAt && (
                      <p className="text-[11px] text-muted-foreground mt-2">Tautan berlaku sampai {formatDate(c.tokenExpiresAt.slice(0, 10), 'long')}.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{live ? 'Buat ulang' : 'Buat perjanjian'}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!rental ? (
            <p className="text-sm text-muted-foreground">Tidak ada sewa atau pemesanan yang berjalan.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Isi perjanjian diambil dari template dan tata tertib di pengaturan <strong>{property?.name}</strong>, ditambah data
                sewa terbaru. {live && live.status !== 'signed' && 'Perjanjian yang belum ditandatangani akan dibatalkan dan diganti.'}
              </p>
              {live?.status === 'signed' ? (
                <div className="rounded-lg bg-success-soft text-success p-3 text-sm flex gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> Sewa ini sudah memiliki perjanjian bertanda tangan.
                </div>
              ) : (
                <>
                  {property && !property.agreement.ownerSignatureFileId && (
                    <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs leading-relaxed flex gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                      <span>
                        Tanda tangan pemilik belum diunggah, jadi kolom PIHAK PERTAMA di PDF akan kosong.{' '}
                        <Link to={`/properties/${property.id}?tab=agreement`} className="font-semibold underline">Unggah di pengaturan properti</Link>.
                      </span>
                    </div>
                  )}
                  <Checkbox checked={send} onChange={setSend} label="Kirim langsung ke WhatsApp penyewa" />
                  <Button className="w-full" onClick={create} loading={creating}>
                    {live ? <RefreshCw className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    {live ? 'Buat ulang & kirim' : 'Buat perjanjian'}
                  </Button>
                </>
              )}
            </>
          )}
          {creating && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Menyusun PDF…</p>}
        </CardContent>
      </Card>

      <LinkModal info={linkInfo} tenant={tenant} onClose={() => setLinkInfo(null)} />
      <ConfirmDialog
        open={Boolean(voidTarget)}
        onClose={() => setVoidTarget(null)}
        title="Batalkan perjanjian?"
        confirmLabel="Batalkan"
        message="Tautan tanda tangan langsung tidak berlaku lagi. Anda bisa membuat perjanjian baru kapan saja."
        onConfirm={() => voidTarget && void run(() => actions.voidContract(voidTarget.id), { success: 'Perjanjian dibatalkan' })}
      />
    </div>
  )
}

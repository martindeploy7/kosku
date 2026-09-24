import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ClipboardCheck, Hourglass, Loader2, ShieldAlert, Undo2, X } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Modal, Textarea } from '@/components/ui'
import { PageHeader, Tabs } from '@/components/shared'
import { actions } from '@/lib/actions'
import { fileUrl } from '@/lib/api'
import { useLookups } from '@/lib/selectors'
import { useIsSuper, useStore } from '@/lib/store'
import type { ApprovalChange, ApprovalRequest, ApprovalStatus } from '@/lib/types'
import { cn, relativeTime } from '@/lib/utils'

const KIND_LABEL: Record<ApprovalRequest['kind'], string> = {
  delete: 'Penghapusan',
  'property.update': 'Pengaturan properti',
  'room.update': 'Harga kamar',
  'invoice.update': 'Nominal faktur',
  'invoice.void': 'Pembatalan faktur',
}

const STATUS: Record<ApprovalStatus, { label: string; tone: 'warning' | 'success' | 'danger' | 'muted' }> = {
  pending: { label: 'Menunggu', tone: 'warning' },
  approved: { label: 'Disetujui', tone: 'success' },
  rejected: { label: 'Ditolak', tone: 'danger' },
  canceled: { label: 'Dibatalkan', tone: 'muted' },
  failed: { label: 'Gagal', tone: 'danger' },
}

function LongText({ text, strike }: { text: string; strike?: boolean }) {
  if (!text) return <span className="text-muted-foreground italic">(kosong)</span>
  if (text.length <= 160) return <span className={cn('whitespace-pre-wrap break-words', strike && 'line-through text-muted-foreground')}>{text}</span>
  return (
    <details className="group">
      <summary className="cursor-pointer text-primary font-semibold text-xs select-none">
        Lihat teks ({text.length.toLocaleString('id-ID')} karakter)
      </summary>
      <pre className={cn('mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-xs leading-relaxed', strike && 'text-muted-foreground')}>{text}</pre>
    </details>
  )
}

function ChangeRow({ c }: { c: ApprovalChange }) {
  return (
    <div className="grid sm:grid-cols-[180px_1fr_1fr] gap-x-4 gap-y-1 py-2.5 border-b border-border/60 last:border-0 text-sm">
      <p className="font-semibold text-xs sm:text-sm">{c.label}</p>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:hidden">Sebelum</p>
        {c.fileIds?.before ? <img src={fileUrl(c.fileIds.before)} alt="Sebelum" className="max-h-20 rounded border border-border bg-white p-1" /> : <LongText text={c.before} strike />}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:hidden">Sesudah</p>
        {c.fileIds?.after ? <img src={fileUrl(c.fileIds.after)} alt="Sesudah" className="max-h-20 rounded border border-border bg-white p-1" /> : <strong className="font-semibold"><LongText text={c.after} /></strong>}
      </div>
    </div>
  )
}

function RequestCard({
  r, highlight, onDecide, onCancel, canDecide, canCancel, busy,
}: {
  r: ApprovalRequest
  highlight: boolean
  onDecide: (r: ApprovalRequest, d: 'approve' | 'reject') => void
  onCancel: (r: ApprovalRequest) => void
  canDecide: boolean
  canCancel: boolean
  busy: boolean
}) {
  const lookups = useLookups()
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlight])
  const st = STATUS[r.status]

  return (
    <div ref={ref}><Card className={cn('p-5', highlight && 'ring-2 ring-primary')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={r.kind === 'delete' || r.kind === 'invoice.void' ? 'danger' : 'primary'}>{KIND_LABEL[r.kind]}</Badge>
            <Badge tone={st.tone}>{st.label}</Badge>
            {r.propertyId && <span className="text-xs text-muted-foreground">{lookups.propertyName(r.propertyId)}</span>}
          </div>
          <h3 className="font-bold mt-2 break-words">{r.label}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Diminta oleh <strong className="text-foreground">{r.requestedByName}</strong> · {relativeTime(r.createdAt)}
          </p>
        </div>
        {r.status === 'pending' && (
          <div className="flex flex-wrap gap-2">
            {canDecide && (
              <>
                <Button variant="outline" onClick={() => onDecide(r, 'reject')} disabled={busy}><X className="h-4 w-4 text-danger" /> Tolak</Button>
                <Button onClick={() => onDecide(r, 'approve')} disabled={busy}><Check className="h-4 w-4" /> Setujui</Button>
              </>
            )}
            {canCancel && (
              <Button variant="ghost" onClick={() => onCancel(r)} disabled={busy}><Undo2 className="h-4 w-4" /> Batalkan permintaan</Button>
            )}
          </div>
        )}
      </div>

      {r.reason && (
        <blockquote className="mt-4 border-l-4 border-primary/40 bg-muted/40 rounded-r-md px-3 py-2 text-sm italic">"{r.reason}"</blockquote>
      )}

      <div className="mt-4 rounded-lg border border-border px-4">
        <div className="hidden sm:grid grid-cols-[180px_1fr_1fr] gap-x-4 py-2 border-b border-border text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <span>Bagian</span><span>Sebelum</span><span>Sesudah</span>
        </div>
        {r.changes.map((c, i) => <ChangeRow key={i} c={c} />)}
      </div>

      {r.status !== 'pending' && (r.reviewedByName || r.reviewNote || r.error) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {r.reviewedByName && <>Diputuskan oleh <strong className="text-foreground">{r.reviewedByName}</strong>{r.reviewedAt ? ` · ${relativeTime(r.reviewedAt)}` : ''}</>}
          {r.reviewNote && <> — "{r.reviewNote}"</>}
          {r.error && <span className="text-danger"> {r.error}</span>}
        </p>
      )}
    </Card></div>
  )
}

export default function Approvals() {
  const [params, setParams] = useSearchParams()
  const isSuper = useIsSuper()
  const me = useStore((s) => s.me)!
  const pending = useStore((s) => s.approvals)
  const rev = useStore((s) => s.rev)
  const run = useStore((s) => s.run)
  const [tab, setTab] = React.useState(params.get('tab') === 'history' ? 'history' : 'pending')
  const [history, setHistory] = React.useState<ApprovalRequest[] | null>(null)
  const [decision, setDecision] = React.useState<{ r: ApprovalRequest; d: 'approve' | 'reject' } | null>(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const focusId = params.get('id')

  React.useEffect(() => {
    const next: Record<string, string> = {}
    if (tab === 'history') next.tab = 'history'
    if (focusId) next.id = focusId
    setParams(next, { replace: true })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (tab !== 'history') return
    let alive = true
    actions.approvals('history').then((h) => alive && setHistory(h)).catch(() => alive && setHistory([]))
    return () => { alive = false }
  }, [tab, rev])

  // A link to a request that was already decided opens the history tab.
  React.useEffect(() => {
    if (focusId && tab === 'pending' && !pending.some((r) => r.id === focusId)) setTab('history')
  }, [focusId]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async () => {
    if (!decision) return
    if (decision.d === 'reject' && !note.trim()) return
    setBusy(true)
    const ok = decision.d === 'approve'
      ? await run(() => actions.approve(decision.r.id, note), { success: 'Disetujui dan diterapkan' })
      : await run(() => actions.reject(decision.r.id, note), { success: 'Permintaan ditolak' })
    setBusy(false)
    if (ok) { setDecision(null); setNote('') }
  }

  const cancel = async (r: ApprovalRequest) => {
    setBusy(true)
    await run(() => actions.cancelApproval(r.id), { success: 'Permintaan dibatalkan' })
    setBusy(false)
  }

  const list = tab === 'pending' ? pending : history

  return (
    <>
      <PageHeader
        title="Persetujuan"
        description={isSuper
          ? 'Penghapusan dan perubahan penting dari admin menunggu keputusan Anda. Perubahan baru diterapkan setelah disetujui.'
          : 'Penghapusan dan perubahan harga, rekening, denda, DP, perjanjian & tata tertib diterapkan setelah disetujui superadmin.'}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: 'pending', label: 'Menunggu', badge: pending.length ? <Badge tone="warning">{pending.length}</Badge> : undefined },
          { value: 'history', label: 'Riwayat' },
        ]}
      />

      {list === null ? (
        <div className="py-16 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={tab === 'pending' ? ClipboardCheck : Hourglass}
            title={tab === 'pending' ? 'Tidak ada yang menunggu persetujuan' : 'Belum ada riwayat'}
            description={tab === 'pending' && isSuper ? 'Permintaan dari admin akan muncul di sini dan di notifikasi Anda.' : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              highlight={r.id === focusId}
              canDecide={isSuper}
              canCancel={!isSuper && r.requestedById === me.id}
              busy={busy}
              onDecide={(req, d) => { setDecision({ r: req, d }); setNote('') }}
              onCancel={cancel}
            />
          ))}
        </div>
      )}

      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        size="sm"
        title={decision?.d === 'approve' ? 'Setujui permintaan?' : 'Tolak permintaan?'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>Batal</Button>
            <Button
              variant={decision?.d === 'approve' ? 'primary' : 'danger'}
              onClick={decide}
              loading={busy}
              disabled={decision?.d === 'reject' && !note.trim()}
            >
              {decision?.d === 'approve' ? 'Setujui & terapkan' : 'Tolak'}
            </Button>
          </>
        }
      >
        {decision && (
          <div className="space-y-4 text-sm">
            <p className="leading-relaxed"><strong>{decision.r.label}</strong> — diminta oleh {decision.r.requestedByName}.</p>
            {decision.d === 'approve' && (decision.r.kind === 'delete' || decision.r.kind === 'invoice.void') && (
              <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 flex gap-2 text-xs leading-relaxed">
                <ShieldAlert className="h-4 w-4 text-warning shrink-0" />
                {decision.r.kind === 'delete'
                  ? 'Data dipindahkan ke Tempat Sampah dan masih bisa dipulihkan.'
                  : 'Faktur tidak lagi ditagihkan dan keluar dari laporan pendapatan.'}
              </div>
            )}
            <div>
              <label htmlFor="decision-note" className="text-xs font-semibold">
                {decision.d === 'reject' ? 'Alasan penolakan (wajib)' : 'Catatan untuk admin (opsional)'}
              </label>
              <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5 min-h-[80px]"
                placeholder={decision.d === 'reject' ? 'Contoh: harga tahun ini belum disepakati pemilik' : ''} />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

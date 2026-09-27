import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Check, CheckCheck, CheckCircle2, Clock, FileText, Loader2, MessageCirclePlus, MessageSquareDashed,
  Receipt, RotateCcw, Send, User, Wifi, WifiOff,
} from 'lucide-react'
import { Avatar, Badge, Button, Card, EmptyState, Modal, SearchInput, Select } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { PaymentModal } from '@/components/modals/PaymentModal'
import { actions, type Conversation } from '@/lib/actions'
import { fileUrl } from '@/lib/api'
import { isCurrentRental } from '@/lib/finance'
import { useLookups } from '@/lib/selectors'
import { useStore } from '@/lib/store'
import type { WaMessage } from '@/lib/types'
import { cn, formatPhoneDisplay, normalizePhone, relativeTime } from '@/lib/utils'

const QUICK_REPLIES = [
  'Baik, kami cek dulu ya 🙏',
  'Terima kasih, pembayaran sudah kami terima ✅',
  'Teknisi akan datang besok pagi.',
  'Mohon konfirmasi pembayaran sewa bulan ini ya 🙏',
]

function StatusIcon({ m }: { m: WaMessage }) {
  if (m.direction === 'in') return null
  switch (m.status) {
    case 'queued':
    case 'sending':
      return <Clock className="h-3 w-3" aria-label="Dalam antrean" />
    case 'sent':
      return <Check className="h-3 w-3" aria-label="Terkirim" />
    case 'delivered':
      return <CheckCheck className="h-3 w-3" aria-label="Diterima" />
    case 'read':
      return <CheckCheck className="h-3 w-3 text-sky-300" aria-label="Dibaca" />
    case 'failed':
      return <AlertTriangle className="h-3 w-3 text-red-200" aria-label="Gagal" />
    default:
      return null
  }
}

export default function Chat() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const properties = useStore((s) => s.properties)
  const tenants = useStore((s) => s.tenants)
  const rentals = useStore((s) => s.rentals)
  const waStatus = useStore((s) => s.waStatus)
  const rev = useStore((s) => s.rev)
  const run = useStore((s) => s.run)
  const lookups = useLookups()

  const [propertyId, setPropertyId] = React.useState(params.get('property') || properties[0]?.id || '')
  const [phone, setPhone] = React.useState(params.get('phone') || '')
  const [conversations, setConversations] = React.useState<Conversation[] | null>(null)
  const [messages, setMessages] = React.useState<WaMessage[] | null>(null)
  const [query, setQuery] = React.useState('')
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [newOpen, setNewOpen] = React.useState(false)
  const [proofFor, setProofFor] = React.useState<{ fileId: string; tenantId: string } | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const next: Record<string, string> = {}
    if (propertyId) next.property = propertyId
    if (phone) next.phone = phone
    setParams(next, { replace: true })
  }, [propertyId, phone]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadConversations = React.useCallback(async () => {
    if (!propertyId) return
    setConversations(await actions.waConversations(propertyId).catch(() => []))
  }, [propertyId])

  const loadThread = React.useCallback(async () => {
    if (!propertyId || !phone) return setMessages(null)
    setMessages(await actions.waMessages(propertyId, phone).catch(() => []))
  }, [propertyId, phone])

  // Reload whenever the server's data revision moves (new message, delivery receipt…).
  React.useEffect(() => { void loadConversations() }, [loadConversations, rev])
  React.useEffect(() => { void loadThread() }, [loadThread, rev])
  React.useEffect(() => {
    const id = window.setInterval(() => { void loadConversations(); void loadThread() }, 10_000)
    return () => window.clearInterval(id)
  }, [loadConversations, loadThread])

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages?.length, phone])

  // A number can belong to several tenant records (someone who came back); the one with a current lease wins.
  const tenantByPhone = React.useMemo(() => {
    const current = new Set(rentals.filter(isCurrentRental).map((r) => r.tenantId))
    const map = new Map<string, (typeof tenants)[number]>()
    for (const t of tenants) {
      const prev = map.get(t.phone)
      if (!prev || (current.has(t.id) && !current.has(prev.id))) map.set(t.phone, t)
    }
    return map
  }, [tenants, rentals])
  const convTenant = (c: { phone: string; tenantId: string | null }) =>
    (c.tenantId ? lookups.tenant(c.tenantId) : undefined) ?? tenantByPhone.get(c.phone)

  const shown = (conversations ?? []).filter((c) => {
    if (!query) return true
    const t = convTenant(c)
    return `${t?.name ?? ''} ${c.phone}`.toLowerCase().includes(query.toLowerCase())
  })

  const activeTenant = phone ? tenantByPhone.get(normalizePhone(phone)) : undefined
  const activeRental = activeTenant ? rentals.find((r) => r.tenantId === activeTenant.id && isCurrentRental(r)) : undefined
  const selectedProperty = properties.find((p) => p.id === propertyId)
  const connected = waStatus[propertyId] === 'connected'

  const send = async () => {
    if (!draft.trim() || !phone) return
    setSending(true)
    const m = await run(() => actions.waSend(propertyId, phone, draft.trim(), activeTenant?.id ?? null), { refresh: false })
    setSending(false)
    if (m) {
      setDraft('')
      setMessages((xs) => [...(xs ?? []), m])
      void loadConversations()
    }
  }

  const retry = async (m: WaMessage) => {
    const ok = await run(() => actions.waRetry(m.id), { refresh: false, success: 'Pesan dikirim ulang' })
    if (ok) void loadThread()
  }

  const startable = tenants.filter((t) => t.phone && rentals.some((r) => r.tenantId === t.id && r.propertyId === propertyId && isCurrentRental(r)))

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Percakapan dengan penyewa melalui nomor WhatsApp masing-masing properti."
        actions={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {properties.length > 1 && (
              <div className="w-full sm:w-56">
                <Select value={propertyId} onChange={(v) => { setPropertyId(v); setPhone('') }}
                  options={properties.map((p) => ({ value: p.id, label: p.name }))} />
              </div>
            )}
            <Button variant="outline" onClick={() => setNewOpen(true)}><MessageCirclePlus className="h-4 w-4" /> Pesan baru</Button>
          </div>
        }
      />

      {selectedProperty && (
        <div
          role={connected ? 'status' : 'alert'}
          className={cn(
            'mb-4 rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3',
            connected ? 'border-success/40 bg-success-soft/60' : 'border-warning/40 bg-warning-soft/60',
          )}
        >
          {connected ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <WifiOff className="h-4 w-4 text-warning shrink-0" />}
          <div className="min-w-[220px] flex-1">
            <p className={cn('text-sm font-semibold flex items-center gap-1.5', connected ? 'text-success' : 'text-warning')}>
              {connected ? 'WhatsApp terhubung' : 'WhatsApp belum terhubung'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sumber pesan: <span className="font-medium text-foreground">{selectedProperty.name}</span>
              <span className="mx-1.5">·</span>{formatPhoneDisplay(selectedProperty.phone)}
            </p>
          </div>
          {connected ? (
            <Badge tone="success"><Wifi className="h-3 w-3" /> Aktif</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={() => navigate(`/properties/${propertyId}?tab=whatsapp`)}>Hubungkan</Button>
          )}
        </div>
      )}

      <Card className="overflow-hidden">
        {/* minmax(0,1fr) row + min-h-0 columns: the panes scroll inside the card instead of growing past it. */}
        <div className="grid lg:grid-cols-[340px_1fr] grid-rows-[minmax(0,1fr)] h-[calc(100dvh-300px)] min-h-[520px]">
          <div className={cn('border-r border-border flex flex-col min-w-0 min-h-0', phone && 'hidden lg:flex')}>
            <div className="p-3 border-b border-border">
              <SearchInput value={query} onChange={setQuery} placeholder="Cari nama atau nomor…" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations === null ? (
                <div className="py-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : shown.length === 0 ? (
                <EmptyState icon={MessageSquareDashed} title="Belum ada percakapan" description="Pesan otomatis dan balasan penyewa akan muncul di sini." className="py-10" />
              ) : shown.map((c) => {
                const t = convTenant(c)
                return (
                  <button
                    key={c.phone}
                    onClick={() => setPhone(c.phone)}
                    className={cn('w-full flex items-start gap-3 px-4 py-3.5 border-b border-border/60 text-left transition hover:bg-muted/50', phone === c.phone && 'bg-primary-soft/60')}
                  >
                    <Avatar name={t?.name ?? c.phone} color={t?.avatarColor ?? 'bg-muted-foreground'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn('text-sm truncate', c.unread ? 'font-bold' : 'font-semibold')}>{t?.name ?? formatPhoneDisplay(c.phone)}</p>
                        <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(c.lastAt)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {c.lastDirection === 'out' ? 'Anda: ' : ''}{c.lastBody}
                      </p>
                    </div>
                    {c.unread > 0 && (
                      <span className="h-5 min-w-5 px-1.5 rounded-full bg-success text-white text-[10px] font-bold grid place-items-center shrink-0 mt-1">{c.unread}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className={cn('flex flex-col min-w-0 min-h-0', !phone && 'hidden lg:flex')}>
            {!phone ? (
              <EmptyState icon={User} title="Pilih percakapan" description="Pilih kontak di sebelah kiri atau mulai pesan baru." className="h-full" />
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface">
                  <Button size="icon" variant="ghost" className="lg:hidden" onClick={() => setPhone('')} aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button>
                  <Avatar name={activeTenant?.name ?? phone} color={activeTenant?.avatarColor} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate">{activeTenant?.name ?? formatPhoneDisplay(phone)}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {formatPhoneDisplay(phone)}{activeRental ? ` · ${lookups.roomName(activeRental.roomId)}` : activeTenant ? '' : ' · bukan penyewa terdaftar'}
                    </p>
                  </div>
                  {activeTenant && <Button variant="outline" size="sm" onClick={() => navigate(`/tenants/${activeTenant.id}`)}>Profil</Button>}
                </div>

                <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5"
                  style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
                  {messages === null ? (
                    <div className="py-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : messages.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-8">Belum ada pesan. Kirim pesan pertama.</p>
                  ) : messages.map((m) => (
                    <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
                      <div className={cn(
                        'max-w-[80%] rounded-lg px-3.5 py-2.5 shadow-xs',
                        m.direction === 'out'
                          ? m.status === 'failed' ? 'bg-danger text-white rounded-br-none' : 'bg-primary text-primary-foreground rounded-br-none'
                          : 'bg-surface border border-border rounded-bl-none',
                      )}>
                        {m.type === 'image' && m.fileId && (
                          <a href={fileUrl(m.fileId)} target="_blank" rel="noreferrer" className="block mb-2">
                            <img src={fileUrl(m.fileId)} alt="Gambar dari penyewa" className="rounded-md max-h-64 w-auto max-w-full object-contain bg-muted"
                              onLoad={() => {
                                // Photos arrive after the thread scrolled down; keep the newest message in view.
                                const el = scrollRef.current
                                if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 400) el.scrollTo({ top: el.scrollHeight })
                              }} />
                          </a>
                        )}
                        {m.type === 'document' && m.fileId && (
                          <a href={fileUrl(m.fileId)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md bg-black/10 px-2.5 py-2 mb-2 text-xs font-semibold min-w-0">
                            <FileText className="h-4 w-4 shrink-0" /> <span className="truncate">{m.fileName || 'Dokumen PDF'}</span>
                          </a>
                        )}
                        {!(m.type === 'image' && m.fileId && m.body === '[Gambar]') && (
                          <p className="text-sm whitespace-pre-wrap leading-relaxed break-words">{m.body}</p>
                        )}
                        {m.direction === 'in' && m.fileId && m.tenantId && rentals.some((r) => r.tenantId === m.tenantId && isCurrentRental(r)) && (
                          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setProofFor({ fileId: m.fileId!, tenantId: m.tenantId! })}>
                            <Receipt className="h-3.5 w-3.5" /> Catat pembayaran dengan bukti ini
                          </Button>
                        )}
                        <p className={cn('text-[10px] mt-1 flex items-center gap-1 justify-end', m.direction === 'out' ? 'opacity-80' : 'text-muted-foreground')}>
                          {m.direction === 'out' && m.createdByName && <span className="mr-1">{m.createdByName} ·</span>}
                          {new Date(m.createdAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          <StatusIcon m={m} />
                        </p>
                        {m.status === 'failed' && (
                          <div className="mt-2 pt-2 border-t border-white/30 text-[11px]">
                            <p>{m.error}</p>
                            <button onClick={() => retry(m)} className="mt-1 inline-flex items-center gap-1 font-bold underline"><RotateCcw className="h-3 w-3" /> Kirim ulang</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-4 pt-3 flex flex-wrap gap-1.5 border-t border-border">
                  {QUICK_REPLIES.map((q) => (
                    <button key={q} onClick={() => setDraft(q)}
                      className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium hover:border-primary hover:text-primary transition">
                      {q}
                    </button>
                  ))}
                </div>
                <form className="p-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); void send() } }}
                    rows={1}
                    placeholder="Tulis pesan…"
                    className="flex-1 resize-none rounded-md border border-input bg-surface px-3.5 py-2.5 text-sm max-h-32 focus-ring"
                  />
                  <Button size="icon" type="submit" disabled={!draft.trim()} loading={sending} aria-label="Kirim"><Send className="h-4 w-4" /></Button>
                </form>
              </>
            )}
          </div>
        </div>
      </Card>

      <PaymentModal
        open={Boolean(proofFor)}
        onClose={() => setProofFor(null)}
        presetTenantId={proofFor?.tenantId}
        presetProofFileId={proofFor?.fileId}
      />

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Pesan baru" description="Pilih penyewa di properti ini.">
        {startable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada penyewa aktif dengan nomor WhatsApp.</p>
        ) : (
          <ul className="divide-y divide-border -mx-1">
            {startable.map((t) => (
              <li key={t.id}>
                <button onClick={() => { setPhone(t.phone); setNewOpen(false) }} className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-muted rounded-md">
                  <Avatar name={t.name} color={t.avatarColor} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">{formatPhoneDisplay(t.phone)}</span>
                  </span>
                  <Badge tone="muted">{lookups.roomName(rentals.find((r) => r.tenantId === t.id && isCurrentRental(r))?.roomId ?? null)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}

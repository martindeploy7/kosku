import * as React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Eye, FileText, MessageCircle, Pencil, Plus, Save, Trash2, Undo2, User, Wallet,
} from 'lucide-react'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, ConfirmDialog, CurrencyInput, Divider,
  EmptyState, Field, Input, Modal, RadioCard, Select, Switch, Table, Td, Textarea, Th, Tooltip, Tr,
} from '@/components/ui'
import { PageHeader, SectionTitle, Tabs } from '@/components/shared'
import { AddressFields, LocationPicker } from '@/components/shared/AddressForm'
import { RoomFormModal, ServiceFormModal } from '@/components/modals/FormModals'
import { AgreementPanel } from '@/components/property/AgreementPanel'
import { WhatsAppPanel } from '@/components/property/WhatsAppPanel'
import { NeedsApprovalHint, PendingApprovalBanner } from '@/components/shared/ApprovalNotice'
import { actions } from '@/lib/actions'
import {
  APPROVAL_FIELD_LABELS, APPROVAL_GATED, PDF_FONT_SIZES, ROOM_CONDITIONS, ROOM_STATUSES, TEMPLATE_VARIABLES, renderTemplate,
} from '@/lib/constants'
import { currentRentalOfRoom } from '@/lib/finance'
import { useLookups } from '@/lib/selectors'
import { isPending, useCanDelete, useCanManage, useNeedsApproval, usePendingFor, useStore } from '@/lib/store'
import type { MessageTemplate, Property, Room, Service } from '@/lib/types'
import { formatIDR, formatPhoneDisplay } from '@/lib/utils'

type Draft = Omit<Property, 'id' | 'createdAt' | 'version'>

const EDITABLE: (keyof Draft)[] = [
  'name', 'code', 'note', 'address', 'paymentMethods', 'paymentInfo', 'lateFee', 'booking', 'invoicePdf', 'templates', 'rules', 'agreement',
]

function draftOf(p: Property): Draft {
  const { id: _i, createdAt: _c, version: _v, ...rest } = p
  return structuredClone(rest)
}

const SAMPLE_VARS = {
  penyewa: 'Budi Santoso', kamar: 'Kamar 1', nomorFaktur: 'MLT-2610-0001', periode: '1 Okt 2026 – 1 Nov 2026',
  jatuhTempo: '1 Oktober 2026', total: 'Rp 1.500.000', sisa: 'Rp 1.500.000', tanggal: '1 Oktober 2026',
  idPembayaran: 'TRF-8K2Q9M4P', uangMuka: 'Rp 500.000', batasPelunasan: '3 Oktober 2026',
  link: 'https://kos.example.com/sign/…', berlakuSampai: '8 Oktober 2026',
}

export default function PropertyDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const properties = useStore((s) => s.properties)
  const rooms = useStore((s) => s.rooms)
  const services = useStore((s) => s.services)
  const rentals = useStore((s) => s.rentals)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const canManage = useCanManage()
  const canDelete = useCanDelete()
  const needsApproval = useNeedsApproval()
  const pending = usePendingFor(id)
  const pendingDelete = pending.find((r) => r.kind === 'delete')
  const lookups = useLookups()
  const [reason, setReason] = React.useState('')
  const [serviceToDelete, setServiceToDelete] = React.useState<Service | null>(null)

  const property = properties.find((p) => p.id === id)
  const [tab, setTab] = React.useState(params.get('tab') ?? 'info')
  const [draft, setDraft] = React.useState<Draft | null>(property ? draftOf(property) : null)
  const [baseVersion, setBaseVersion] = React.useState(property?.version ?? 0)
  const [saving, setSaving] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [roomModal, setRoomModal] = React.useState(false)
  const [editRoom, setEditRoom] = React.useState<Room | null>(null)
  const [serviceModal, setServiceModal] = React.useState(false)
  const [templateEdit, setTemplateEdit] = React.useState<MessageTemplate | null>(null)
  const [preview, setPreview] = React.useState<MessageTemplate | null>(null)

  React.useEffect(() => {
    setParams(tab === 'info' ? {} : { tab }, { replace: true })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = React.useMemo(() => {
    if (!property || !draft) return false
    const base = draftOf(property)
    return EDITABLE.some((k) => JSON.stringify(base[k]) !== JSON.stringify(draft[k]))
  }, [property, draft])

  // Adopt fresh server data (e.g. another admin saved) unless there are local edits;
  // with local edits, the save carries baseVersion and a conflict is reported instead.
  React.useEffect(() => {
    if (property && !dirty) {
      setDraft(draftOf(property))
      setBaseVersion(property.version)
    }
  }, [property]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!property || !draft) {
    return (
      <Card>
        <EmptyState icon={AlertTriangle} title="Properti tidak ditemukan"
          action={<Button onClick={() => navigate('/properties')}>Kembali ke daftar properti</Button>} />
      </Card>
    )
  }

  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d))

  // Which of the unsaved edits will need a superadmin's approval (same list the server enforces).
  const gatedEdits = (() => {
    const base = draftOf(property)
    const keys: string[] = (APPROVAL_GATED.property as readonly string[])
      .filter((k) => JSON.stringify(base[k as keyof Draft]) !== JSON.stringify(draft[k as keyof Draft]))
    for (const k of APPROVAL_GATED.agreement) {
      if (JSON.stringify(base.agreement[k]) !== JSON.stringify(draft.agreement[k])) keys.push(k)
    }
    return keys
  })()

  const save = async () => {
    const base = draftOf(property)
    const changed = Object.fromEntries(EDITABLE.filter((k) => JSON.stringify(base[k]) !== JSON.stringify(draft[k])).map((k) => [k, draft[k]]))
    if (!Object.keys(changed).length) return
    if (!draft.paymentMethods.cash && !draft.paymentMethods.transfer) {
      useStore.getState().toast({ title: 'Aktifkan minimal satu metode pembayaran', variant: 'error' })
      return
    }
    setSaving(true)
    const ok = await run(() => actions.updateProperty(property.id, changed, baseVersion, reason), { success: 'Pengaturan properti disimpan' })
    setSaving(false)
    if (ok) {
      // Pending: the harmless part was saved; the rest shows as "menunggu persetujuan" until decided.
      const saved = isPending(ok) ? (ok.applied as Property) : ok
      setDraft(draftOf(saved))
      setBaseVersion(saved.version)
      setReason('')
    }
  }

  const propRooms = rooms.filter((r) => r.propertyId === property.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }))
  const propServices = services.filter((s) => s.propertyId === property.id)
  const readOnly = !canManage

  return (
    <>
      <PageHeader
        title={property.name}
        breadcrumb={[{ label: 'Properti', to: '/properties' }, { label: property.name }]}
        description={`Kode faktur ${property.code} · WhatsApp ${formatPhoneDisplay(property.phone)}`}
        actions={canDelete ? (
          pendingDelete ? (
            <Button variant="outline" disabled><Trash2 className="h-4 w-4" /> Penghapusan menunggu persetujuan</Button>
          ) : (
            <Button variant="outline" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4 text-danger" /> Hapus</Button>
          )
        ) : undefined}
      />
      <PendingApprovalBanner requests={pending} className="mb-5" />

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: 'info', label: 'Informasi' },
          { value: 'payment', label: 'Pembayaran, DP & Denda' },
          { value: 'agreement', label: 'Perjanjian & Tata Tertib' },
          { value: 'messages', label: 'Pesan WhatsApp' },
          { value: 'whatsapp', label: 'Koneksi WhatsApp' },
          { value: 'rooms', label: 'Kamar & Layanan', badge: <Badge tone="muted">{propRooms.length}</Badge> },
        ]}
      />

      <fieldset disabled={readOnly} className="contents">
        {tab === 'info' && (
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <Card>
              <CardHeader><CardTitle>Informasi properti</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-[1fr_140px] gap-4">
                  <Field label="Nama properti" required><Input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
                  <Field label="Kode faktur" hint="Awalan nomor faktur.">
                    <Input value={draft.code} maxLength={5} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
                  </Field>
                </div>
                <Field label="WhatsApp properti" hint="Diubah dari tab Koneksi WhatsApp.">
                  <Input value={formatPhoneDisplay(property.phone)} disabled />
                </Field>
                <Field label="Catatan internal">
                  <Textarea value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="Catatan khusus properti ini" />
                </Field>
                <Divider label="Alamat" />
                <AddressFields value={draft.address} onChange={(p) => set({ address: { ...draft.address, ...p } })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Lokasi</CardTitle></CardHeader>
              <CardContent>
                <LocationPicker lat={draft.address.lat} lng={draft.address.lng}
                  onChange={(lat, lng) => set({ address: { ...draft.address, lat, lng } })} height={320} />
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'payment' && (
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <Card>
              <CardHeader><CardTitle>Metode & info pembayaran</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <Switch checked={draft.paymentMethods.cash} onChange={(v) => set({ paymentMethods: { ...draft.paymentMethods, cash: v } })}
                    label="Tunai" description="Pembayaran langsung ke pengelola." />
                </div>
                <div className="rounded-lg border border-border p-4">
                  <Switch checked={draft.paymentMethods.transfer} onChange={(v) => set({ paymentMethods: { ...draft.paymentMethods, transfer: v } })}
                    label="Transfer bank" description="Pembayaran ke rekening properti." />
                </div>
                <Field label="Info pembayaran untuk penyewa" hint="Muncul di tagihan, pengingat WhatsApp, dan PDF faktur.">
                  <Textarea value={draft.paymentInfo} onChange={(e) => set({ paymentInfo: e.target.value })}
                    placeholder="Transfer ke BCA 123-456-7890 a.n. Nama Pemilik" className="min-h-[80px]" />
                </Field>
                <Field label="Catatan di PDF faktur">
                  <Textarea value={draft.invoicePdf.note} onChange={(e) => set({ invoicePdf: { ...draft.invoicePdf, note: e.target.value } })}
                    placeholder="Terima kasih telah tinggal bersama kami." className="min-h-[60px]" />
                </Field>
                <Field label="Ukuran huruf PDF faktur">
                  <Select value={String(draft.invoicePdf.fontSize)} onChange={(v) => set({ invoicePdf: { ...draft.invoicePdf, fontSize: Number(v) } })}
                    options={PDF_FONT_SIZES.map((f) => ({ value: String(f.value), label: `${f.label} (${f.value}pt)` }))} />
                </Field>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Pemesanan dengan DP</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Lama kamar ditahan (hari)" hint="Default batas pelunasan sejak DP dibayar.">
                      <Input type="number" min={1} max={60} value={draft.booking.dpHoldDays}
                        onChange={(e) => set({ booking: { ...draft.booking, dpHoldDays: Math.max(1, Number(e.target.value) || 1) } })} />
                    </Field>
                    <Field label="Toleransi setelah batas (hari)" hint="0 = dilepas keesokan harinya.">
                      <Input type="number" min={0} max={30} value={draft.booking.graceDays}
                        onChange={(e) => set({ booking: { ...draft.booking, graceDays: Math.max(0, Number(e.target.value) || 0) } })} />
                    </Field>
                  </div>
                  <p className="text-xs font-semibold text-muted-foreground">Jika tidak lunas sampai batas waktu</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <RadioCard checked={draft.booking.lapsePolicy === 'forfeit'} onChange={() => set({ booking: { ...draft.booking, lapsePolicy: 'forfeit' } })}
                      title="DP hangus otomatis" description="Kamar dilepas dan DP dicatat sebagai pendapatan." />
                    <RadioCard checked={draft.booking.lapsePolicy === 'manual'} onChange={() => set({ booking: { ...draft.booking, lapsePolicy: 'manual' } })}
                      title="Putuskan manual" description="Kamar dilepas, admin memilih DP hangus atau dikembalikan." />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Denda keterlambatan</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <Switch checked={draft.lateFee.enabled} onChange={(v) => set({ lateFee: { ...draft.lateFee, enabled: v } })}
                    label="Aktifkan denda" description="Dihitung per tanggal uang diterima, bukan tanggal dicatat." />
                  {draft.lateFee.enabled && (
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field label="Tipe">
                        <Select value={draft.lateFee.type} onChange={(v) => set({ lateFee: { ...draft.lateFee, type: v as 'fixed' } })}
                          options={[{ value: 'fixed', label: 'Jumlah tetap' }, { value: 'percent', label: 'Persen tagihan' }]} />
                      </Field>
                      <Field label={draft.lateFee.type === 'fixed' ? 'Nilai' : 'Persen (%)'}>
                        {draft.lateFee.type === 'fixed' ? (
                          <CurrencyInput value={draft.lateFee.value} onChange={(v) => set({ lateFee: { ...draft.lateFee, value: v } })} />
                        ) : (
                          <Input type="number" min={0} max={100} value={draft.lateFee.value}
                            onChange={(e) => set({ lateFee: { ...draft.lateFee, value: Number(e.target.value) } })} />
                        )}
                      </Field>
                      <Field label="Masa tenggang (hari)">
                        <Input type="number" min={0} value={draft.lateFee.graceDays}
                          onChange={(e) => set({ lateFee: { ...draft.lateFee, graceDays: Math.max(0, Number(e.target.value) || 0) } })} />
                      </Field>
                      <Field label="Frekuensi">
                        <Select value={draft.lateFee.frequency} onChange={(v) => set({ lateFee: { ...draft.lateFee, frequency: v as 'once' } })}
                          options={[{ value: 'once', label: 'Sekali' }, { value: 'daily', label: 'Per hari terlambat' }]} />
                      </Field>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {tab === 'agreement' && (
          <AgreementPanel
            property={property}
            agreement={draft.agreement}
            rules={draft.rules}
            booking={draft.booking}
            lateFee={draft.lateFee}
            onAgreement={(agreement) => set({ agreement })}
            onRules={(rules) => set({ rules })}
          />
        )}

        {tab === 'messages' && (
          <Card>
            <CardHeader>
              <CardTitle>Template pesan WhatsApp</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Dipakai untuk tagihan, pengingat otomatis, kuitansi, pemesanan DP, dan perjanjian.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {draft.templates.whatsapp.map((tpl) => (
                <div key={tpl.id} className="flex items-start gap-3 rounded-lg border border-border p-4">
                  <span className="h-9 w-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><MessageCircle className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm">{tpl.label}</p>
                      {tpl.isDefault && <Badge tone="muted">Bawaan</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed whitespace-pre-line">{tpl.body}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Tooltip content="Pratinjau"><Button type="button" size="icon" variant="ghost" onClick={() => setPreview(tpl)} aria-label="Pratinjau"><Eye className="h-4 w-4" /></Button></Tooltip>
                    <Tooltip content="Ubah"><Button type="button" size="icon" variant="ghost" onClick={() => setTemplateEdit(tpl)} aria-label="Ubah"><Pencil className="h-4 w-4" /></Button></Tooltip>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </fieldset>

      {tab === 'whatsapp' && <WhatsAppPanel property={property} />}

      {tab === 'rooms' && (
        <div className="space-y-6">
          <Card>
            <div className="p-5 border-b border-border">
              <SectionTitle title="Kamar" description="Semua kamar di properti ini." className="mb-0"
                action={<Button size="sm" onClick={() => { setEditRoom(null); setRoomModal(true) }}><Plus className="h-3.5 w-3.5" /> Tambah kamar</Button>} />
            </div>
            {propRooms.length === 0 ? (
              <EmptyState icon={FileText} title="Belum ada kamar" />
            ) : (
              <Table>
                <thead><tr><Th>Kamar</Th><Th>Status</Th><Th>Kondisi</Th><Th align="right">Harga</Th><Th>Penyewa</Th><Th align="center">Aksi</Th></tr></thead>
                <tbody>
                  {propRooms.map((room) => {
                    const st = ROOM_STATUSES.find((s) => s.value === lookups.roomStatus(room.id))!
                    const cond = ROOM_CONDITIONS.find((c) => c.value === room.condition)!
                    const rental = currentRentalOfRoom(room.id, rentals, today)
                    return (
                      <Tr key={room.id}>
                        <Td className="font-semibold">{room.name}</Td>
                        <Td><Badge tone={st.tone as 'success'}>{st.label}</Badge></Td>
                        <Td><Badge tone={cond.tone as 'info'}>{cond.emoji} {cond.label}</Badge></Td>
                        <Td align="right" className="tabular-nums whitespace-nowrap font-semibold">{formatIDR(room.price.monthly)} <span className="text-muted-foreground font-normal">/bln</span></Td>
                        <Td className="text-sm">
                          {rental ? <button onClick={() => navigate(`/tenants/${rental.tenantId}`)} className="hover:text-primary font-medium">{lookups.tenantName(rental.tenantId)}</button> : '—'}
                        </Td>
                        <Td align="center">
                          <div className="flex items-center justify-center gap-0.5">
                            {rental && <Button size="icon" variant="ghost" onClick={() => navigate(`/tenants/${rental.tenantId}`)} aria-label="Penyewa"><User className="h-4 w-4" /></Button>}
                            <Button size="icon" variant="ghost" onClick={() => { setEditRoom(room); setRoomModal(true) }} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <div className="p-5 border-b border-border">
              <SectionTitle title="Layanan tambahan" description="Ditagihkan bersama sewa bila dipilih saat membuat sewa." className="mb-0"
                action={canManage ? <Button size="sm" onClick={() => setServiceModal(true)}><Plus className="h-3.5 w-3.5" /> Tambah layanan</Button> : undefined} />
            </div>
            {propServices.length === 0 ? (
              <EmptyState icon={Wallet} title="Tidak ada layanan" description="Contoh: laundry, parkir mobil, katering." />
            ) : (
              <Table>
                <thead><tr><Th>Layanan</Th><Th align="right">Harian</Th><Th align="right">Mingguan</Th><Th align="right">Bulanan</Th><Th align="right">Tahunan</Th><Th align="center">Aksi</Th></tr></thead>
                <tbody>
                  {propServices.map((s) => (
                    <Tr key={s.id}>
                      <Td className="font-semibold">{s.name}</Td>
                      <Td align="right" className="tabular-nums text-sm">{formatIDR(s.price.daily)}</Td>
                      <Td align="right" className="tabular-nums text-sm">{formatIDR(s.price.weekly)}</Td>
                      <Td align="right" className="tabular-nums text-sm font-semibold">{formatIDR(s.price.monthly)}</Td>
                      <Td align="right" className="tabular-nums text-sm">{formatIDR(s.price.yearly)}</Td>
                      <Td align="center">
                        {canManage && (
                          <Button size="icon" variant="ghost" aria-label="Hapus layanan" onClick={() => setServiceToDelete(s)}>
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {dirty && canManage && (
        <div className="sticky bottom-3 z-20 mt-6">
          <div className="card shadow-pop px-4 py-3 space-y-3 border-primary/40">
            {needsApproval && gatedEdits.length > 0 && (
              <NeedsApprovalHint what={gatedEdits.map((k) => APPROVAL_FIELD_LABELS[k] ?? k).join(', ')} reason={reason} onReason={setReason} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-semibold flex-1 min-w-[200px]">Ada perubahan yang belum disimpan.</p>
              <Button variant="ghost" onClick={() => setDraft(draftOf(property))}><Undo2 className="h-4 w-4" /> Batalkan</Button>
              <Button onClick={save} loading={saving}>
                <Save className="h-4 w-4" /> {needsApproval && gatedEdits.length ? 'Simpan & minta persetujuan' : 'Simpan perubahan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <RoomFormModal open={roomModal} onClose={() => setRoomModal(false)} editRoom={editRoom} presetPropertyId={property.id} />
      <ServiceFormModal open={serviceModal} onClose={() => setServiceModal(false)} propertyId={property.id} />

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Pratinjau: ${preview?.label}`} footer={<Button onClick={() => setPreview(null)}>Tutup</Button>}>
        <div className="rounded-lg bg-[#e5ddd5] dark:bg-muted p-4">
          <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white dark:bg-surface p-3.5 shadow-sm">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">
              {preview && renderTemplate(preview.body, { ...SAMPLE_VARS, properti: draft.name, infoPembayaran: draft.paymentInfo || 'Pembayaran tunai atau transfer.' })}
            </p>
          </div>
        </div>
      </Modal>

      <TemplateEditModal
        tpl={templateEdit}
        onClose={() => setTemplateEdit(null)}
        onSave={(updated) => set({ templates: { whatsapp: draft.templates.whatsapp.map((t) => (t.id === updated.id ? updated : t)) } })}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async (why) => {
          const ok = await run(() => actions.deleteProperty(property.id, why), { success: `${property.name} dipindahkan ke tempat sampah` })
          if (ok && !isPending(ok)) navigate('/properties')
        }}
        approval={needsApproval}
        title="Hapus properti?"
        confirmLabel="Hapus"
        message={`${property.name} beserta kamar, layanan, riwayat sewa, tagihan, pembayaran, dan pengeluarannya dipindahkan ke tempat sampah sebagai satu kelompok. Superadmin dapat memulihkan semuanya sekaligus. WhatsApp properti dijeda.`}
      />
      <ConfirmDialog
        open={Boolean(serviceToDelete)}
        onClose={() => setServiceToDelete(null)}
        onConfirm={(why) => {
          if (serviceToDelete) void run(() => actions.deleteService(serviceToDelete.id, why), { success: 'Layanan dihapus' })
        }}
        approval={needsApproval}
        title="Hapus layanan?"
        confirmLabel="Hapus"
        message={`Layanan "${serviceToDelete?.name}" tidak bisa dipilih lagi untuk sewa baru. Sewa yang sudah berjalan tidak berubah.`}
      />
    </>
  )
}

function TemplateEditModal({ tpl, onClose, onSave }: { tpl: MessageTemplate | null; onClose: () => void; onSave: (t: MessageTemplate) => void }) {
  const [body, setBody] = React.useState('')
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => { if (tpl) setBody(tpl.body) }, [tpl])

  const insertVar = (v: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    setBody((b) => b.slice(0, start) + v + b.slice(end))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + v.length, start + v.length) })
  }

  return (
    <Modal open={!!tpl} onClose={onClose} title={`Ubah template: ${tpl?.label}`} size="lg"
      description="Perubahan berlaku setelah Anda menyimpan pengaturan properti."
      footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={() => { if (tpl) onSave({ ...tpl, body, isDefault: false }); onClose() }}>Terapkan</Button></>}>
      <div className="space-y-4">
        <Textarea ref={ref} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[220px] leading-relaxed" />
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button key={v} type="button" onClick={() => insertVar(v)}
              className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] font-semibold hover:border-primary hover:text-primary transition">
              {v}
            </button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setBody(tpl?.body ?? '')}>Kembalikan isi awal</Button>
      </div>
    </Modal>
  )
}

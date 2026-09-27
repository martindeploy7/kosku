import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSignature, Info, Paperclip, Plus, Trash2, X } from 'lucide-react'
import {
  Button, Checkbox, CurrencyInput, DateInput, Divider, Field, Input, Modal, PhoneInput, RadioCard, Select, Textarea,
} from '@/components/ui'
import { actions, type CreateRentalInput } from '@/lib/actions'
import { EXPENSE_CATEGORIES, GENDERS, RENT_TYPES, ROOM_CONDITIONS } from '@/lib/constants'
import { isCurrentRental, planFirstInvoice, servicePriceFor } from '@/lib/finance'
import { useLookups } from '@/lib/selectors'
import { useNeedsApproval, usePendingFor, useStore } from '@/lib/store'
import { NeedsApprovalHint, PendingApprovalBanner } from '@/components/shared/ApprovalNotice'
import type { ExpenseItem, ExpenseRecurrence, PaymentMethod, PriceSet, RentType, Room, RoomCondition, Tenant } from '@/lib/types'
import { addDays, cn, formatDate, formatIDR, sum, uid } from '@/lib/utils'

/* ================================================================== rental fields (shared) */

type PaymentMode = CreateRentalInput['paymentMode']

interface RentalDraft {
  roomId: string
  startDate: string
  endDate: string
  rentType: RentType
  price: number
  billingDay: number
  serviceIds: string[]
  depositAmount: number
  depositPaid: boolean
  paymentMode: PaymentMode
  dpAmount: number
  paymentDeadline: string
  method: PaymentMethod
  sendContract: boolean
}

function useRentalDraft(open: boolean, presetRoomId?: string) {
  const today = useStore((s) => s.today)
  const make = React.useCallback((): RentalDraft => ({
    roomId: presetRoomId ?? '', startDate: today, endDate: '', rentType: 'monthly', price: 0,
    billingDay: Number(today.slice(8, 10)), serviceIds: [], depositAmount: 0, depositPaid: true,
    paymentMode: 'full', dpAmount: 0, paymentDeadline: addDays(today, 3), method: 'transfer', sendContract: true,
  }), [today, presetRoomId])
  const [draft, setDraft] = React.useState<RentalDraft>(make)
  React.useEffect(() => {
    if (open) setDraft(make())
  }, [open, make])
  return [draft, setDraft] as const
}

function RentalFields({ draft, setDraft }: { draft: RentalDraft; setDraft: React.Dispatch<React.SetStateAction<RentalDraft>> }) {
  const rooms = useStore((s) => s.rooms)
  const properties = useStore((s) => s.properties)
  const services = useStore((s) => s.services)
  const rentals = useStore((s) => s.rentals)
  const today = useStore((s) => s.today)
  const lookups = useLookups()
  const set = <K extends keyof RentalDraft>(k: K, v: RentalDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  // A room is bookable when nothing currently holds it (a DP booking holds it too).
  const available = rooms.filter((r) => !rentals.some((x) => x.roomId === r.id && isCurrentRental(x) && (!x.endDate || x.endDate > draft.startDate)))
  const room = rooms.find((r) => r.id === draft.roomId)
  const property = room ? properties.find((p) => p.id === room.propertyId) : undefined
  const roomServices = services.filter((s) => s.propertyId === room?.propertyId)

  // Room or scheme changes pull in that room's price and the property's DP/contract defaults.
  React.useEffect(() => {
    if (!room) return
    const key = draft.rentType === 'custom' ? 'monthly' : draft.rentType
    setDraft((d) => ({
      ...d,
      price: room.price[key] || room.price.monthly,
      depositAmount: d.depositAmount || room.price.monthly,
      paymentDeadline: addDays(today, property?.booking.dpHoldDays ?? 3),
      sendContract: property?.agreement.autoSend ?? true,
      method: property?.paymentMethods.transfer ? 'transfer' : 'cash',
      serviceIds: d.serviceIds.filter((id) => roomServices.some((s) => s.id === id)),
    }))
  }, [draft.roomId, draft.rentType]) // eslint-disable-line react-hooks/exhaustive-deps

  const plan = React.useMemo(() => {
    if (!room || draft.price <= 0) return null
    return planFirstInvoice(
      { startDate: draft.startDate, endDate: draft.endDate || null, billingDay: draft.billingDay, price: draft.price,
        rentType: draft.rentType, status: draft.paymentMode === 'dp' ? 'booked' : 'active', paymentDeadline: draft.paymentDeadline },
      room.name,
      roomServices.filter((s) => draft.serviceIds.includes(s.id)),
    )
  }, [room, draft, roomServices])

  const methods = [
    ...(property?.paymentMethods.cash !== false ? [{ value: 'cash', label: 'Tunai' }] : []),
    ...(property?.paymentMethods.transfer !== false ? [{ value: 'transfer', label: 'Transfer bank' }] : []),
  ]
  const dpTooBig = draft.paymentMode === 'dp' && plan && draft.dpAmount >= plan.subtotal

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Kamar" required hint={available.length === 0 ? 'Tidak ada kamar kosong.' : undefined} className="sm:col-span-2">
          <Select
            value={draft.roomId}
            onChange={(v) => set('roomId', v)}
            placeholder="Pilih kamar kosong"
            options={available.map((r) => ({
              value: r.id,
              label: `${r.name} — ${lookups.propertyName(r.propertyId)} (${formatIDR(r.price.monthly, { compact: true })}/bln)`,
            }))}
          />
        </Field>
        <Field label="Tanggal masuk" required>
          <DateInput value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v, billingDay: Number(v.slice(8, 10)) || d.billingDay }))} />
        </Field>
        <Field label="Jenis sewa" required>
          <Select value={draft.rentType} onChange={(v) => set('rentType', v as RentType)} options={RENT_TYPES.map((r) => ({ value: r.value, label: r.label }))} />
        </Field>
        <Field label="Harga sewa" required>
          <CurrencyInput value={draft.price} onChange={(v) => set('price', v)} />
        </Field>
        {(draft.rentType === 'monthly' || draft.rentType === 'custom') && (
          <Field label="Tanggal penagihan" hint="Default: tanggal masuk. Tanggal lain membuat tagihan pertama diprorata.">
            <Select
              value={String(draft.billingDay)}
              onChange={(v) => set('billingDay', Number(v))}
              options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Setiap tanggal ${i + 1}` }))}
            />
          </Field>
        )}
        <Field label="Tanggal selesai (opsional)" hint="Kosongkan bila sewa berjalan terus.">
          <DateInput value={draft.endDate} onChange={(v) => set('endDate', v)} min={addDays(draft.startDate, 1)} />
        </Field>
      </div>

      {roomServices.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Layanan tambahan (ditagihkan tiap periode)</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {roomServices.map((s) => (
              <Checkbox
                key={s.id}
                checked={draft.serviceIds.includes(s.id)}
                onChange={(v) => set('serviceIds', v ? [...draft.serviceIds, s.id] : draft.serviceIds.filter((x) => x !== s.id))}
                label={`${s.name} — ${formatIDR(servicePriceFor(s, draft.rentType))}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 items-end">
        <Field label="Uang jaminan (deposit)">
          <CurrencyInput value={draft.depositAmount} onChange={(v) => set('depositAmount', v)} />
        </Field>
        {draft.depositAmount > 0 && (
          <Checkbox checked={draft.depositPaid} onChange={(v) => set('depositPaid', v)} label="Uang jaminan sudah diterima"
            description="Dicatat sebagai penerimaan hari ini." className="pb-2.5" />
        )}
      </div>

      <Divider label="Pembayaran awal" />

      <div className="grid sm:grid-cols-3 gap-3">
        {/* A DP booking usually pays only the DP: don't record a deposit that wasn't handed over. */}
        <RadioCard checked={draft.paymentMode === 'full'} onChange={() => setDraft((d) => ({ ...d, paymentMode: 'full', depositPaid: true }))}
          title="Lunas sekarang" description="Tagihan pertama dibayar penuh. Kamar langsung Terisi · Lunas." />
        <RadioCard checked={draft.paymentMode === 'dp'} onChange={() => setDraft((d) => ({ ...d, paymentMode: 'dp', depositPaid: false }))}
          title="DP dulu" description="Kamar ditahan sampai batas pelunasan. Tidak lunas → dilepas otomatis." />
        <RadioCard checked={draft.paymentMode === 'later'} onChange={() => set('paymentMode', 'later')}
          title="Tagih nanti" description="Untuk penyewa lama yang dipindahkan ke sistem. Tagihan terbit seperti biasa." />
      </div>

      {draft.paymentMode === 'dp' && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nominal DP" required error={dpTooBig ? 'DP tidak boleh menutup seluruh tagihan pertama — pilih "Lunas sekarang".' : undefined}>
            <CurrencyInput value={draft.dpAmount} onChange={(v) => set('dpAmount', v)} />
          </Field>
          <Field label="Batas pelunasan" required hint={property ? `Default ${property.booking.dpHoldDays} hari dari hari ini.` : undefined}>
            <DateInput value={draft.paymentDeadline} onChange={(v) => set('paymentDeadline', v)} min={today} />
          </Field>
        </div>
      )}

      {draft.paymentMode !== 'later' && methods.length > 1 && (
        <Field label="Metode pembayaran">
          <Select value={draft.method} onChange={(v) => set('method', v as PaymentMethod)} options={methods} />
        </Field>
      )}

      {plan && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Tagihan pertama ({formatDate(plan.periodStart)} – {formatDate(plan.periodEnd)})</span>
            <span className="font-bold tabular-nums">{formatIDR(plan.subtotal)}</span>
          </div>
          {plan.items.map((it) => (
            <div key={it.name} className="flex justify-between gap-3 text-xs text-muted-foreground pl-3">
              <span>{it.name}</span><span className="tabular-nums">{formatIDR(it.amount)}</span>
            </div>
          ))}
          {draft.paymentMode === 'dp' && draft.dpAmount > 0 && !dpTooBig && (
            <div className="flex justify-between gap-3 pt-2 border-t border-border">
              <span className="text-muted-foreground">Sisa dilunasi paling lambat {formatDate(draft.paymentDeadline, 'long')}</span>
              <span className="font-bold tabular-nums text-warning">{formatIDR(plan.subtotal - draft.dpAmount)}</span>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-primary/25 bg-primary-soft/50 p-4">
        <Checkbox
          checked={draft.sendContract}
          onChange={(v) => set('sendContract', v)}
          label={<span className="flex items-center gap-1.5"><FileSignature className="h-4 w-4 text-primary" /> Kirim perjanjian sewa + tata tertib via WhatsApp</span>}
          description="Satu PDF berisi perjanjian dan tata tertib dikirim dari nomor WhatsApp properti, lengkap dengan tautan tanda tangan elektronik."
        />
      </div>
    </div>
  )
}

function rentalPayload(draft: RentalDraft, tenantId: string): CreateRentalInput | string {
  if (!draft.roomId) return 'Pilih kamar.'
  if (draft.price <= 0) return 'Harga sewa harus lebih dari 0.'
  if (draft.paymentMode === 'dp' && draft.dpAmount <= 0) return 'Isi nominal DP.'
  return {
    tenantId, roomId: draft.roomId, startDate: draft.startDate, endDate: draft.endDate || null, rentType: draft.rentType,
    price: draft.price, billingDay: draft.billingDay, serviceIds: draft.serviceIds, depositAmount: draft.depositAmount,
    depositPaid: draft.depositAmount > 0 && draft.depositPaid, paymentMode: draft.paymentMode,
    dpAmount: draft.paymentMode === 'dp' ? draft.dpAmount : 0,
    paymentDeadline: draft.paymentMode === 'dp' ? draft.paymentDeadline : null,
    method: draft.method, sendContract: draft.sendContract,
  }
}

function useAfterRental() {
  const toast = useStore((s) => s.toast)
  return (res: Awaited<ReturnType<typeof actions.createRental>>, tenantName: string) => {
    const booked = res.rental.status === 'booked'
    toast({
      title: booked ? `Pemesanan DP dicatat — kamar ditahan` : `Sewa ${tenantName} dimulai`,
      description: res.contractError
        ? `Perjanjian belum terkirim: ${res.contractError}`
        : res.contract
          ? res.contract.queued ? 'Perjanjian + tata tertib masuk antrean WhatsApp.' : 'Perjanjian dibuat.'
          : undefined,
      variant: res.contractError ? 'warning' : 'success',
    })
  }
}

/* ================================================================== Tenant (+ optional rental) */

export function TenantFormModal({
  open, onClose, onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (tenantId: string) => void
}) {
  const run = useStore((s) => s.run)
  const properties = useStore((s) => s.properties)
  const settings = useStore((s) => s.settings)
  const navigate = useNavigate()
  const afterRental = useAfterRental()

  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('+62')
  const [idNumber, setIdNumber] = React.useState('')
  const [gender, setGender] = React.useState('')
  const [job, setJob] = React.useState('')
  const [withRental, setWithRental] = React.useState(true)
  const [waitlistPropertyId, setWaitlistPropertyId] = React.useState('')
  const [draft, setDraft] = useRentalDraft(open)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setName(''); setPhone('+62'); setIdNumber(''); setGender(''); setJob('')
    setWithRental(true); setWaitlistPropertyId(properties[0]?.id ?? ''); setError(null)
  }, [open, properties])

  const submit = async () => {
    setError(null)
    if (name.trim().length < 2) return setError('Nama penyewa wajib diisi.')
    if (phone.replace(/\D/g, '').length < 9) return setError('Nomor WhatsApp wajib diisi — perjanjian dan pengingat dikirim ke nomor ini.')
    if (settings.requireIdNumber && !idNumber.trim()) return setError('NIK wajib diisi.')
    if (withRental) {
      const check = rentalPayload(draft, 'x')
      if (typeof check === 'string') return setError(check)
    }
    setSaving(true)
    const tenant = await run(() => actions.addTenant({
      name: name.trim(), idNumber: idNumber.trim(), gender: gender as Tenant['gender'], job,
      isWaitlist: !withRental, waitlistPropertyId: withRental ? null : waitlistPropertyId || null,
      contacts: [{ id: uid('ct'), name: name.trim(), email: '', phone }],
    }), { refresh: !withRental })
    if (!tenant) return setSaving(false)

    if (withRental) {
      const res = await run(() => actions.createRental(rentalPayload(draft, tenant.id) as CreateRentalInput))
      setSaving(false)
      if (!res) {
        // The tenant exists already; let the admin finish the lease from their page.
        onClose()
        navigate(`/tenants/${tenant.id}`)
        return
      }
      afterRental(res, tenant.name)
    } else {
      setSaving(false)
      useStore.getState().toast({ title: `${tenant.name} masuk daftar tunggu`, variant: 'success' })
    }
    onCreated?.(tenant.id)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah penyewa"
      description="Data penyewa, lalu sewa atau pemesanan kamar."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving}>{withRental ? 'Simpan & mulai sewa' : 'Simpan ke daftar tunggu'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nama lengkap" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sesuai KTP" autoFocus />
          </Field>
          <Field label="WhatsApp" required hint="Perjanjian, tagihan, dan pengingat dikirim ke nomor ini.">
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="NIK" required={settings.requireIdNumber}>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={16} placeholder="16 digit" />
          </Field>
          <Field label="Jenis kelamin">
            <Select value={gender} onChange={setGender} options={GENDERS} placeholder="Pilih" />
          </Field>
          <Field label="Pekerjaan">
            <Input value={job} onChange={(e) => setJob(e.target.value)} placeholder="Karyawan / Mahasiswa" />
          </Field>
        </div>

        <Divider />

        <div className="grid sm:grid-cols-2 gap-3">
          <RadioCard checked={withRental} onChange={() => setWithRental(true)} title="Langsung sewa / pesan kamar" description="Pilih kamar dan cara bayar (lunas atau DP)." />
          <RadioCard checked={!withRental} onChange={() => setWithRental(false)} title="Daftar tunggu" description="Calon penyewa, belum mengambil kamar." />
        </div>

        {withRental ? (
          <RentalFields draft={draft} setDraft={setDraft} />
        ) : properties.length > 1 ? (
          <Field label="Menunggu kamar di">
            <Select value={waitlistPropertyId} onChange={setWaitlistPropertyId} options={properties.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
        ) : null}

        {error && <p role="alert" className="text-sm text-danger font-medium bg-danger-soft rounded-md px-3 py-2">{error}</p>}
      </div>
    </Modal>
  )
}

/** Start a lease (or DP booking) for a tenant who already exists — e.g. from the waitlist. */
export function RentalFormModal({ open, onClose, tenant }: { open: boolean; onClose: () => void; tenant: Tenant }) {
  const run = useStore((s) => s.run)
  const afterRental = useAfterRental()
  const [draft, setDraft] = useRentalDraft(open)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => { if (open) setError(null) }, [open])

  const submit = async () => {
    const payload = rentalPayload(draft, tenant.id)
    if (typeof payload === 'string') return setError(payload)
    setSaving(true)
    const res = await run(() => actions.createRental(payload))
    setSaving(false)
    if (res) {
      afterRental(res, tenant.name)
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Mulai sewa · ${tenant.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={submit} loading={saving}>Simpan</Button></>}
    >
      <RentalFields draft={draft} setDraft={setDraft} />
      {error && <p role="alert" className="mt-4 text-sm text-danger font-medium bg-danger-soft rounded-md px-3 py-2">{error}</p>}
    </Modal>
  )
}

/* ================================================================== Room */

export function RoomFormModal({
  open, onClose, editRoom, presetPropertyId,
}: {
  open: boolean
  onClose: () => void
  editRoom?: Room | null
  presetPropertyId?: string
}) {
  const properties = useStore((s) => s.properties)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)

  const [propertyId, setPropertyId] = React.useState(presetPropertyId ?? properties[0]?.id ?? '')
  const [name, setName] = React.useState('')
  const [bulk, setBulk] = React.useState(false)
  const [bulkCount, setBulkCount] = React.useState(3)
  const [condition, setCondition] = React.useState<RoomCondition>('bersih')
  const [note, setNote] = React.useState('')
  const [price, setPrice] = React.useState<PriceSet>({ daily: 0, weekly: 0, monthly: 0, yearly: 0 })
  const [schemes, setSchemes] = React.useState({ daily: false, weekly: false, monthly: true, yearly: false })
  const [saving, setSaving] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const fieldId = React.useId()
  const needsApproval = useNeedsApproval()
  const pending = usePendingFor(editRoom?.id, 'room.update')
  const priceChanged = Boolean(editRoom) &&
    (JSON.stringify(price) !== JSON.stringify(editRoom!.price) || JSON.stringify(schemes) !== JSON.stringify(editRoom!.schemes))

  React.useEffect(() => {
    if (!open) return
    if (editRoom) {
      setPropertyId(editRoom.propertyId); setName(editRoom.name); setCondition(editRoom.condition)
      setNote(editRoom.note); setPrice(editRoom.price); setSchemes(editRoom.schemes); setBulk(false); setReason('')
    } else {
      setPropertyId(presetPropertyId ?? properties[0]?.id ?? ''); setName(''); setCondition('bersih'); setNote('')
      setPrice({ daily: 0, weekly: 0, monthly: 0, yearly: 0 })
      setSchemes({ daily: false, weekly: false, monthly: true, yearly: false })
      setBulk(false); setBulkCount(3)
    }
  }, [open, editRoom, presetPropertyId, properties])

  const submit = async () => {
    if (!propertyId) return toast({ title: 'Pilih properti', variant: 'error' })
    if (!name.trim()) return toast({ title: 'Nama kamar wajib diisi', variant: 'error' })
    setSaving(true)
    const ok = editRoom
      ? await run(() => actions.updateRoom(editRoom.id, { name: name.trim(), condition, note, price, schemes }, reason), { success: 'Kamar diperbarui' })
      : await run(
        () => actions.addRooms({ propertyId, name: name.trim(), price, schemes, condition, note, bulkCount: bulk ? bulkCount : undefined }),
        { success: bulk ? `${bulkCount} kamar ditambahkan` : 'Kamar ditambahkan' },
      )
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editRoom ? 'Edit kamar' : 'Tambah kamar'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving}>{editRoom ? 'Simpan perubahan' : 'Tambah kamar'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Properti" required>
            <Select value={propertyId} onChange={setPropertyId} disabled={Boolean(editRoom)} placeholder="Pilih properti"
              options={properties.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field label="Nama kamar" required hint={bulk ? 'Nomor urut ditambahkan otomatis.' : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={bulk ? 'Kamar' : 'Kamar 7'} />
          </Field>
          <Field label="Kondisi kamar">
            <Select value={condition} onChange={(v) => setCondition(v as RoomCondition)}
              options={ROOM_CONDITIONS.map((c) => ({ value: c.value, label: `${c.emoji} ${c.label}` }))} />
          </Field>
          <Field label="Catatan">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lantai 2, dekat tangga" />
          </Field>
        </div>

        {!editRoom && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <Checkbox checked={bulk} onChange={setBulk} label="Tambah sekaligus" description="Buat beberapa kamar bernomor urut (maksimum 50)." />
            {bulk && (
              <Field label="Jumlah kamar">
                <Input type="number" min={1} max={50} className="w-32" value={bulkCount}
                  onChange={(e) => setBulkCount(Math.min(50, Math.max(1, Number(e.target.value))))} />
              </Field>
            )}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground">Skema harga</p>
          <PendingApprovalBanner requests={pending} />
          {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((k) => {
            const labels = { daily: 'Harga / hari', weekly: 'Harga / minggu', monthly: 'Harga / bulan', yearly: 'Harga / tahun' }
            return (
              <div key={k} className="flex items-center gap-3">
                <Checkbox checked={schemes[k]} onChange={(v) => setSchemes((s) => ({ ...s, [k]: v }))} />
                <div className="flex-1">
                  <label htmlFor={`${fieldId}-${k}`} className="block text-xs font-semibold text-muted-foreground mb-1.5">{labels[k]}</label>
                  <CurrencyInput id={`${fieldId}-${k}`} disabled={!schemes[k]} value={price[k]} onChange={(v) => setPrice((p) => ({ ...p, [k]: v }))} />
                </div>
              </div>
            )
          })}
          {needsApproval && priceChanged && <NeedsApprovalHint what="harga / skema sewa" reason={reason} onReason={setReason} />}
        </div>
      </div>
    </Modal>
  )
}

/* ================================================================== Expense */

function FilePick({ file, onChange, label }: { file: File | null; onChange: (f: File | null) => void; label: string }) {
  return file ? (
    <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input text-sm">
      <Paperclip className="h-4 w-4 text-success shrink-0" />
      <span className="truncate flex-1">{file.name}</span>
      <button onClick={() => onChange(null)} aria-label="Hapus lampiran" className="p-1 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
    </div>
  ) : (
    <label className="flex items-center gap-2 h-10 px-3 rounded-md border border-dashed border-input cursor-pointer hover:border-primary/50 transition text-sm text-muted-foreground">
      <Paperclip className="h-4 w-4" /> {label}
      <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  )
}

export function ExpenseFormModal({
  open, onClose, presetPropertyId,
}: {
  open: boolean
  onClose: () => void
  presetPropertyId?: string
}) {
  const properties = useStore((s) => s.properties)
  const rooms = useStore((s) => s.rooms)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)

  const [propertyId, setPropertyId] = React.useState(presetPropertyId ?? '')
  const [roomId, setRoomId] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [name, setName] = React.useState('')
  const [date, setDate] = React.useState(today)
  const [items, setItems] = React.useState<ExpenseItem[]>([{ name: '', amount: 0 }])
  const [note, setNote] = React.useState('')
  const [recurring, setRecurring] = React.useState(false)
  const [recurrence, setRecurrence] = React.useState<ExpenseRecurrence>('monthly')
  const [recurrenceEndDate, setRecurrenceEndDate] = React.useState('')
  const [receipt, setReceipt] = React.useState<File | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setPropertyId(presetPropertyId ?? (properties.length === 1 ? properties[0].id : ''))
    setRoomId(''); setCategory(''); setName(''); setDate(today)
    setItems([{ name: '', amount: 0 }]); setNote(''); setRecurring(false)
    setRecurrence('monthly'); setRecurrenceEndDate(''); setReceipt(null)
  }, [open, presetPropertyId, today, properties])

  const subtotal = sum(items, (i) => i.amount)
  const propertyRooms = rooms.filter((r) => r.propertyId === propertyId)

  const submit = async () => {
    if (!propertyId) return toast({ title: 'Pilih properti terlebih dahulu', variant: 'error' })
    if (!name.trim()) return toast({ title: 'Nama pengeluaran wajib diisi', variant: 'error' })
    if (!category) return toast({ title: 'Pilih kategori pengeluaran', variant: 'error' })
    if (subtotal <= 0) return toast({ title: 'Total pengeluaran harus lebih dari 0', variant: 'error' })
    setSaving(true)
    const expense = await run(() => actions.addExpense({
      propertyId, roomId: roomId || null, category, name: name.trim(), date,
      items: items.filter((i) => i.amount > 0).map((i) => ({ name: i.name || name.trim(), amount: i.amount })),
      note, attachment: null, recurring,
      recurrence: recurring ? recurrence : null,
      recurrenceEndDate: recurring && recurrenceEndDate ? recurrenceEndDate : null,
    }), { refresh: !receipt, success: `Pengeluaran ${formatIDR(subtotal)} dicatat` })
    if (expense && receipt) await run(() => actions.uploadFile(receipt, 'expense', expense.id, 'nota'))
    setSaving(false)
    if (expense) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat pengeluaran"
      description="Biaya operasional properti atau kamar."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving} disabled={!propertyId}>Simpan pengeluaran</Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Properti" required>
          <Select value={propertyId} onChange={(v) => { setPropertyId(v); setRoomId('') }} placeholder="Pilih properti"
            options={properties.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>

        {propertyId && (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Kamar (opsional)">
                <Select value={roomId} onChange={setRoomId} placeholder="Seluruh properti"
                  options={[{ value: '', label: 'Seluruh properti' }, ...propertyRooms.map((r) => ({ value: r.id, label: r.name }))]} />
              </Field>
              <Field label="Kategori" required>
                <Select value={category} onChange={setCategory} placeholder="Pilih kategori"
                  options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
              </Field>
              <Field label="Nama pengeluaran" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Servis AC 6 unit" />
              </Field>
              <Field label="Tanggal" required>
                <DateInput value={date} onChange={setDate} max={today} />
              </Field>
            </div>

            <Divider label="Rincian" />

            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field label={i === 0 ? 'Item' : undefined} className="flex-1">
                    <Input value={item.name} placeholder="Freon + jasa"
                      onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </Field>
                  <Field label={i === 0 ? 'Biaya' : undefined} className="w-36 sm:w-40">
                    <CurrencyInput value={item.amount} onChange={(v) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                  </Field>
                  <Button variant="ghost" size="icon" disabled={items.length === 1} aria-label="Hapus item"
                    onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <Button variant="outline" size="sm" onClick={() => setItems((arr) => [...arr, { name: '', amount: 0 }])}>
                  <Plus className="h-3.5 w-3.5" /> Tambah item
                </Button>
                <p className="text-sm font-bold">Total: <span className="tabular-nums">{formatIDR(subtotal)}</span></p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nota / kuitansi">
                <FilePick file={receipt} onChange={setReceipt} label="Foto atau PDF (opsional)" />
              </Field>
              <Field label="Catatan">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan tambahan" />
              </Field>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
              <Checkbox checked={recurring} onChange={setRecurring} label="Biaya rutin"
                description="Buat transaksi berikutnya otomatis untuk internet, upah kebersihan, listrik, dan biaya tetap lain." />
              {recurring && (
                <div className="grid sm:grid-cols-2 gap-4 pl-6">
                  <Field label="Ulangi setiap">
                    <Select value={recurrence} onChange={(v) => setRecurrence(v as ExpenseRecurrence)} options={[
                      { value: 'weekly', label: 'Minggu' },
                      { value: 'monthly', label: 'Bulan' },
                      { value: 'yearly', label: 'Tahun' },
                    ]} />
                  </Field>
                  <Field label="Berakhir (opsional)">
                    <DateInput value={recurrenceEndDate} onChange={setRecurrenceEndDate} min={date} />
                  </Field>
                  <p className="sm:col-span-2 text-xs leading-relaxed text-muted-foreground">
                    Tanggal ini menjadi transaksi pertama. Transaksi lanjutan dibuat otomatis saat jatuh tempo dan tidak menyalin lampiran.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/* ================================================================== Service */

export function ServiceFormModal({ open, onClose, propertyId }: { open: boolean; onClose: () => void; propertyId: string }) {
  const run = useStore((s) => s.run)
  const [name, setName] = React.useState('')
  const [price, setPrice] = React.useState<PriceSet>({ daily: 0, weekly: 0, monthly: 0, yearly: 0 })

  React.useEffect(() => {
    if (!open) return
    setName('')
    setPrice({ daily: 0, weekly: 0, monthly: 0, yearly: 0 })
  }, [open])

  const submit = async () => {
    if (!name.trim()) return
    const ok = await run(() => actions.addService({ propertyId, name: name.trim(), price }), { success: 'Layanan ditambahkan' })
    if (ok) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Tambah layanan" description="Layanan tambahan yang ditagihkan bersama sewa."
      footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={submit} disabled={!name.trim()}>Tambah</Button></>}>
      <div className="space-y-4">
        <Field label="Nama layanan" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Laundry kiloan" autoFocus />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((k) => {
            const labels = { daily: 'Harga / hari', weekly: 'Harga / minggu', monthly: 'Harga / bulan', yearly: 'Harga / tahun' }
            return (
              <Field key={k} label={labels[k]}>
                <CurrencyInput value={price[k]} onChange={(v) => setPrice((p) => ({ ...p, [k]: v }))} />
              </Field>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

/* ================================================================== Manual invoice */

export function InvoiceFormModal({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId: string }) {
  const rentals = useStore((s) => s.rentals)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const lookups = useLookups()

  const rental = rentals.find((r) => r.tenantId === tenantId && isCurrentRental(r))
  const [items, setItems] = React.useState<ExpenseItem[]>([{ name: '', amount: 0 }])
  const [dueDate, setDueDate] = React.useState(today)
  const [periodStart, setPeriodStart] = React.useState(today)
  const [periodEnd, setPeriodEnd] = React.useState(addDays(today, 1))
  const [note, setNote] = React.useState('')

  React.useEffect(() => {
    if (!open || !rental) return
    setItems([{ name: `Biaya tambahan ${lookups.roomName(rental.roomId)}`, amount: 0 }])
    setDueDate(today); setPeriodStart(today); setPeriodEnd(addDays(today, 1)); setNote('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = sum(items, (i) => i.amount)

  const submit = async () => {
    if (!rental || total <= 0) return
    const ok = await run(() => actions.addInvoice({
      rentalId: rental.id, periodStart, periodEnd, dueDate, items: items.filter((i) => i.amount > 0), note,
    }), { success: `Faktur ${formatIDR(total)} dibuat` })
    if (ok) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Tagihan manual" description="Di luar tagihan sewa otomatis, mis. biaya kerusakan atau listrik."
      footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={submit} disabled={!rental || total <= 0}>Buat faktur</Button></>}>
      {!rental ? (
        <p className="text-sm text-muted-foreground">Penyewa ini tidak memiliki sewa yang berjalan.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Periode mulai"><DateInput value={periodStart} onChange={setPeriodStart} /></Field>
            <Field label="Periode akhir"><DateInput value={periodEnd} onChange={setPeriodEnd} min={addDays(periodStart, 1)} /></Field>
            <Field label="Jatuh tempo"><DateInput value={dueDate} onChange={setDueDate} /></Field>
          </div>
          <Divider label="Rincian" />
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label={i === 0 ? 'Deskripsi' : undefined} className="flex-1">
                  <Input value={item.name} onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </Field>
                <Field label={i === 0 ? 'Jumlah' : undefined} className="w-36 sm:w-40">
                  <CurrencyInput value={item.amount} onChange={(v) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                </Field>
                <Button variant="ghost" size="icon" disabled={items.length === 1} aria-label="Hapus baris"
                  onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" size="sm" onClick={() => setItems((a) => [...a, { name: '', amount: 0 }])}>
                <Plus className="h-3.5 w-3.5" /> Tambah baris
              </Button>
              <p className="text-sm font-bold">Total: <span className="tabular-nums">{formatIDR(total)}</span></p>
            </div>
          </div>
          <Field label="Catatan"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px]" /></Field>
        </div>
      )}
    </Modal>
  )
}

/* ================================================================== Property */

export function PropertyFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useStore((s) => s.run)
  const navigate = useNavigate()
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('+62')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) { setName(''); setPhone('+62') }
  }, [open])

  const submit = async () => {
    setSaving(true)
    const p = await run(() => actions.createProperty({ name: name.trim(), phone }), { success: 'Properti dibuat' })
    setSaving(false)
    if (p) {
      onClose()
      navigate(`/properties/${p.id}`)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah properti"
      description="Detail alamat, kamar, perjanjian, dan WhatsApp diatur setelah properti dibuat."
      footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={submit} loading={saving} disabled={name.trim().length < 2 || phone.replace(/\D/g, '').length < 9}>Buat properti</Button></>}
    >
      <div className="space-y-4">
        <Field label="Nama kos / residence" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kost Melati Asri" autoFocus />
        </Field>
        <Field label="Nomor WhatsApp properti" required>
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <div className={cn('rounded-lg border border-info/30 bg-info-soft p-3.5 flex gap-2.5')}>
          <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            Satu properti memakai <strong>satu nomor WhatsApp</strong>. Semua pesan ke penyewa properti ini dikirim dari nomor
            tersebut, dan hanya HP dengan nomor ini yang bisa memindai QR untuk menghubungkannya.
          </p>
        </div>
      </div>
    </Modal>
  )
}

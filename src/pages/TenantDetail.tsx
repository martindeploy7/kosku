import * as React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Ban, Banknote, CalendarPlus, Download, FileText, Hourglass, MessageCircle, Paperclip, Pencil, Plus,
  Save, Trash2, Undo2, Wallet, X,
} from 'lucide-react'
import {
  Avatar, Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, DateInput, Divider, EmptyState, Field,
  Input, Modal, PhoneInput, RadioCard, Select, Table, Td, Textarea, Th, Tooltip, Tr,
} from '@/components/ui'
import { KeyValue, PageHeader, Tabs } from '@/components/shared'
import { formatAddress } from '@/components/shared/AddressForm'
import { CheckoutModal } from '@/components/modals/CheckoutModal'
import { InvoiceFormModal, RentalFormModal } from '@/components/modals/FormModals'
import { PaymentModal } from '@/components/modals/PaymentModal'
import { ContractPanel } from '@/components/tenant/ContractPanel'
import { DocumentsPanel } from '@/components/tenant/DocumentsPanel'
import { actions } from '@/lib/actions'
import { fileUrl } from '@/lib/api'
import {
  GENDERS, INVOICE_STATUSES, MARITAL_STATUSES, RENTAL_STATUSES, TENANT_STATUSES, rentTypeLabel,
} from '@/lib/constants'
import { exportInvoicePDF } from '@/lib/export'
import { averageSettlementDays, isCurrentRental, outstanding, servicePriceFor, settlementLabel } from '@/lib/finance'
import { useLookups } from '@/lib/selectors'
import { isPending, useCanDelete, useNeedsApproval, useStore } from '@/lib/store'
import type { Invoice, Payment, Rental, Tenant } from '@/lib/types'
import { cn, daysBetween, formatDate, formatIDR, sum, uid, waMeLink } from '@/lib/utils'

type Editable = Omit<Tenant, 'id' | 'version' | 'createdAt' | 'phone'>

function editableOf(t: Tenant): Editable {
  const { id: _id, version: _v, createdAt: _c, phone: _p, ...rest } = t
  return rest
}

/* ------------------------------------------------------------------ banners */

function BookingBanner({ rental, onPay, onCancel }: { rental: Rental; onPay: () => void; onCancel: () => void }) {
  const invoices = useStore((s) => s.invoices)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const [extendOpen, setExtendOpen] = React.useState(false)
  const [deadline, setDeadline] = React.useState(rental.paymentDeadline ?? today)
  const first = invoices.find((i) => i.rentalId === rental.id && i.isFirst)
  const rest = first ? outstanding(first) : 0
  const days = rental.paymentDeadline ? daysBetween(today, rental.paymentDeadline) : 0

  return (
    <div className="card mb-6 border-warning/40 bg-warning-soft/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-4">
        <span className="h-10 w-10 rounded-xl bg-warning text-white grid place-items-center shrink-0"><Hourglass className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Pemesanan DP — kamar ditahan</p>
          <p className="text-sm mt-1 leading-relaxed">
            DP {formatIDR(rental.downPayment.amount)} diterima. Sisa <strong>{formatIDR(rest)}</strong> harus lunas paling lambat{' '}
            <strong>{formatDate(rental.paymentDeadline, 'long')}</strong>
            {days > 0 ? ` (${days} hari lagi)` : days === 0 ? ' (hari ini)' : ` (lewat ${-days} hari)`}. Jika tidak lunas, pemesanan batal
            otomatis dan kamar dibuka kembali.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onPay}><Banknote className="h-4 w-4" /> Catat pelunasan</Button>
          <Button size="sm" variant="outline" onClick={() => setExtendOpen(true)}><CalendarPlus className="h-4 w-4" /> Perpanjang batas</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}><Ban className="h-4 w-4 text-danger" /> Batalkan</Button>
        </div>
      </div>
      <Modal
        open={extendOpen}
        onClose={() => setExtendOpen(false)}
        size="sm"
        title="Perpanjang batas pelunasan"
        footer={
          <>
            <Button variant="ghost" onClick={() => setExtendOpen(false)}>Batal</Button>
            <Button onClick={async () => {
              const ok = await run(() => actions.updateRental(rental.id, { paymentDeadline: deadline }), { success: 'Batas pelunasan diperbarui' })
              if (ok) setExtendOpen(false)
            }}>Simpan</Button>
          </>
        }
      >
        <Field label="Batas pelunasan baru"><DateInput value={deadline} onChange={setDeadline} min={today} /></Field>
      </Modal>
    </div>
  )
}

/** DP and security deposit a booking actually holds (receipts minus refunds). */
function useBookingMoney(rentalId: string) {
  const payments = useStore((s) => s.payments)
  const held = (kind: 'dp' | 'deposit') => Math.max(0, payments.filter((p) => p.rentalId === rentalId && p.kind === kind).reduce((a, p) => a + p.amount, 0))
  const dp = held('dp')
  const deposit = held('deposit')
  return { dp, deposit, total: dp + deposit, label: deposit > 0 ? `DP ${formatIDR(dp)} + uang jaminan ${formatIDR(deposit)}` : `DP ${formatIDR(dp)}` }
}

function LapsedBanner({ rental }: { rental: Rental }) {
  const run = useStore((s) => s.run)
  const lookups = useLookups()
  const money = useBookingMoney(rental.id)
  return (
    <div className="card mb-6 border-danger/40 bg-danger-soft/60 p-4 sm:p-5 flex flex-wrap items-start gap-4">
      <span className="h-10 w-10 rounded-xl bg-danger text-white grid place-items-center shrink-0"><Undo2 className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">Gagal bayar — tentukan DP</p>
        <p className="text-sm mt-1 leading-relaxed">
          Pemesanan {lookups.roomName(rental.roomId)} tidak dilunasi sampai {formatDate(rental.paymentDeadline, 'long')} dan kamar sudah
          dibuka kembali. {money.label} perlu diputuskan.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void run(() => actions.resolveDp(rental.id, 'forfeit'), { success: 'DP dicatat hangus (pendapatan)' })}>DP hangus</Button>
        <Button size="sm" variant="outline" onClick={() => void run(() => actions.resolveDp(rental.id, 'refund'), { success: 'Pengembalian DP dicatat' })}>Kembalikan DP</Button>
      </div>
    </div>
  )
}

function CancelBookingModal({ rental, open, onClose }: { rental: Rental; open: boolean; onClose: () => void }) {
  const run = useStore((s) => s.run)
  const money = useBookingMoney(rental.id)
  const [dpAction, setDpAction] = React.useState<'forfeit' | 'refund'>('forfeit')
  const [note, setNote] = React.useState('')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Batalkan pemesanan?"
      description="Kamar langsung tersedia kembali dan tagihan yang belum dibayar dibatalkan."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Kembali</Button>
          <Button variant="danger" onClick={async () => {
            const ok = await run(() => actions.cancelBooking(rental.id, { dpAction, note }), { success: 'Pemesanan dibatalkan' })
            if (ok) onClose()
          }}>Batalkan pemesanan</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <RadioCard checked={dpAction === 'forfeit'} onChange={() => setDpAction('forfeit')}
            title={money.deposit > 0 ? 'Uang pemesanan hangus' : 'DP hangus'} description={`${money.label} dicatat sebagai pendapatan.`} />
          <RadioCard checked={dpAction === 'refund'} onChange={() => setDpAction('refund')}
            title={money.deposit > 0 ? 'Kembalikan semua' : 'Kembalikan DP'} description={`${formatIDR(money.total)} dicatat sebagai uang keluar hari ini.`} />
        </div>
        <Field label="Alasan (opsional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px]" /></Field>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ page */

export default function TenantDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tenants = useStore((s) => s.tenants)
  const rentals = useStore((s) => s.rentals)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const properties = useStore((s) => s.properties)
  const services = useStore((s) => s.services)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const canDelete = useCanDelete()
  const lookups = useLookups()

  const tenant = tenants.find((t) => t.id === id)
  const tenantRentals = React.useMemo(
    () => rentals.filter((r) => r.tenantId === id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [rentals, id],
  )
  const rental = tenantRentals.find(isCurrentRental) ?? null
  const lapsedPending = tenantRentals.find((r) => r.status === 'lapsed' && r.lapseResolution === 'pending')
  const tenantInvoices = React.useMemo(
    () => invoices.filter((i) => i.tenantId === id).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)),
    [invoices, id],
  )
  const tenantPayments = payments.filter((p) => p.tenantId === id)

  const [tab, setTab] = React.useState(params.get('tab') ?? 'profile')
  const [editing, setEditing] = React.useState(false)
  const [editWarnOpen, setEditWarnOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [pay, setPay] = React.useState<{ invoiceId?: string } | null>(null)
  const [checkoutOpen, setCheckoutOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [rentalOpen, setRentalOpen] = React.useState(false)
  const [invoiceOpen, setInvoiceOpen] = React.useState(false)
  const [expandedInvoice, setExpandedInvoice] = React.useState<string | null>(null)
  const [paymentToDelete, setPaymentToDelete] = React.useState<Payment | null>(null)
  const [voidTarget, setVoidTarget] = React.useState<Invoice | null>(null)
  const needsApproval = useNeedsApproval()
  const approvals = useStore((s) => s.approvals)
  /** Pending request on a record → show it instead of offering the action again. */
  const pendingOn = (entityId: string) => approvals.find((a) => a.entityId === entityId)
  const [draft, setDraft] = React.useState<Editable | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setParams(tab === 'profile' ? {} : { tab }, { replace: true })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tenant) {
    return (
      <Card>
        <EmptyState icon={AlertTriangle} title="Penyewa tidak ditemukan" description="Data mungkin sudah dihapus atau di luar akses Anda."
          action={<Button onClick={() => navigate('/tenants')}>Kembali ke daftar penyewa</Button>} />
      </Card>
    )
  }

  const status = lookups.tenantStatus(tenant.id)
  const statusMeta = TENANT_STATUSES.find((s) => s.value === status)!
  const totalDue = sum(tenantInvoices.filter((i) => i.dueDate <= today), (i) => outstanding(i))
  const totalPaid = sum(tenantPayments.filter((p) => p.amount > 0 && (p.kind === 'rent' || p.kind === 'dp')), (p) => p.amount)
  const depositHeld = sum(tenantPayments.filter((p) => p.kind === 'deposit'), (p) => p.amount)
  const avgSettle = averageSettlementDays(tenantInvoices, payments)

  const startEdit = () => { setDraft(editableOf(tenant)); setEditing(true) }
  const requestEdit = () => (rental ? setEditWarnOpen(true) : startEdit())

  const saveDraft = async () => {
    if (!draft) return
    if (draft.name.trim().length < 2) return toast({ title: 'Nama wajib diisi', variant: 'error' })
    setSaving(true)
    const ok = await run(() => actions.updateTenant(tenant.id, draft), { success: 'Data penyewa diperbarui' })
    setSaving(false)
    if (ok) setEditing(false)
  }

  const downloadInvoice = (invoiceId: string) => {
    const inv = tenantInvoices.find((i) => i.id === invoiceId)!
    const prop = properties.find((p) => p.id === inv.propertyId)
    exportInvoicePDF({
      invoiceNumber: inv.number,
      propertyName: prop?.name ?? '-',
      propertyAddress: prop ? formatAddress(prop.address) : '-',
      tenantName: tenant.name,
      roomName: lookups.roomName(inv.roomId),
      periodLabel: `${formatDate(inv.periodStart)} — ${formatDate(inv.periodEnd)}`,
      dueDate: formatDate(inv.dueDate, 'long'),
      items: inv.lateFee > 0 ? [...inv.items, { name: 'Denda keterlambatan', amount: inv.lateFee }] : inv.items,
      total: inv.total,
      paid: inv.paidAmount,
      note: [prop?.paymentInfo, prop?.invoicePdf.note].filter(Boolean).join('\n'),
      textColor: prop?.invoicePdf.textColor,
      labelColor: prop?.invoicePdf.labelColor,
      fontSize: prop?.invoicePdf.fontSize,
    })
  }

  const current: Editable = editing && draft ? draft : editableOf(tenant)
  const patch = (p: Partial<Editable>) => setDraft((d) => (d ? { ...d, ...p } : d))

  return (
    <>
      <PageHeader
        title={tenant.name}
        breadcrumb={[{ label: 'Penyewa', to: '/tenants' }, { label: tenant.name }]}
        actions={
          editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /> Batal</Button>
              <Button onClick={saveDraft} loading={saving}><Save className="h-4 w-4" /> Simpan</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={requestEdit}><Pencil className="h-4 w-4" /> Edit</Button>
              {rental?.status === 'active' && <Button variant="outline" onClick={() => setCheckoutOpen(true)}>Akhiri sewa</Button>}
              {!rental && <Button onClick={() => setRentalOpen(true)}><Plus className="h-4 w-4" /> Mulai sewa</Button>}
              {tenant.phone && (
                <a href={waMeLink(tenant.phone)} target="_blank" rel="noreferrer"><Button variant="outline"><MessageCircle className="h-4 w-4" /> WhatsApp</Button></a>
              )}
            </>
          )
        }
      />

      {rental?.status === 'booked' && <BookingBanner rental={rental} onPay={() => setPay({})} onCancel={() => setCancelOpen(true)} />}
      {lapsedPending && <LapsedBanner rental={lapsedPending} />}

      <Card className="mb-6">
        <div className="p-5 flex flex-wrap items-center gap-5">
          <Avatar name={tenant.name} color={tenant.avatarColor} size="xl" />
          <div className="min-w-0 flex-1 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KeyValue label="Status" value={<Badge tone={statusMeta.tone as 'success'}>{statusMeta.label}</Badge>} />
            <KeyValue label="Kamar" value={rental ? lookups.roomName(rental.roomId) : '—'} />
            <KeyValue label="Properti" value={rental ? lookups.propertyName(rental.propertyId) : tenant.waitlistPropertyId ? lookups.propertyName(tenant.waitlistPropertyId) : '—'} />
            <KeyValue label="Tunggakan" value={totalDue > 0 ? <span className="text-danger">{formatIDR(totalDue)}</span> : <span className="text-success">Tidak ada</span>} />
          </div>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: 'profile', label: 'Profil' },
          { value: 'rental', label: 'Sewa' },
          { value: 'billing', label: 'Tagihan', badge: <Badge tone={totalDue > 0 ? 'danger' : 'muted'}>{tenantInvoices.filter((i) => i.status !== 'batal').length}</Badge> },
          { value: 'contract', label: 'Perjanjian' },
          { value: 'documents', label: 'Dokumen' },
        ]}
      />

      {tab === 'profile' && (
        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Informasi penyewa</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <Field label="Nama" required className="sm:col-span-2">
                <Input disabled={!editing} value={current.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="NIK">
                <Input disabled={!editing} value={current.idNumber} inputMode="numeric" maxLength={16} onChange={(e) => patch({ idNumber: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="Jenis kelamin">
                <Select disabled={!editing} value={current.gender} onChange={(v) => patch({ gender: v as Tenant['gender'] })} options={GENDERS} placeholder="—" />
              </Field>
              <Field label="Tanggal lahir" hint="Ucapan ulang tahun dikirim otomatis via WhatsApp.">
                <DateInput disabled={!editing} value={current.dob} onChange={(v) => patch({ dob: v })} />
              </Field>
              <Field label="Status pernikahan">
                <Select disabled={!editing} value={current.maritalStatus} onChange={(v) => patch({ maritalStatus: v as Tenant['maritalStatus'] })} options={MARITAL_STATUSES} placeholder="—" />
              </Field>
              <Field label="Kontak darurat">
                <Input disabled={!editing} value={current.emergencyContact} onChange={(e) => patch({ emergencyContact: e.target.value })} />
              </Field>
              <Field label="Pekerjaan">
                <Input disabled={!editing} value={current.job} onChange={(e) => patch({ job: e.target.value })} />
              </Field>
              <Field label="Nomor plat kendaraan">
                <Input disabled={!editing} value={current.vehiclePlate} onChange={(e) => patch({ vehiclePlate: e.target.value })} />
              </Field>
              <Field label="Catatan saat masuk">
                <Textarea disabled={!editing} value={current.checkInNote} onChange={(e) => patch({ checkInNote: e.target.value })} className="min-h-[70px]" />
              </Field>
              <Field label="Catatan saat keluar">
                <Textarea disabled={!editing} value={current.checkOutNote} onChange={(e) => patch({ checkOutNote: e.target.value })} className="min-h-[70px]" />
              </Field>
            </CardContent>

            <div className="px-5 pb-5">
              <Divider label="Kontak" />
              <p className="text-xs text-muted-foreground mb-3">Kontak pertama adalah nomor WhatsApp utama — perjanjian, tagihan, dan pengingat dikirim ke nomor ini.</p>
              <div className="space-y-4">
                {current.contacts.map((c, i) => (
                  <div key={c.id} className="grid sm:grid-cols-3 gap-3 rounded-lg border border-border p-3.5">
                    <Field label={i === 0 ? 'Nama (utama)' : 'Nama'}>
                      <Input disabled={!editing} value={c.name}
                        onChange={(e) => patch({ contacts: current.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    </Field>
                    <Field label="Email">
                      <Input disabled={!editing} value={c.email}
                        onChange={(e) => patch({ contacts: current.contacts.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} />
                    </Field>
                    <Field label="WhatsApp">
                      <PhoneInput disabled={!editing} value={c.phone}
                        onChange={(v) => patch({ contacts: current.contacts.map((x, j) => (j === i ? { ...x, phone: v } : x)) })} />
                    </Field>
                  </div>
                ))}
                {editing && (
                  <Button variant="outline" size="sm" onClick={() => patch({ contacts: [...current.contacts, { id: uid('ct'), name: '', email: '', phone: '+62' }] })}>
                    <Plus className="h-3.5 w-3.5" /> Tambahkan kontak
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Ringkasan keuangan</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <SumRow label="Total dibayar" value={formatIDR(totalPaid)} tone="success" />
                <SumRow label="Tunggakan" value={formatIDR(totalDue)} tone={totalDue > 0 ? 'danger' : undefined} />
                <SumRow label="Uang jaminan dipegang" value={formatIDR(depositHeld)} tone="info" />
                <SumRow label="Waktu pelunasan" value={settlementLabel(avgSettle)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Aksi</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start" onClick={() => setPay({})} disabled={!rental}>
                  <Banknote className="h-4 w-4" /> Catat pembayaran
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => navigate(`/chat?property=${rental?.propertyId ?? ''}&phone=${tenant.phone}`)}>
                  <MessageCircle className="h-4 w-4" /> Buka percakapan WhatsApp
                </Button>
                {canDelete && (pendingOn(tenant.id)?.kind === 'delete' ? (
                  <Button variant="outline" className="w-full justify-start" disabled>
                    <Trash2 className="h-4 w-4" /> Penghapusan menunggu persetujuan
                  </Button>
                ) : (
                  <Tooltip content={rental ? 'Akhiri atau batalkan sewa terlebih dahulu' : 'Pindahkan ke tempat sampah'}>
                    <Button variant="danger" className="w-full justify-start" onClick={() => setDeleteOpen(true)} disabled={Boolean(rental)}>
                      <Trash2 className="h-4 w-4" /> Hapus penyewa
                    </Button>
                  </Tooltip>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'rental' && (
        <div className="space-y-4">
          {tenantRentals.length === 0 ? (
            <Card>
              <EmptyState icon={FileText} title="Belum ada sewa" description="Penyewa ini masih di daftar tunggu."
                action={<Button onClick={() => setRentalOpen(true)}><Plus className="h-4 w-4" /> Mulai sewa</Button>} />
            </Card>
          ) : tenantRentals.map((r) => {
            const st = RENTAL_STATUSES.find((s) => s.value === r.status)!
            return (
              <Card key={r.id}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle>{lookups.roomName(r.roomId)} · {lookups.propertyName(r.propertyId)}</CardTitle>
                  <Badge tone={st.tone as 'success'}>{st.label}</Badge>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <KeyValue label="Masuk" value={formatDate(r.startDate, 'long')} />
                    <KeyValue label="Selesai" value={r.endDate ? formatDate(r.endDate, 'long') : 'Tidak ditentukan'} />
                    <KeyValue label="Harga" value={`${formatIDR(r.price)} / ${rentTypeLabel(r.rentType).toLowerCase()}`} />
                    <KeyValue label="Tanggal tagihan" value={`Setiap tanggal ${r.billingDay}`} />
                    <KeyValue label="Uang jaminan" value={<>{formatIDR(r.deposit.amount)} {r.deposit.amount > 0 && <Badge tone={r.deposit.paid ? 'success' : 'warning'} className="ml-1">{r.deposit.paid ? 'Diterima' : 'Belum'}</Badge>}</>} />
                    <KeyValue label="DP" value={r.downPayment.amount > 0 ? formatIDR(r.downPayment.amount) : '—'} />
                    {r.paymentDeadline && <KeyValue label="Batas pelunasan" value={formatDate(r.paymentDeadline, 'long')} />}
                    {r.lapseResolution && <KeyValue label="Nasib DP" value={r.lapseResolution === 'forfeit' ? 'Hangus' : r.lapseResolution === 'refund' ? 'Dikembalikan' : 'Belum diputuskan'} />}
                  </div>
                  {r.serviceIds.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {r.serviceIds.map((sid) => {
                        const svc = services.find((s) => s.id === sid)
                        return svc ? <Badge key={sid} tone="info">{svc.name} · {formatIDR(servicePriceFor(svc, r.rentType))}</Badge> : null
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {tab === 'billing' && (
        <Card>
          <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-b border-border">
            <div className="flex flex-wrap gap-6">
              <KeyValue label="Tunggakan" value={<span className={totalDue > 0 ? 'text-danger' : ''}>{formatIDR(totalDue)}</span>} />
              <KeyValue label="Total dibayar" value={formatIDR(totalPaid)} />
              <KeyValue label="Waktu pelunasan" value={settlementLabel(avgSettle)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setInvoiceOpen(true)} disabled={!rental}><Plus className="h-4 w-4" /> Tagihan manual</Button>
              <Button onClick={() => setPay({})} disabled={!rental}><Banknote className="h-4 w-4" /> Catat bayar</Button>
            </div>
          </div>

          {tenantInvoices.length === 0 ? (
            <EmptyState icon={FileText} title="Belum ada tagihan" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Faktur</Th><Th>Periode</Th><Th>Jatuh tempo</Th><Th align="right">Total</Th><Th>Status</Th><Th align="center">Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {tenantInvoices.map((inv) => {
                  const rest = outstanding(inv)
                  const st = INVOICE_STATUSES.find((s) => s.value === inv.status)!
                  const invPayments = payments.filter((p) => p.invoiceId === inv.id)
                  const expanded = expandedInvoice === inv.id
                  const late = rest > 0 && inv.dueDate < today
                  return (
                    <React.Fragment key={inv.id}>
                      <Tr className={cn(inv.status === 'batal' && 'opacity-60')}>
                        <Td className="font-mono text-xs font-bold whitespace-nowrap">{inv.number}{inv.isFirst && <Badge tone="muted" className="ml-2">pertama</Badge>}</Td>
                        <Td className="text-xs whitespace-nowrap">{formatDate(inv.periodStart)} — {formatDate(inv.periodEnd)}</Td>
                        <Td className={cn('text-sm whitespace-nowrap', late && 'text-danger font-semibold')}>{formatDate(inv.dueDate)}</Td>
                        <Td align="right" className="whitespace-nowrap">
                          <p className="font-bold tabular-nums">{formatIDR(inv.total)}</p>
                          {inv.lateFee > 0 && <p className="text-[11px] text-danger">termasuk denda {formatIDR(inv.lateFee)}</p>}
                          {rest > 0 && inv.paidAmount > 0 && <p className="text-[11px] text-muted-foreground">sisa {formatIDR(rest)}</p>}
                        </Td>
                        <Td><Badge tone={st.tone as 'success'}>{st.label}</Badge></Td>
                        <Td align="center">
                          <div className="flex items-center justify-center gap-0.5">
                            {rest > 0 && (
                              <Tooltip content="Catat pembayaran">
                                <Button size="icon" variant="ghost" onClick={() => setPay({ invoiceId: inv.id })} aria-label="Bayar"><Banknote className="h-4 w-4" /></Button>
                              </Tooltip>
                            )}
                            <Tooltip content="Unduh PDF">
                              <Button size="icon" variant="ghost" onClick={() => downloadInvoice(inv.id)} aria-label="Unduh"><Download className="h-4 w-4" /></Button>
                            </Tooltip>
                            {inv.status !== 'batal' && (
                              <Tooltip content="Kirim via WhatsApp">
                                <Button size="icon" variant="ghost" aria-label="Kirim WhatsApp"
                                  onClick={() => void run(() => actions.sendInvoice(inv.id), { success: `Faktur ${inv.number} dikirim ke WhatsApp` })}>
                                  <MessageCircle className="h-4 w-4" />
                                </Button>
                              </Tooltip>
                            )}
                            <Tooltip content="Riwayat pembayaran">
                              <Button size="icon" variant="ghost" aria-label="Pembayaran" onClick={() => setExpandedInvoice(expanded ? null : inv.id)}>
                                <Wallet className={cn('h-4 w-4', expanded && 'text-primary')} />
                              </Button>
                            </Tooltip>
                            {inv.status !== 'batal' && inv.paidAmount === 0 && (pendingOn(inv.id) ? (
                              <Tooltip content={`Menunggu persetujuan: ${pendingOn(inv.id)!.label}`}>
                                <Badge tone="warning">Menunggu persetujuan</Badge>
                              </Tooltip>
                            ) : (
                              <Tooltip content="Batalkan faktur">
                                <Button size="icon" variant="ghost" aria-label="Batalkan faktur" onClick={() => setVoidTarget(inv)}>
                                  <Ban className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </Tooltip>
                            ))}
                          </div>
                        </Td>
                      </Tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6} className="bg-muted/40 px-4 py-4 border-b border-border">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Pembayaran</p>
                            {invPayments.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Belum ada pembayaran.</p>
                            ) : (
                              <div className="space-y-2">
                                {invPayments.map((p) => (
                                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface border border-border px-3.5 py-2.5">
                                    <div className="min-w-0">
                                      <p className="font-mono text-xs font-bold truncate">{p.transactionId}{p.kind === 'dp' && <Badge tone="warning" className="ml-2">DP</Badge>}</p>
                                      <p className="text-[11px] text-muted-foreground mt-0.5">
                                        {formatDate(p.date, 'long')} · {p.method === 'cash' ? 'Tunai' : 'Transfer'} · dicatat {p.createdByName}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {p.attachment && (
                                        <a href={fileUrl(p.attachment)} target="_blank" rel="noreferrer">
                                          <Button size="icon" variant="ghost" aria-label="Bukti bayar"><Paperclip className="h-3.5 w-3.5" /></Button>
                                        </a>
                                      )}
                                      <span className="font-bold tabular-nums text-success mx-1">{formatIDR(p.amount)}</span>
                                      {canDelete && (pendingOn(p.id) ? (
                                        <Badge tone="warning">Menunggu persetujuan hapus</Badge>
                                      ) : (
                                        <Button size="icon" variant="ghost" aria-label="Hapus pembayaran" onClick={() => setPaymentToDelete(p)}>
                                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                                        </Button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'contract' && <ContractPanel tenant={tenant} />}
      {tab === 'documents' && <DocumentsPanel tenantId={tenant.id} />}

      <ConfirmDialog
        open={editWarnOpen}
        onClose={() => setEditWarnOpen(false)}
        onConfirm={startEdit}
        tone="primary"
        title="Sewa sedang berjalan"
        confirmLabel="Ya, lanjutkan"
        message="Perubahan data tidak mengubah perjanjian yang sudah dikirim. Jika data penting berubah (nama, NIK), buat ulang perjanjian di tab Perjanjian."
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async (reason) => {
          const ok = await run(() => actions.deleteTenant(tenant.id, reason), { success: `${tenant.name} dipindahkan ke tempat sampah` })
          if (ok && !isPending(ok)) navigate('/tenants')
        }}
        approval={needsApproval}
        title="Hapus penyewa?"
        confirmLabel="Hapus"
        message={`${tenant.name} beserta dokumennya dipindahkan ke tempat sampah. Riwayat tagihan dan pembayaran tetap tersimpan untuk laporan, dan superadmin dapat memulihkannya.`}
      />
      <ConfirmDialog
        open={Boolean(paymentToDelete)}
        onClose={() => setPaymentToDelete(null)}
        onConfirm={(reason) => paymentToDelete && void run(() => actions.deletePayment(paymentToDelete.id, reason), { success: 'Pembayaran dihapus' })}
        approval={needsApproval}
        title="Hapus pembayaran?"
        confirmLabel="Hapus"
        message={`Pembayaran ${paymentToDelete ? formatIDR(paymentToDelete.amount) : ''} dihapus dan status tagihan dihitung ulang. Dapat dipulihkan dari tempat sampah.`}
      />
      <ConfirmDialog
        open={Boolean(voidTarget)}
        onClose={() => setVoidTarget(null)}
        onConfirm={(reason) => voidTarget && void run(() => actions.voidInvoice(voidTarget.id, reason), { success: `Faktur ${voidTarget.number} dibatalkan` })}
        approval={needsApproval}
        title="Batalkan faktur?"
        confirmLabel="Batalkan faktur"
        message={`Faktur ${voidTarget?.number ?? ''} (${voidTarget ? formatIDR(voidTarget.total) : ''}) tidak lagi ditagihkan dan tidak masuk laporan pendapatan.`}
      />
      <PaymentModal open={Boolean(pay)} onClose={() => setPay(null)} presetTenantId={tenant.id} presetInvoiceId={pay?.invoiceId} />
      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} presetTenantId={tenant.id} />
      {rental?.status === 'booked' && <CancelBookingModal rental={rental} open={cancelOpen} onClose={() => setCancelOpen(false)} />}
      <RentalFormModal open={rentalOpen} onClose={() => setRentalOpen(false)} tenant={tenant} />
      <InvoiceFormModal open={invoiceOpen} onClose={() => setInvoiceOpen(false)} tenantId={tenant.id} />
    </>
  )
}

function SumRow({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' | 'info' }) {
  const tones = { success: 'text-success', danger: 'text-danger', info: 'text-info' }
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-bold tabular-nums', tone && tones[tone])}>{value}</span>
    </div>
  )
}

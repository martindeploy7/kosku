import * as React from 'react'
import { CheckCircle2, Info, Paperclip, X } from 'lucide-react'
import {
  Badge, Button, Checkbox, CurrencyInput, DateInput, Divider, Field, Modal, Select, Textarea,
} from '@/components/ui'
import { KeyValue } from '@/components/shared'
import { actions } from '@/lib/actions'
import { fileUrl } from '@/lib/api'
import { INVOICE_STATUSES } from '@/lib/constants'
import { amountDueOn, isCurrentRental, outstanding } from '@/lib/finance'
import { useLookups } from '@/lib/selectors'
import { useStore } from '@/lib/store'
import type { PaymentMethod } from '@/lib/types'
import { cn, formatDate, formatIDR } from '@/lib/utils'

export function PaymentModal({
  open, onClose, presetTenantId, presetInvoiceId, presetProofFileId,
}: {
  open: boolean
  onClose: () => void
  presetTenantId?: string
  presetInvoiceId?: string
  /** A photo/PDF the tenant sent on WhatsApp, already stored — attached as the proof. */
  presetProofFileId?: string
}) {
  const tenants = useStore((s) => s.tenants)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const rentals = useStore((s) => s.rentals)
  const properties = useStore((s) => s.properties)
  const settings = useStore((s) => s.settings)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const lookups = useLookups()

  const [tenantId, setTenantId] = React.useState(presetTenantId ?? '')
  const [invoiceId, setInvoiceId] = React.useState(presetInvoiceId ?? '')
  const [method, setMethod] = React.useState<PaymentMethod | ''>('')
  const [amount, setAmount] = React.useState(0)
  const [date, setDate] = React.useState(today)
  const [note, setNote] = React.useState('')
  const [proof, setProof] = React.useState<File | null>(null)
  const [proofFileId, setProofFileId] = React.useState<string | null>(presetProofFileId ?? null)
  const [sendReceipt, setSendReceipt] = React.useState(settings.notifications.paymentReceipt)
  const [saving, setSaving] = React.useState(false)

  const openInvoicesOf = React.useCallback(
    (tid: string) => invoices
      .filter((i) => i.tenantId === tid && outstanding(i) > 0)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    [invoices],
  )

  React.useEffect(() => {
    if (!open) return
    setTenantId(presetTenantId ?? '')
    // Default to the oldest unpaid invoice — that is what gets settled first.
    setInvoiceId(presetInvoiceId ?? (presetTenantId ? openInvoicesOf(presetTenantId)[0]?.id ?? '' : ''))
    setMethod('')
    setDate(today)
    setNote('')
    setProof(null)
    setProofFileId(presetProofFileId ?? null)
    setSendReceipt(settings.notifications.paymentReceipt)
  }, [open, presetTenantId, presetInvoiceId, presetProofFileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const payableTenants = tenants.filter((t) => rentals.some((r) => r.tenantId === t.id && isCurrentRental(r)))

  const tenantInvoices = React.useMemo(
    () => invoices
      .filter((i) => i.tenantId === tenantId && i.status !== 'batal')
      .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)),
    [invoices, tenantId],
  )

  const invoice = tenantInvoices.find((i) => i.id === invoiceId)
  const rental = invoice ? rentals.find((r) => r.id === invoice.rentalId) : rentals.find((r) => r.tenantId === tenantId && isCurrentRental(r))
  const property = rental ? properties.find((p) => p.id === rental.propertyId) : undefined

  // Owed as of the chosen payment date (a backdated on-time payment carries no late fee).
  const due = React.useMemo(() => {
    if (!invoice || !property || !rental) return 0
    const lines = payments.filter((p) => p.invoiceId === invoice.id).map((p) => ({ date: p.date, amount: p.amount }))
    return amountDueOn(invoice, lines, rental.status, property.lateFee, date)
  }, [invoice, property, rental, payments, date])

  React.useEffect(() => {
    setAmount(due)
  }, [due])

  const methodOptions = React.useMemo(() => {
    const opts: { value: string; label: string }[] = []
    if (!property || property.paymentMethods.cash) opts.push({ value: 'cash', label: 'Tunai (Cash)' })
    if (!property || property.paymentMethods.transfer) opts.push({ value: 'transfer', label: 'Transfer Bank' })
    return opts
  }, [property])

  React.useEffect(() => {
    if (methodOptions.length === 1) setMethod(methodOptions[0].value as PaymentMethod)
  }, [methodOptions])

  const submit = async () => {
    if (!invoice || !method || amount <= 0) return
    setSaving(true)
    const payment = await run(() => actions.addPayment({
      invoiceId: invoice.id, tenantId: invoice.tenantId, date, method: method as PaymentMethod, amount, note,
      kind: 'rent', sendReceipt, attachment: proofFileId,
    }), { refresh: false })
    if (payment && proof && !proofFileId) {
      await run(() => actions.uploadFile(proof, 'payment', payment.id, 'bukti_bayar'), { refresh: false })
    }
    if (payment) {
      await useStore.getState().refresh()
      const activated = rental?.status === 'booked' && amount >= due
      toast({
        title: activated ? 'Lunas — kamar kini Terisi' : 'Pembayaran tercatat',
        description: `${formatIDR(amount)} untuk faktur ${invoice.number}.${sendReceipt ? ' Kuitansi dikirim via WhatsApp.' : ''}`,
        variant: 'success',
      })
      onClose()
    }
    setSaving(false)
  }

  const arrears = tenantInvoices.reduce((a, i) => a + (i.dueDate <= today ? outstanding(i) : 0), 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat pembayaran"
      description="Pilih penyewa dan tagihan yang dibayar."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving} disabled={!invoice || !method || amount <= 0 || amount > due}>
            Simpan pembayaran
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Penyewa" required>
          <Select
            value={tenantId}
            onChange={(v) => { setTenantId(v); setInvoiceId(openInvoicesOf(v)[0]?.id ?? '') }}
            placeholder="Pilih penyewa"
            options={payableTenants.map((t) => {
              const r = lookups.activeRental(t.id)
              return { value: t.id, label: `${t.name} — ${lookups.roomName(r?.roomId ?? null)}${r?.status === 'booked' ? ' (DP)' : ''}` }
            })}
          />
        </Field>

        {tenantId && rental && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <KeyValue label="Kamar" value={lookups.roomName(rental.roomId)} />
            <KeyValue label="Properti" value={lookups.propertyName(rental.propertyId)} />
            <KeyValue label="Sewa / periode" value={formatIDR(rental.price)} />
            <KeyValue label="Tunggakan" value={<span className={arrears ? 'text-danger' : ''}>{formatIDR(arrears)}</span>} />
          </div>
        )}

        {rental?.status === 'booked' && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-3.5 flex gap-2.5">
            <Info className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed">
              Pelunasan pemesanan DP — batas <strong>{formatDate(rental.paymentDeadline, 'long')}</strong>. Setelah tagihan ini
              lunas, status kamar otomatis menjadi <strong>Terisi · Lunas</strong>.
            </p>
          </div>
        )}

        {tenantId && (
          <Field label="Tagihan" required>
            {tenantInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3">Penyewa ini belum memiliki tagihan.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {tenantInvoices.map((inv) => {
                  const rest = outstanding(inv)
                  const st = INVOICE_STATUSES.find((s) => s.value === inv.status)!
                  const selected = invoiceId === inv.id
                  const late = rest > 0 && inv.dueDate < today
                  return (
                    <button
                      key={inv.id}
                      onClick={() => setInvoiceId(inv.id)}
                      disabled={rest <= 0}
                      className={cn(
                        'w-full text-left rounded-md border p-3 transition focus-ring',
                        selected ? 'border-primary bg-primary-soft/60' : 'border-border hover:border-primary/40',
                        rest <= 0 && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-bold truncate">{inv.number}</p>
                          <p className={cn('text-[11px] mt-0.5', late ? 'text-danger font-semibold' : 'text-muted-foreground')}>
                            Jatuh tempo {formatDate(inv.dueDate)}{inv.lateFee > 0 && ` · denda ${formatIDR(inv.lateFee)}`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-sm tabular-nums">{rest > 0 ? formatIDR(rest) : formatIDR(inv.total)}</p>
                          <Badge tone={st.tone as 'success'} className="mt-1">{st.label}</Badge>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Field>
        )}

        {invoice && (
          <>
            <Divider />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Metode pembayaran" required hint={methodOptions.length < 2 ? 'Mengikuti pengaturan properti.' : undefined}>
                <Select value={method} onChange={(v) => setMethod(v as PaymentMethod)} placeholder="Pilih metode" options={methodOptions} />
              </Field>
              <Field label="Tanggal pembayaran" required hint="Isi tanggal uang diterima — denda dihitung per tanggal ini.">
                <DateInput value={date} onChange={setDate} max={today} />
              </Field>
              <Field label="Jumlah dibayar" required hint={amount !== due ? `Sisa per ${formatDate(date)}: ${formatIDR(due)}` : undefined}
                error={amount > due ? `Melebihi sisa tagihan (${formatIDR(due)})` : undefined}>
                <CurrencyInput value={amount} onChange={setAmount} />
              </Field>
              <Field label="Bukti pembayaran">
                {proofFileId ? (
                  <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-success/40 bg-success-soft/40 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    <a href={fileUrl(proofFileId)} target="_blank" rel="noreferrer" className="truncate flex-1 underline-offset-2 hover:underline">
                      Kiriman WhatsApp penyewa
                    </a>
                    <button onClick={() => setProofFileId(null)} aria-label="Lepas lampiran" className="p-1 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : proof ? (
                  <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    <span className="truncate flex-1">{proof.name}</span>
                    <button onClick={() => setProof(null)} aria-label="Hapus lampiran" className="p-1 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 h-10 px-3 rounded-md border border-dashed border-input cursor-pointer hover:border-primary/50 transition text-sm text-muted-foreground">
                    <Paperclip className="h-4 w-4" /> Foto / PDF (opsional)
                    <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
                  </label>
                )}
              </Field>
              <Field label="Catatan" className="sm:col-span-2">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="min-h-[70px]" />
              </Field>
            </div>

            <Checkbox checked={sendReceipt} onChange={setSendReceipt} label="Kirim kuitansi ke WhatsApp penyewa" />

            {amount > 0 && amount < due && (
              <div className="rounded-lg border border-info/30 bg-info-soft p-3.5 flex items-start gap-2.5">
                <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  Pembayaran sebagian. Sisa <strong>{formatIDR(due - amount)}</strong> tetap tercatat sebagai tagihan.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

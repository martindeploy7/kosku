import * as React from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Check } from 'lucide-react'
import {
  Badge, Button, Checkbox, CurrencyInput, DateInput, Field, Modal, Progress, Select, Textarea,
} from '@/components/ui'
import { KeyValue } from '@/components/shared'
import { outstanding } from '@/lib/finance'
import { useLookups } from '@/lib/selectors'
import { actions } from '@/lib/actions'
import { useStore } from '@/lib/store'
import { addDays, formatDate, formatIDR } from '@/lib/utils'

const STEPS = ['Pilih penyewa', 'Tanggal keluar', 'Uang jaminan', 'Konfirmasi']

export function CheckoutModal({
  open, onClose, presetTenantId,
}: {
  open: boolean
  onClose: () => void
  presetTenantId?: string
}) {
  const tenants = useStore((s) => s.tenants)
  const rentals = useStore((s) => s.rentals)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const today = useStore((s) => s.today)
  const run = useStore((s) => s.run)
  const lookups = useLookups()
  const [saving, setSaving] = React.useState(false)

  const [step, setStep] = React.useState(0)
  const [tenantId, setTenantId] = React.useState(presetTenantId ?? '')
  const [endDate, setEndDate] = React.useState(today)
  const [refund, setRefund] = React.useState(0)
  const [convert, setConvert] = React.useState(false)
  const [note, setNote] = React.useState('')

  const rental = rentals.find((r) => r.tenantId === tenantId && r.status === 'active')
  const tenant = tenants.find((t) => t.id === tenantId)

  React.useEffect(() => {
    if (!open) return
    setStep(presetTenantId ? 1 : 0)
    setTenantId(presetTenantId ?? '')
    setEndDate(today)
    setRefund(0)
    setConvert(false)
    setNote('')
  }, [open, presetTenantId])

  // Deposit actually held for this lease (receipts minus any earlier refunds).
  const depositAmount = rental
    ? Math.max(0, payments.filter((p) => p.rentalId === rental.id && p.kind === 'deposit').reduce((a, p) => a + p.amount, 0))
    : 0

  // A lease ends at the earliest the day after it started (the server rejects a zero-day lease).
  const minEnd = rental ? addDays(rental.startDate, 1) : today
  const endTooEarly = Boolean(rental) && endDate < minEnd

  React.useEffect(() => {
    if (!rental) return
    setRefund(depositAmount)
    setEndDate(today < minEnd ? minEnd : today)
  }, [rental?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // DP bookings are cancelled, not checked out.
  const activeRentals = rentals.filter((r) => r.status === 'active')
  const unpaid = rental
    ? invoices
        .filter((i) => i.rentalId === rental.id && i.periodStart < endDate)
        .reduce((a, i) => a + outstanding(i), 0)
    : 0

  const remainder = Math.max(0, depositAmount - refund)

  const finish = async () => {
    if (!rental) return
    setSaving(true)
    const ok = await run(
      () => actions.endRental(rental.id, { endDate, refundAmount: refund, convertToIncome: convert, note, checkOutNote: note }),
      { success: `Sewa ${tenant?.name ?? ''} berakhir ${formatDate(endDate)} — kamar tersedia kembali` },
    )
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Akhiri perjanjian penyewa"
      description="Proses check-out penyewa aktif beserta penyelesaian uang jaminan."
      size="lg"
      footer={
        <>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" /> Kembali
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={(step === 0 && !rental) || (step === 1 && endTooEarly)} onClick={() => setStep((s) => s + 1)}>
              Selanjutnya <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="danger" onClick={finish} loading={saving}>
              <Check className="h-4 w-4" /> Akhiri sewa
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold">{STEPS[step]}</span>
            <span className="text-muted-foreground tabular-nums">Langkah {step + 1} dari {STEPS.length}</span>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} />
        </div>

        {step === 0 && (
          <Field label="Cari penyewa dan kamar" required>
            <Select
              value={tenantId}
              onChange={setTenantId}
              placeholder="Pilih penyewa aktif"
              options={activeRentals.map((r) => ({
                value: r.tenantId,
                label: `${lookups.tenantName(r.tenantId)} — ${lookups.roomName(r.roomId)} (${lookups.propertyName(r.propertyId)})`,
              }))}
            />
          </Field>
        )}

        {step >= 1 && rental && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <KeyValue label="Penyewa" value={tenant?.name ?? '-'} />
            <KeyValue label="Kamar" value={lookups.roomName(rental.roomId)} />
            <KeyValue label="Mulai sewa" value={formatDate(rental.startDate)} />
            <KeyValue label="Uang jaminan" value={formatIDR(depositAmount)} />
          </div>
        )}

        {step === 1 && (
          <>
            <Field label="Tanggal keluar" required hint="Faktur terjadwal setelah tanggal ini akan dibatalkan otomatis."
              error={endTooEarly ? `Paling cepat ${formatDate(minEnd)} (sehari setelah mulai sewa).` : undefined}>
              <DateInput value={endDate} onChange={setEndDate} min={minEnd} />
            </Field>
            {unpaid > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 flex items-start gap-3">
                <AlertTriangle className="h-4.5 w-4.5 text-warning shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">Masih ada tunggakan {formatIDR(unpaid)}</p>
                  <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
                    Pertimbangkan memotong tunggakan dari uang jaminan pada langkah berikutnya.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <Field label="Nominal dikembalikan ke penyewa" hint={`Maksimum ${formatIDR(depositAmount)}`}>
              <CurrencyInput value={refund} onChange={(v) => setRefund(Math.min(v, depositAmount))} />
            </Field>
            {unpaid > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefund(Math.max(0, depositAmount - unpaid))}
              >
                Potong tunggakan {formatIDR(unpaid)}
              </Button>
            )}
            {remainder > 0 && (
              <div className="rounded-lg border border-border p-4 space-y-2">
                <Checkbox
                  checked={convert}
                  onChange={setConvert}
                  label="Terima sisa sebagai pendapatan"
                  description={`Sisa uang jaminan ${formatIDR(remainder)} akan dikonversi menjadi pendapatan bisnis dan saldo jaminan menjadi nol.`}
                />
              </div>
            )}
            <Field label="Catatan saat keluar">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kondisi kamar saat check-out, kerusakan, dll." />
            </Field>
          </>
        )}

        {step === 3 && rental && (
          <div className="space-y-4">
            <div className="rounded-lg border border-danger/30 bg-danger-soft p-4 flex items-start gap-3">
              <AlertTriangle className="h-4.5 w-4.5 text-danger shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-danger">Tindakan ini mengakhiri sewa aktif</p>
                <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
                  Kamar akan kembali berstatus tersedia dan faktur yang belum dibayar setelah tanggal keluar dibatalkan.
                </p>
              </div>
            </div>
            <dl className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {[
                ['Penyewa', tenant?.name ?? '-'],
                ['Kamar', `${lookups.roomName(rental.roomId)} · ${lookups.propertyName(rental.propertyId)}`],
                ['Tanggal keluar', formatDate(endDate)],
                ['Tunggakan tersisa', formatIDR(unpaid)],
                ['Dikembalikan', formatIDR(refund)],
                ['Sisa jaminan', convert ? `${formatIDR(remainder)} → pendapatan` : formatIDR(remainder)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-semibold text-right">{v}</dd>
                </div>
              ))}
            </dl>
            {convert && <Badge tone="warning">Sisa jaminan dikonversi jadi pendapatan</Badge>}
          </div>
        )}
      </div>
    </Modal>
  )
}

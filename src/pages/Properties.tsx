import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, DoorOpen, MapPin, MessageCircle, Pencil, Phone, Plus } from 'lucide-react'
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PhoneInput, SearchInput,
} from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { AddressFields, LocationPicker, formatAddress, isAddressComplete } from '@/components/shared/AddressForm'
import { RoomFormModal } from '@/components/modals/FormModals'
import { useLookups } from '@/lib/selectors'
import { actions } from '@/lib/actions'
import { isCurrentRental, isOccupiedStatus } from '@/lib/finance'
import { useCanManage, useStore } from '@/lib/store'
import type { Address } from '@/lib/types'
import { formatIDR, formatPhoneDisplay } from '@/lib/utils'


const emptyAddress: Address = {
  street: '', postcode: '', province: '', city: '', district: '', subdistrict: '',
  lat: -6.2088, lng: 106.8456,
}

export default function Properties() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const properties = useStore((s) => s.properties)
  const rooms = useStore((s) => s.rooms)
  const rentals = useStore((s) => s.rentals)
  const waStatus = useStore((s) => s.waStatus)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const canManage = useCanManage()
  const lookups = useLookups()
  const [saving, setSaving] = React.useState(false)

  const [query, setQuery] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [roomModalFor, setRoomModalFor] = React.useState<string | null>(null)

  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('+62')
  const [address, setAddress] = React.useState<Address>(emptyAddress)

  React.useEffect(() => {
    if (params.get('action') === 'new') {
      setCreateOpen(true)
      params.delete('action')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  React.useEffect(() => {
    if (!createOpen) {
      setName(''); setPhone('+62'); setAddress(emptyAddress)
    }
  }, [createOpen])

  const filtered = properties.filter((p) =>
    `${p.name} ${formatAddress(p.address)}`.toLowerCase().includes(query.toLowerCase()),
  )

  const submit = async () => {
    if (!name.trim()) return toast({ title: 'Nama properti wajib diisi', variant: 'error' })
    if (phone.replace(/\D/g, '').length < 9) return toast({ title: 'Nomor WhatsApp properti wajib diisi', variant: 'error' })
    if (!isAddressComplete(address)) return toast({ title: 'Lengkapi alamat properti', variant: 'error' })
    setSaving(true)
    const p = await run(() => actions.createProperty({ name: name.trim(), phone, address }), { success: 'Properti ditambahkan' })
    setSaving(false)
    if (!p) return
    setCreateOpen(false)
    navigate(`/properties/${p.id}`)
  }

  return (
    <>
      <PageHeader
        title="Properti"
        description={`${properties.length} properti · ${rooms.length} kamar dikelola`}
        actions={canManage ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Tambah properti</Button> : undefined}
      />

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Cari nama properti atau alamat..."
        className="max-w-md mb-6"
      />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Belum ada properti"
            description="Tambahkan properti pertama Anda untuk mulai mengelola kamar dan penyewa."
            action={canManage ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Tambah properti</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((p) => {
            const propRooms = rooms.filter((r) => r.propertyId === p.id)
            const occupied = propRooms.filter((r) => isOccupiedStatus(lookups.roomStatus(r.id))).length
            const occupancy = propRooms.length ? Math.round((occupied / propRooms.length) * 100) : 0
            const revenue = rentals
              .filter((r) => r.propertyId === p.id && isCurrentRental(r))
              .reduce((a, r) => a + r.price, 0)

            return (
              <Card key={p.id} className="overflow-hidden hover:shadow-md transition-all group">
                <div className="h-24 bg-gradient-to-br from-primary/90 to-violet-600 relative">
                  <div className="absolute bottom-3 left-5 right-5 flex items-end justify-between gap-3">
                    <h3 className="font-extrabold text-white text-lg tracking-tight truncate drop-shadow">{p.name}</h3>
                    <Badge tone="muted" className="bg-white/90 border-transparent shrink-0">{propRooms.length} kamar</Badge>
                  </div>
                </div>

                <div className="p-5 space-y-3">
                  <p className="text-xs text-muted-foreground flex items-start gap-2 leading-relaxed">
                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{formatAddress(p.address)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {formatPhoneDisplay(p.phone)}
                    <Badge tone={waStatus[p.id] === 'connected' ? 'success' : 'warning'} className="ml-auto">
                      <MessageCircle className="h-3 w-3" /> {waStatus[p.id] === 'connected' ? 'WA terhubung' : 'WA belum terhubung'}
                    </Badge>
                  </p>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <Stat label="Hunian" value={`${occupancy}%`} />
                    <Stat label="Terisi" value={`${occupied}/${propRooms.length}`} />
                    <Stat label="Sewa/bulan" value={formatIDR(revenue, { compact: true })} />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate(`/properties/${p.id}`)}>
                      <Pencil className="h-3.5 w-3.5" /> Kelola
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => setRoomModalFor(p.id)}>
                      <DoorOpen className="h-3.5 w-3.5" /> Tambah kamar
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah properti"
        description="Buat properti kos baru beserta alamat lengkapnya."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button onClick={submit} loading={saving}>Simpan properti</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nama properti" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kost Melati Asri" autoFocus />
            </Field>
            <Field label="Nomor WhatsApp properti" required hint="Satu nomor untuk satu properti — dipakai untuk semua pesan ke penyewa.">
              <PhoneInput value={phone} onChange={setPhone} />
            </Field>
          </div>
          <AddressFields value={address} onChange={(patch) => setAddress((a) => ({ ...a, ...patch }))} />
          <LocationPicker
            lat={address.lat}
            lng={address.lng}
            onChange={(lat, lng) => setAddress((a) => ({ ...a, lat, lng }))}
            height={200}
          />
        </div>
      </Modal>

      <RoomFormModal
        open={!!roomModalFor}
        onClose={() => setRoomModalFor(null)}
        presetPropertyId={roomModalFor ?? undefined}
      />
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-2 text-center">
      <p className="text-[10px] font-semibold text-muted-foreground truncate">{label}</p>
      <p className="text-sm font-extrabold tabular-nums mt-0.5 truncate">{value}</p>
    </div>
  )
}

import * as React from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { MapPin, Search } from 'lucide-react'
import { Field, Input, Select } from '@/components/ui'
import type { Address } from '@/lib/types'
import { CITY_COORDS, DEFAULT_COORDS, PROVINCES, getCities, getDistricts, getSubdistricts } from '@/lib/wilayah'

/* Leaflet default marker assets are bundled from a CDN to avoid asset imports. */
const markerIcon = L.divIcon({
  className: '',
  html: `<div style="transform:translate(-50%,-100%)">
      <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 27 17 27s17-15 17-27C34 7.6 26.4 0 17 0Z" fill="#4f46e5"/>
        <circle cx="17" cy="16.5" r="6.5" fill="#fff"/>
      </svg>
    </div>`,
  iconSize: [34, 44],
  iconAnchor: [0, 0],
})

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  React.useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true })
  }, [lat, lng, map])
  return null
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function LocationPicker({
  lat, lng, onChange, height = 260,
}: {
  lat: number
  lng: number
  onChange: (lat: number, lng: number) => void
  height?: number
}) {
  const [query, setQuery] = React.useState('')

  const searchCity = () => {
    const found = Object.keys(CITY_COORDS).find((c) => c.toLowerCase().includes(query.toLowerCase()))
    if (found) onChange(CITY_COORDS[found][0], CITY_COORDS[found][1])
  }

  const position: [number, number] =
    Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? [lat, lng] : DEFAULT_COORDS

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder="Cari kota untuk memindahkan peta..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchCity())}
        />
      </div>
      <div className="rounded-md overflow-hidden border border-border" style={{ height }}>
        <MapContainer center={position} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={position}
            icon={markerIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const m = e.target as L.Marker
                const p = m.getLatLng()
                onChange(p.lat, p.lng)
              },
            }}
          />
          <ClickHandler onPick={onChange} />
          <Recenter lat={position[0]} lng={position[1]} />
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5" />
        Klik peta atau geser pin untuk lokasi yang lebih akurat · {position[0].toFixed(5)}, {position[1].toFixed(5)}
      </p>
    </div>
  )
}

export function AddressFields({
  value, onChange, disabled,
}: {
  value: Address
  onChange: (patch: Partial<Address>) => void
  disabled?: boolean
}) {
  const cities = getCities(value.province)
  const districts = getDistricts(value.province, value.city)
  const subdistricts = getSubdistricts(value.province, value.city, value.district)

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label="Alamat / Jalan" required className="sm:col-span-2">
        <Input
          disabled={disabled}
          value={value.street}
          onChange={(e) => onChange({ street: e.target.value })}
          placeholder="Jl. Kenanga No. 12, RT 03/RW 05"
        />
      </Field>

      <Field label="Provinsi" required>
        <Select
          disabled={disabled}
          value={value.province}
          placeholder="Pilih provinsi"
          options={PROVINCES.map((p) => ({ value: p, label: p }))}
          onChange={(province) =>
            onChange({ province, city: '', district: '', subdistrict: '' })
          }
        />
      </Field>

      <Field label="Kota / Kabupaten" required>
        <Select
          disabled={disabled || !value.province}
          value={value.city}
          placeholder={value.province ? 'Pilih kota' : 'Pilih provinsi dulu'}
          options={cities.map((c) => ({ value: c, label: c }))}
          onChange={(city) => {
            const coords = CITY_COORDS[city]
            onChange({
              city,
              district: '',
              subdistrict: '',
              ...(coords ? { lat: coords[0], lng: coords[1] } : {}),
            })
          }}
        />
      </Field>

      <Field label="Kecamatan" required>
        <Select
          disabled={disabled || !value.city}
          value={value.district}
          placeholder={value.city ? 'Pilih kecamatan' : 'Pilih kota dulu'}
          options={districts.map((d) => ({ value: d, label: d }))}
          onChange={(district) => onChange({ district, subdistrict: '' })}
        />
      </Field>

      <Field label="Kelurahan" required>
        <Select
          disabled={disabled || !value.district}
          value={value.subdistrict}
          placeholder={value.district ? 'Pilih kelurahan' : 'Pilih kecamatan dulu'}
          options={subdistricts.map((s) => ({ value: s, label: s }))}
          onChange={(subdistrict) => onChange({ subdistrict })}
        />
      </Field>

      <Field label="Kode Pos" required>
        <Input
          disabled={disabled}
          inputMode="numeric"
          maxLength={5}
          value={value.postcode}
          onChange={(e) => onChange({ postcode: e.target.value.replace(/\D/g, '') })}
          placeholder="40135"
        />
      </Field>
    </div>
  )
}

export function formatAddress(a: Address, opts?: { withStreet?: boolean }) {
  const parts = [
    opts?.withStreet === false ? null : a.street,
    a.subdistrict && `Kel. ${a.subdistrict}`,
    a.district && `Kec. ${a.district}`,
    a.city,
    a.province,
    a.postcode,
  ].filter(Boolean)
  return parts.join(', ') || '-'
}

export function isAddressComplete(a: Address) {
  return Boolean(a.street && a.province && a.city && a.district && a.subdistrict && a.postcode)
}

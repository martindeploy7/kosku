import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  BedDouble, Building2, FileText, Loader2, Receipt, RotateCcw, Trash2, User, UsersRound, Wallet, Wrench,
} from 'lucide-react'
import { Badge, Button, Card, EmptyState, SearchInput } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { actions } from '@/lib/actions'
import { useIsSuper, useStore } from '@/lib/store'
import type { TrashItem } from '@/lib/types'
import { relativeTime } from '@/lib/utils'

const META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  property: { label: 'Properti', icon: Building2 },
  room: { label: 'Kamar', icon: BedDouble },
  service: { label: 'Layanan', icon: Wrench },
  tenant: { label: 'Penyewa', icon: User },
  invoice: { label: 'Faktur', icon: Receipt },
  payment: { label: 'Pembayaran', icon: Wallet },
  expense: { label: 'Pengeluaran', icon: Wallet },
  user: { label: 'Pengguna', icon: UsersRound },
  file: { label: 'Berkas', icon: FileText },
  contract: { label: 'Perjanjian', icon: FileText },
}

/** Everything deleted, restorable as a unit — superadmin only. */
export default function Trash() {
  const isSuper = useIsSuper()
  const run = useStore((s) => s.run)
  const properties = useStore((s) => s.properties)
  const deletedNames = useStore((s) => s.deletedNames)
  const [items, setItems] = React.useState<TrashItem[] | null>(null)
  const [query, setQuery] = React.useState('')
  const [type, setType] = React.useState<string>('all')
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(async () => setItems(await actions.trash().catch(() => [])), [])
  React.useEffect(() => { if (isSuper) void load() }, [isSuper, load])

  if (!isSuper) return <Navigate to="/dashboard" replace />

  const restore = async (item: TrashItem) => {
    setBusy(item.id)
    const ok = await run(() => actions.restore(item.id), { success: `"${item.label}" dipulihkan` })
    setBusy(null)
    if (ok) setItems((xs) => xs?.filter((x) => x.id !== item.id) ?? null)
  }

  const types = [...new Set((items ?? []).map((i) => i.entityType))]
  const shown = (items ?? []).filter((i) =>
    (type === 'all' || i.entityType === type) && (!query || i.label.toLowerCase().includes(query.toLowerCase())),
  )
  const propName = (id: string | null) =>
    id ? properties.find((p) => p.id === id)?.name ?? deletedNames.properties[id] ?? null : null

  return (
    <>
      <PageHeader
        title="Tempat Sampah"
        description="Data yang dihapus tidak benar-benar hilang. Pulihkan satu item beserta semua data yang ikut terhapus bersamanya."
      />
      <Card className="mb-4 p-4 flex flex-wrap gap-3 items-center">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari nama…" className="flex-1 min-w-[200px]" />
        <div className="flex flex-wrap gap-1.5">
          {['all', ...types].map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3 h-8 rounded-full text-xs font-semibold border transition ${type === t ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
            >
              {t === 'all' ? 'Semua' : META[t]?.label ?? t}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {items === null ? (
          <div className="py-14 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : shown.length === 0 ? (
          <EmptyState icon={Trash2} title="Tempat sampah kosong" description="Item yang dihapus admin akan muncul di sini." />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((item) => {
              const m = META[item.entityType] ?? { label: item.entityType, icon: FileText }
              const extra = Object.entries(item.counts).map(([k, v]) => `${v} ${k}`).join(', ')
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-4">
                  <span className="h-10 w-10 rounded-xl bg-muted grid place-items-center shrink-0">
                    <m.icon className="h-5 w-5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold truncate">{item.label}</p>
                      <Badge tone="muted">{m.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Dihapus {relativeTime(item.deletedAt)} oleh {item.deletedByName}
                      {propName(item.propertyId) && ` · ${propName(item.propertyId)}`}
                    </p>
                    {extra && <p className="text-xs text-muted-foreground mt-0.5">Ikut terhapus: {extra}</p>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => restore(item)} loading={busy === item.id}>
                    <RotateCcw className="h-3.5 w-3.5" /> Pulihkan
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}

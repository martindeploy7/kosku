import { useNavigate } from 'react-router-dom'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { Badge, Button, Card } from '@/components/ui'
import { useLookups } from '@/lib/selectors'
import { useIsSuper, useStore } from '@/lib/store'
import { relativeTime } from '@/lib/utils'

/** Dashboard card: requests waiting for the superadmin (or, for an admin, their own pending requests). */
export function ApprovalsPanel() {
  const navigate = useNavigate()
  const isSuper = useIsSuper()
  const me = useStore((s) => s.me)
  const all = useStore((s) => s.approvals)
  const lookups = useLookups()
  const list = isSuper ? all : all.filter((r) => r.requestedById === me?.id)
  if (!list.length) return null

  return (
    <Card className="border-warning/40 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 bg-warning-soft/60 border-b border-warning/20">
        <span className="h-9 w-9 rounded-lg bg-warning text-white grid place-items-center shrink-0"><ClipboardCheck className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{isSuper ? 'Menunggu persetujuan Anda' : 'Permintaan Anda menunggu superadmin'}</p>
          <p className="text-xs text-muted-foreground">
            {isSuper ? 'Penghapusan dan perubahan penting dari admin baru berlaku setelah Anda setujui.' : 'Perubahan diterapkan setelah disetujui.'}
          </p>
        </div>
        <Badge tone="warning">{list.length}</Badge>
      </div>
      <ul className="divide-y divide-border">
        {list.slice(0, 5).map((r) => (
          <li key={r.id}>
            <button onClick={() => navigate(`/approvals?id=${r.id}`)} className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/50 transition">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{r.label}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {r.requestedByName} · {relativeTime(r.createdAt)}{r.propertyId ? ` · ${lookups.propertyName(r.propertyId)}` : ''}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </li>
        ))}
      </ul>
      {list.length > 5 && (
        <div className="px-5 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={() => navigate('/approvals')}>Lihat semua ({list.length})</Button>
        </div>
      )}
    </Card>
  )
}

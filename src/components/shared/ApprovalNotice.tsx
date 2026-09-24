import { Link } from 'react-router-dom'
import { Hourglass, ShieldCheck } from 'lucide-react'
import type { ApprovalRequest } from '@/lib/types'
import { cn, relativeTime } from '@/lib/utils'

/** "This is waiting for a superadmin" — shown next to the record a request touches. */
export function PendingApprovalBanner({ requests, className }: { requests: ApprovalRequest[]; className?: string }) {
  if (!requests.length) return null
  return (
    <div className={cn('rounded-lg border border-warning/40 bg-warning-soft/70 p-3.5 text-xs leading-relaxed', className)}>
      {requests.map((r) => (
        <div key={r.id} className="flex gap-2.5 [&+&]:mt-3 [&+&]:pt-3 [&+&]:border-t [&+&]:border-warning/20">
          <Hourglass className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">Menunggu persetujuan superadmin: {r.label}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {r.changes.slice(0, 6).map((c, i) => (
                <li key={i} className="break-words">
                  {c.label}{c.after && c.before !== c.after && c.after.length < 120 ? <>: <span className="line-through">{c.before.slice(0, 80)}</span> → <strong className="text-foreground">{c.after}</strong></> : ''}
                </li>
              ))}
              {r.changes.length > 6 && <li>…dan {r.changes.length - 6} perubahan lain</li>}
            </ul>
            <p className="mt-1 text-muted-foreground">
              Diminta {r.requestedByName} · {relativeTime(r.createdAt)} · <Link to={`/approvals?id=${r.id}`} className="font-semibold underline">Lihat</Link>
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Shown while an admin edits something that will go to the superadmin, with an optional reason. */
export function NeedsApprovalHint({
  what, reason, onReason, className,
}: {
  what: string
  reason: string
  onReason: (v: string) => void
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-info/30 bg-info-soft p-3.5 text-xs leading-relaxed space-y-2.5', className)}>
      <p className="flex gap-2">
        <ShieldCheck className="h-4 w-4 text-info shrink-0" />
        <span>Perubahan <strong>{what}</strong> perlu persetujuan superadmin. Nilai lama tetap berlaku sampai disetujui.</span>
      </p>
      <input
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        maxLength={500}
        aria-label="Alasan perubahan"
        placeholder="Alasan perubahan (opsional), mis. penyesuaian harga tahun ini"
        className="w-full h-9 rounded-md border border-input bg-surface px-3 text-sm focus-ring"
      />
    </div>
  )
}

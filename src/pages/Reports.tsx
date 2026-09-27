import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, ChevronDown, CreditCard, FileText, Users } from 'lucide-react'
import { Badge, Card } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { REPORT_CATALOGUE } from '@/lib/constants'
import { cn } from '@/lib/utils'


const GROUP_META: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: 'primary' | 'success' | 'info'; desc: string }> = {
  Keuangan: { icon: BarChart3, tone: 'primary', desc: 'Laporan akuntansi standar untuk melihat kesehatan keuangan bisnis.' },
  Pembayaran: { icon: CreditCard, tone: 'success', desc: 'Pelacakan pendapatan, tagihan, deposit, dan keterlambatan pembayaran.' },
  Penyewa: { icon: Users, tone: 'info', desc: 'Data penghuni, okupansi kamar, durasi sewa, dan kendaraan.' },
}

const GROUP_TONES = {
  primary: { surface: 'bg-gradient-to-br from-surface via-surface to-primary-soft/80', mark: 'text-primary' },
  success: { surface: 'bg-gradient-to-br from-surface via-surface to-success-soft/80', mark: 'text-success' },
  info: { surface: 'bg-gradient-to-br from-surface via-surface to-info-soft/80', mark: 'text-info' },
}

export default function Reports() {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState<string[]>(['Keuangan'])

  const toggle = (group: string) =>
    setOpen((o) => (o.includes(group) ? o.filter((g) => g !== group) : [...o, group]))

  const totalReports = REPORT_CATALOGUE.reduce((a, g) => a + g.items.length, 0)

  return (
    <>
      <PageHeader
        title="Laporan"
        description={`${totalReports} jenis laporan siap pakai dengan ekspor PDF dan Excel.`}
      />

      <div className="space-y-4 max-w-4xl">
        {REPORT_CATALOGUE.map((group) => {
          const meta = GROUP_META[group.group]
          const Icon = meta.icon
          const tone = GROUP_TONES[meta.tone]
          const expanded = open.includes(group.group)
          return (
            <Card key={group.group} className={cn('relative isolate overflow-hidden', !expanded && tone.surface)}>
              <button
                onClick={() => toggle(group.group)}
                className={cn('relative z-10 w-full min-h-[112px] flex items-center gap-4 p-5 text-left focus-ring', expanded && tone.surface)}
              >
                <Icon aria-hidden="true" className={cn('absolute -bottom-7 -right-3 z-0 h-32 w-32 opacity-[0.12]', tone.mark)} />
                <span className="relative z-10 min-w-0 flex-1 max-w-[80%]">
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-[15px]">{group.group}</span>
                    <Badge tone="muted">{group.items.length} laporan</Badge>
                  </span>
                  <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">{meta.desc}</span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
              </button>

              {expanded && (
                <div className="border-t border-border divide-y divide-border">
                  {group.items.map((item) => (
                    <button
                      key={item.slug}
                      onClick={() => navigate(`/reports/${item.slug}`)}
                      className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-muted/50 transition group focus-ring"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition" />
                      <span className="min-w-0">
                        <span className="block font-semibold text-sm group-hover:text-primary transition">{item.title}</span>
                        <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">{item.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}

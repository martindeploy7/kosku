import * as React from 'react'
import { Navigate } from 'react-router-dom'
import { CheckCircle2, CircleAlert, History, Loader2, Play, Timer } from 'lucide-react'
import { Badge, Button, Card, EmptyState, SearchInput, Table, Td, Th, Tr } from '@/components/ui'
import { PageHeader, Tabs } from '@/components/shared'
import { actions } from '@/lib/actions'
import { useIsSuper, useStore } from '@/lib/store'
import type { AuditEntry, JobRun } from '@/lib/types'

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const JOB_LABELS: Record<string, string> = {
  'daily-billing': 'Tagihan harian (00:05) — tagihan baru, denda, pelepasan DP',
  'daily-digest': 'Ringkasan pagi (07:00) — notifikasi jatuh tempo',
  'tenant-reminders': 'Pengingat WhatsApp ke penyewa',
}

function AuditLog() {
  const [rows, setRows] = React.useState<AuditEntry[] | null>(null)
  const [query, setQuery] = React.useState('')
  const [more, setMore] = React.useState(true)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async (before?: string) => {
    setLoading(true)
    try {
      const page = await actions.audit({ before, limit: 100 })
      setRows((xs) => (before ? [...(xs ?? []), ...page] : page))
      setMore(page.length === 100)
    } finally {
      setLoading(false)
    }
  }, [])
  React.useEffect(() => { void load() }, [load])

  const shown = (rows ?? []).filter((r) => !query || `${r.username} ${r.summary} ${r.action}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari pengguna atau aktivitas…" />
      </div>
      {rows === null ? (
        <div className="py-14 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : shown.length === 0 ? (
        <EmptyState icon={History} title="Belum ada aktivitas" />
      ) : (
        <>
          <Table>
            <thead><tr><Th>Waktu</Th><Th>Pengguna</Th><Th>Aktivitas</Th><Th>IP</Th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{fmt(r.createdAt)}</Td>
                  <Td className="whitespace-nowrap font-semibold text-sm">@{r.username}</Td>
                  <Td className="text-sm min-w-[260px]">
                    {r.summary}
                    {r.action.includes('delete') && <Badge tone="danger" className="ml-2">hapus</Badge>}
                    {r.action.includes('restore') && <Badge tone="success" className="ml-2">pulih</Badge>}
                    {r.action === 'auth.login_failed' && <Badge tone="warning" className="ml-2">gagal masuk</Badge>}
                  </Td>
                  <Td className="text-xs text-muted-foreground font-mono">{r.ip ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {more && (
            <div className="p-4 flex justify-center">
              <Button variant="outline" size="sm" loading={loading} onClick={() => load(rows[rows.length - 1]?.createdAt)}>Muat lebih lama</Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function JobsPanel() {
  const run = useStore((s) => s.run)
  const [rows, setRows] = React.useState<JobRun[] | null>(null)
  const [running, setRunning] = React.useState(false)
  const load = React.useCallback(async () => setRows(await actions.jobs().catch(() => [])), [])
  React.useEffect(() => { void load() }, [load])

  const lastOk = (name: string) => rows?.find((r) => r.name === name && r.status === 'ok')

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-bold">Tugas otomatis</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl leading-relaxed">
              Berjalan sendiri setiap hari (zona waktu server). Jika server mati, tugas yang terlewat otomatis dijalankan
              saat menyala kembali — tanpa tagihan atau pesan ganda.
            </p>
          </div>
          <Button
            variant="outline"
            loading={running}
            onClick={async () => {
              setRunning(true)
              await run(() => actions.runDaily(), { success: 'Tugas harian dijalankan' })
              setRunning(false)
              void load()
            }}
          >
            <Play className="h-4 w-4" /> Jalankan sekarang
          </Button>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          {Object.entries(JOB_LABELS).map(([name, label]) => {
            const ok = lastOk(name)
            return (
              <div key={name} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5" /> {ok ? `Terakhir sukses ${fmt(ok.startedAt)}` : 'Belum pernah berjalan'}
                </p>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {rows === null ? (
          <div className="py-14 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Table>
            <thead><tr><Th>Mulai</Th><Th>Tugas</Th><Th>Status</Th><Th>Hasil</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{fmt(r.startedAt)}</Td>
                  <Td className="text-sm font-semibold whitespace-nowrap">{r.name}</Td>
                  <Td>
                    {r.status === 'ok' ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> OK</Badge>
                      : r.status === 'error' ? <Badge tone="danger"><CircleAlert className="h-3 w-3" /> Gagal</Badge>
                      : <Badge tone="info">Berjalan</Badge>}
                  </Td>
                  <Td className="text-xs text-muted-foreground font-mono min-w-[240px]">
                    {r.error ?? (r.result ? JSON.stringify(r.result) : '—')}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

export default function Activity() {
  const isSuper = useIsSuper()
  const [tab, setTab] = React.useState('audit')
  if (!isSuper) return <Navigate to="/dashboard" replace />
  return (
    <>
      <PageHeader title="Log & Sistem" description="Siapa melakukan apa dan kapan, serta kesehatan tugas otomatis." />
      <Tabs value={tab} onChange={setTab} className="mb-6" tabs={[{ value: 'audit', label: 'Log aktivitas' }, { value: 'jobs', label: 'Tugas otomatis' }]} />
      {tab === 'audit' ? <AuditLog /> : <JobsPanel />}
    </>
  )
}

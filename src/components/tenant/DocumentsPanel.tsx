import * as React from 'react'
import { Camera, FileText, Loader2, Lock, Trash2, Upload } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, Select } from '@/components/ui'
import { actions } from '@/lib/actions'
import { fileUrl } from '@/lib/api'
import { FILE_KINDS } from '@/lib/constants'
import { useCanDelete, useNeedsApproval, useStore } from '@/lib/store'
import type { FileKind, FileMeta } from '@/lib/types'
import { relativeTime } from '@/lib/utils'

type Doc = FileMeta & { restricted: boolean }

const UPLOADABLE: FileKind[] = ['ktp', 'kk', 'foto', 'lainnya']

/** Downscale phone photos in the browser before upload — faster on mobile data. The server re-encodes anyway. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 600_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/** Tenant documents (KTP, KK, photos) — stored server-side, identity documents admin-only. */
export function DocumentsPanel({ tenantId }: { tenantId: string }) {
  const run = useStore((s) => s.run)
  const canDelete = useCanDelete()
  const needsApproval = useNeedsApproval()
  const [docs, setDocs] = React.useState<Doc[] | null>(null)
  const [kind, setKind] = React.useState<FileKind>('ktp')
  const [uploading, setUploading] = React.useState(false)
  const [target, setTarget] = React.useState<Doc | null>(null)

  const load = React.useCallback(async () => {
    setDocs(await actions.listFiles('tenant', tenantId).catch(() => []))
  }, [tenantId])
  React.useEffect(() => { void load() }, [load])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    for (const f of Array.from(files)) {
      await run(async () => actions.uploadFile(await shrink(f), 'tenant', tenantId, kind), { refresh: false, success: `${f.name} diunggah` })
    }
    setUploading(false)
    void load()
  }

  const kindLabel = (k: string) => FILE_KINDS.find((x) => x.value === k)?.label ?? k

  return (
    <Card>
      <CardHeader><CardTitle>Dokumen penyewa</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid sm:grid-cols-[200px_1fr] gap-3 items-stretch">
          <Select value={kind} onChange={(v) => setKind(v as FileKind)} options={UPLOADABLE.map((k) => ({ value: k, label: kindLabel(k) }))} />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center justify-center gap-2 h-10 rounded-md border border-dashed border-input cursor-pointer hover:border-primary/60 transition text-sm font-semibold">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Pilih berkas
              <input type="file" multiple accept="image/*,application/pdf" className="sr-only" disabled={uploading} onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
            </label>
            <label className="flex items-center justify-center gap-2 h-10 rounded-md border border-dashed border-input cursor-pointer hover:border-primary/60 transition text-sm font-semibold">
              <Camera className="h-4 w-4" /> Foto kamera
              <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={uploading} onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
            </label>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">JPG, PNG, atau PDF, maks. 10 MB. Foto otomatis dikecilkan dan data lokasinya (GPS) dihapus.</p>

        {docs === null ? (
          <div className="py-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : docs.length === 0 ? (
          <EmptyState icon={FileText} title="Belum ada dokumen" className="py-8" />
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                {d.restricted ? (
                  <span className="h-14 w-14 rounded-md bg-muted grid place-items-center shrink-0"><Lock className="h-5 w-5 text-muted-foreground" /></span>
                ) : d.mime.startsWith('image/') ? (
                  <a href={fileUrl(d.id)} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={fileUrl(d.id)} alt={d.originalName} loading="lazy" className="h-14 w-14 rounded-md object-cover bg-muted" />
                  </a>
                ) : (
                  <a href={fileUrl(d.id)} target="_blank" rel="noreferrer" className="h-14 w-14 rounded-md bg-muted grid place-items-center shrink-0">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </a>
                )}
                <div className="min-w-0 flex-1">
                  <Badge tone={d.restricted ? 'muted' : 'primary'}>{kindLabel(d.kind)}</Badge>
                  <p className="text-sm font-medium truncate mt-1">{d.restricted ? 'Hanya admin' : d.originalName}</p>
                  <p className="text-[11px] text-muted-foreground">{relativeTime(d.createdAt)} · {d.uploadedByName}</p>
                </div>
                {canDelete && (
                  <Button size="icon" variant="ghost" aria-label="Hapus dokumen" onClick={() => setTarget(d)}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Hapus dokumen?"
        confirmLabel="Hapus"
        message="Dokumen dipindahkan ke tempat sampah dan dapat dipulihkan superadmin."
        approval={needsApproval}
        onConfirm={async (reason) => {
          if (!target) return
          const ok = await run(() => actions.deleteFile(target.id, reason), { refresh: false, success: 'Dokumen dihapus' })
          if (ok) void load()
        }}
      />
    </Card>
  )
}

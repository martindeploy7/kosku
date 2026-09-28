import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  Copy, KeyRound, LockOpen, LogOut, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, UserCheck, UserX,
} from 'lucide-react'
import {
  Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, Modal, Popover, RadioCard, Table, Td, Th, Tr,
} from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { actions } from '@/lib/actions'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/constants'
import { useIsSuper, useStore } from '@/lib/store'
import type { Role, User } from '@/lib/types'
import { copyText, relativeTime } from '@/lib/utils'

function TempPasswordModal({ info, onClose }: { info: { username: string; password: string } | null; onClose: () => void }) {
  const toast = useStore((s) => s.toast)
  return (
    <Modal
      open={Boolean(info)}
      onClose={onClose}
      size="sm"
      title="Password sementara"
      description="Tampil sekali ini saja. Sampaikan langsung ke orangnya — mereka wajib menggantinya saat login pertama."
      footer={<Button onClick={onClose}>Sudah saya catat</Button>}
    >
      {info && (
        <div className="space-y-3">
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <p className="text-xs text-muted-foreground">Username</p>
            <p className="font-mono font-bold">{info.username}</p>
            <p className="text-xs text-muted-foreground pt-2">Password sementara</p>
            <div className="flex items-center gap-2">
              <p className="font-mono font-bold text-lg tracking-wider select-all">{info.password}</p>
              <Button
                size="icon" variant="ghost" aria-label="Salin"
                onClick={async () => toast({ title: (await copyText(`${info.username} / ${info.password}`)) ? 'Disalin' : 'Gagal menyalin', variant: 'info' })}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Jangan kirim lewat grup chat. Password ini tidak bisa dilihat lagi; bila hilang, reset ulang.
          </p>
        </div>
      )}
    </Modal>
  )
}

function UserForm({ open, onClose, user, onCreated }: {
  open: boolean; onClose: () => void; user: User | null; onCreated: (u: string, p: string) => void
}) {
  const properties = useStore((s) => s.properties)
  const run = useStore((s) => s.run)
  const [username, setUsername] = React.useState('')
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [role, setRole] = React.useState<Role>('admin')
  const [allProperties, setAll] = React.useState(true)
  const [propertyIds, setPropertyIds] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const me = useStore((s) => s.me)
  // Owners can start another (separate) owner; a developer's sandbox can't. Editing never changes ownership.
  const ownerAccount = user?.role === 'superadmin' || user?.role === 'developer'
  const roleChoices: Role[] = user
    ? (ownerAccount ? [user.role] : ['admin', 'staff'])
    : me?.role === 'superadmin' ? ['superadmin', 'admin', 'staff'] : ['admin', 'staff']

  React.useEffect(() => {
    if (!open) return
    setUsername(user?.username ?? '')
    setName(user?.name ?? '')
    setPhone(user?.phone ?? '')
    setRole(user?.role ?? 'admin')
    setAll(user?.allProperties ?? true)
    setPropertyIds(user?.propertyIds ?? [])
  }, [open, user])

  const save = async () => {
    setSaving(true)
    const payload = { name, phone, role, allProperties: role === 'superadmin' ? true : allProperties, propertyIds }
    if (user) {
      // An owner's role and access are fixed; only name and phone can change.
      const ownerAccount = user.role === 'superadmin' || user.role === 'developer'
      const ok = await run(() => actions.updateUser(user.id, ownerAccount ? { name, phone } : payload), { success: 'Pengguna diperbarui' })
      setSaving(false)
      if (ok) onClose()
    } else {
      const res = await run(() => actions.createUser({ ...payload, username: username.trim().toLowerCase() }))
      setSaving(false)
      if (res) {
        onClose()
        onCreated(res.user.username, res.temporaryPassword)
      }
    }
  }

  const valid = name.trim().length >= 2 && (user || /^[a-zA-Z0-9._-]{3,40}$/.test(username)) &&
    (role === 'superadmin' || allProperties || propertyIds.length > 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={user ? `Ubah @${user.username}` : 'Tambah pengguna'}
      description={user ? undefined : 'Password sementara dibuat otomatis dan ditampilkan setelah disimpan.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={save} loading={saving} disabled={!valid}>{user ? 'Simpan' : 'Tambah pengguna'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Username" required hint="Huruf kecil, angka, titik. Dipakai untuk login.">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={Boolean(user)} autoCapitalize="none" placeholder="mis. rina" />
          </Field>
          <Field label="Nama" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama lengkap" />
          </Field>
          <Field label="No. HP (opsional)" hint="Hanya untuk kontak internal.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Peran</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {roleChoices.map((r) => (
              <RadioCard key={r} checked={role === r} onChange={() => setRole(r)} title={ROLE_LABELS[r]} description={ROLE_DESCRIPTIONS[r]} />
            ))}
          </div>
          {!user && role === 'superadmin' && (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs leading-relaxed">
              Superadmin baru adalah <strong>pemilik terpisah</strong>: ia hanya melihat properti yang ia buat sendiri,
              tidak dapat melihat properti, penyewa, maupun laporan Anda — dan Anda juga tidak dapat melihat miliknya
              atau mengelola akunnya setelah dibuat.
            </div>
          )}
        </div>

        {role !== 'superadmin' && role !== 'developer' && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">Akses properti</p>
            <Checkbox checked={allProperties} onChange={setAll} label="Semua properti (termasuk yang ditambahkan nanti)" />
            {!allProperties && (
              <div className="grid sm:grid-cols-2 gap-2 pl-7">
                {properties.map((p) => (
                  <Checkbox
                    key={p.id}
                    checked={propertyIds.includes(p.id)}
                    onChange={(v) => setPropertyIds((ids) => (v ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                    label={p.name}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function Users() {
  const isSuper = useIsSuper()
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.me)
  const properties = useStore((s) => s.properties)
  const run = useStore((s) => s.run)
  const [form, setForm] = React.useState<{ open: boolean; user: User | null }>({ open: false, user: null })
  const [temp, setTemp] = React.useState<{ username: string; password: string } | null>(null)
  const [confirm, setConfirm] = React.useState<{ kind: 'delete' | 'reset'; user: User } | null>(null)

  if (!isSuper) return <Navigate to="/dashboard" replace />

  const sorted = [...users].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
  const access = (u: User) =>
    u.role === 'superadmin' || u.role === 'developer' || u.allProperties
      ? 'Semua properti'
      : u.propertyIds.map((id) => properties.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || '—'

  const resetPassword = async (u: User) => {
    const res = await run(() => actions.resetUserPassword(u.id))
    if (res) setTemp({ username: u.username, password: res.temporaryPassword })
  }

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Hanya superadmin yang bisa menambah pengguna. Tidak ada email: password sementara diberikan langsung dan wajib diganti saat login pertama."
        actions={<Button onClick={() => setForm({ open: true, user: null })}><Plus className="h-4 w-4" /> Tambah pengguna</Button>}
      />

      <Card className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>Pengguna</Th>
              <Th>Peran</Th>
              <Th>Akses</Th>
              <Th>Terakhir masuk</Th>
              <Th>Status</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={u.name} size="sm" color={u.isActive ? 'bg-primary' : 'bg-muted-foreground'} />
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{u.name}{u.id === me?.id && <span className="text-muted-foreground font-normal"> (Anda)</span>}</p>
                      <p className="text-xs text-muted-foreground">@{u.username}</p>
                    </div>
                  </div>
                </Td>
                <Td>
                  <Badge tone={u.role === 'superadmin' || u.role === 'developer' ? 'primary' : u.role === 'admin' ? 'info' : 'muted'}>
                    {(u.role === 'superadmin' || u.role === 'developer') && <ShieldCheck className="h-3 w-3" />} {ROLE_LABELS[u.role]}
                  </Badge>
                </Td>
                <Td className="text-sm text-muted-foreground max-w-[220px] truncate">{access(u)}</Td>
                <Td className="text-sm text-muted-foreground whitespace-nowrap">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Belum pernah'}</Td>
                <Td>
                  {!u.isActive ? <Badge tone="muted">Nonaktif</Badge>
                    : u.mustChangePassword ? <Badge tone="warning">Menunggu ganti password</Badge>
                    : <Badge tone="success">Aktif</Badge>}
                </Td>
                <Td align="right">
                  <Popover
                    width="w-60"
                    trigger={({ toggle }) => <Button size="icon" variant="ghost" onClick={toggle} aria-label="Aksi"><MoreHorizontal className="h-4 w-4" /></Button>}
                  >
                    {(close) => (
                      <div className="p-1.5 text-sm">
                        {[
                          { icon: Pencil, label: 'Ubah peran & akses', onClick: () => setForm({ open: true, user: u }) },
                          { icon: KeyRound, label: 'Reset password', onClick: () => setConfirm({ kind: 'reset', user: u }) },
                          { icon: LockOpen, label: 'Buka kunci akun', onClick: () => void run(() => actions.unlockUser(u.id), { success: 'Kunci akun dibuka' }) },
                          { icon: LogOut, label: 'Keluarkan dari semua perangkat', onClick: () => void run(() => actions.logoutUser(u.id), { success: 'Semua sesi diakhiri' }), hide: u.id === me?.id },
                          u.isActive
                            ? { icon: UserX, label: 'Nonaktifkan', onClick: () => void run(() => actions.updateUser(u.id, { isActive: false }), { success: 'Pengguna dinonaktifkan' }), hide: u.id === me?.id }
                            : { icon: UserCheck, label: 'Aktifkan', onClick: () => void run(() => actions.updateUser(u.id, { isActive: true }), { success: 'Pengguna diaktifkan' }) },
                          { icon: Trash2, label: 'Hapus', danger: true, onClick: () => setConfirm({ kind: 'delete', user: u }), hide: u.id === me?.id },
                        ].filter((a) => !a.hide).map((a) => (
                          <button
                            key={a.label}
                            onClick={() => { close(); a.onClick() }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition text-left ${a.danger ? 'text-danger hover:bg-danger-soft' : 'hover:bg-muted'}`}
                          >
                            <a.icon className="h-4 w-4" /> {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </Popover>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <UserForm
        open={form.open}
        user={form.user}
        onClose={() => setForm({ open: false, user: null })}
        onCreated={(username, password) => setTemp({ username, password })}
      />
      <TempPasswordModal info={temp} onClose={() => setTemp(null)} />
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        tone={confirm?.kind === 'delete' ? 'danger' : 'primary'}
        title={confirm?.kind === 'delete' ? `Hapus @${confirm.user.username}?` : `Reset password @${confirm?.user.username}?`}
        message={confirm?.kind === 'delete'
          ? 'Pengguna langsung dikeluarkan dari semua perangkat. Anda dapat memulihkannya dari Tempat Sampah.'
          : 'Password lama tidak berlaku lagi dan semua sesinya diakhiri. Password sementara baru akan ditampilkan.'}
        confirmLabel={confirm?.kind === 'delete' ? 'Hapus' : 'Reset password'}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === 'delete') void run(() => actions.deleteUser(confirm.user.id), { success: 'Pengguna dipindahkan ke tempat sampah' })
          else void resetPassword(confirm.user)
        }}
      />
    </>
  )
}

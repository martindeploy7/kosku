import { Link } from 'react-router-dom'
import { Home, Search } from 'lucide-react'
import { Button } from '@/components/ui'

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center bg-background p-6">
      <div className="text-center max-w-md">
        <p className="text-[96px] leading-none font-extrabold tracking-tighter text-primary">
          404
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight mt-2">Halaman tidak ditemukan</h1>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          Tautan yang Anda buka mungkin sudah dipindahkan atau tidak pernah ada.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <Link to="/dashboard">
            <Button><Home className="h-4 w-4" /> Kembali ke dasbor</Button>
          </Link>
          <Link to="/tenants">
            <Button variant="outline"><Search className="h-4 w-4" /> Cari penyewa</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

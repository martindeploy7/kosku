# Kosku — Manajemen Kos Internal

Aplikasi internal untuk mengelola 1–3 kos/residence: penyewa, kamar, tagihan, DP, perjanjian sewa + tata tertib
yang ditandatangani elektronik, dan WhatsApp. Dipakai oleh beberapa admin dari laptop maupun HP (PWA).

Bukan SaaS: tidak ada pendaftaran publik, langganan, payment gateway, website pemasaran, atau email.

---

## Fitur utama

| Kebutuhan | Implementasi |
|---|---|
| **Soft delete + pemulihan** | Semua penghapusan hanya menandai data. Data terkait ikut terhapus sebagai satu kelompok (menghapus properti ikut menyembunyikan kamar, tagihan, pembayaran, pengeluaran), lalu dipulihkan bersama dari **Tempat Sampah** (khusus superadmin). Riwayat keuangan tetap tercatat. |
| **Awareness jatuh tempo** | Panel **"Hari ini"** di Dasbor: jatuh tempo hari ini, terlambat, DP yang harus lunas, perjanjian belum ditandatangani, sewa hampir berakhir. Setiap pagi (07:00) ada ringkasan per properti sebagai notifikasi dan web push. |
| **Kamar urut jatuh tempo** | Halaman Kamar → ikon jam. Kamar dikelompokkan: Terlambat · Hari ini · Menunggu pelunasan DP · 1–7 hari · >7 hari · Kosong. |
| **DP / lunas / gagal bayar** | Status kamar: *Dipesan · DP* (ditahan sampai batas pelunasan), *Terisi · Lunas*, *Terisi · Menunggak*. Pemesanan otomatis aktif saat tagihan pertama lunas. Jika lewat batas, job malam melepas kamar dan DP hangus atau diputuskan admin (sesuai pengaturan properti). |
| **Perjanjian + tata tertib (1 PDF)** | Template per properti, pilihan tata tertib, dan tanda tangan pemilik. Saat sewa dibuat, PDF gabungan dikirim dari WhatsApp properti bersama tautan tanda tangan. Penyewa **wajib menggulir sampai akhir** sebelum bisa tanda tangan. PDF final memuat tanda tangan kedua pihak dan halaman **sertifikat tanda tangan elektronik** (waktu, IP, perangkat, SHA-256 dokumen asli). |
| **WhatsApp 1 properti = 1 nomor** | Nomor diatur di properti, lalu dihubungkan dengan scan QR. Jika HP yang memindai **bernomor lain, tautan langsung dibatalkan** (logout + kredensial dihapus). Nomor unik antar properti (dijaga database). Nomor tidak bisa diganti selama WA terhubung. |
| **WhatsApp dua arah** | Keluar: faktur (PDF), kuitansi, pengingat jatuh tempo/terlambat, info DP & gagal bayar, perjanjian (PDF + tautan), salinan bertanda tangan, ucapan ulang tahun. Masuk: foto/PDF dari penyewa (bukti transfer) disimpan di aplikasi. Admin diberi tahu *"kemungkinan bukti bayar"* dan bisa langsung **mencatat pembayaran dengan bukti itu** dari halaman WhatsApp. Pesan otomatis tidak dikirim pukul 21.00–06.00. |
| **Notifikasi admin** | Lonceng in-app + **web push** ke HP/laptop: gagal bayar, batas DP, perjanjian dibuka/ditandatangani, pesan WA masuk, WA terputus/nomor tidak cocok, job gagal. |
| **Multi-admin** | Peran superadmin / admin / staf, akses per properti, audit log, *optimistic locking* (dua admin tidak saling menimpa), sinkronisasi antar perangkat. |
| **Login tanpa email** | Superadmin membuat akun dan membagikan **password sementara** secara langsung, yang wajib diganti saat login pertama. Reset juga oleh superadmin. Ada jalur darurat CLI di server. |

Fitur lain dari versi sebelumnya tetap ada: frontdesk, 15 laporan (PDF/Excel), pengeluaran, Gantt jadwal kamar, layanan tambahan,
denda keterlambatan, prorata, dark mode, dan tampilan responsif penuh.

### Aturan uang yang dijaga server (dan dites)
- Uang disimpan sebagai **integer rupiah** (`bigint`), tanggal bisnis sebagai `date`, dan "hari ini" dihitung di `APP_TIMEZONE`.
- **Denda dihitung per tanggal uang diterima**, bukan tanggal dicatat. Transfer tepat waktu yang baru dicatat 3 hari kemudian tidak kena denda.
- Constraint database: kamar **tidak bisa dipesan/disewa ganda** pada tanggal yang tumpang tindih (`EXCLUDE USING gist`), faktur tidak terbit ganda untuk periode yang sama, dan tidak ada pembayaran bernilai nol.
- Job harian **idempotent** dan mengejar jadwal yang terlewat saat server mati. Tidak ada tagihan, notifikasi, atau pesan WA ganda.
- DP tercatat sebagai uang muka (liabilitas), dipindah ke pendapatan saat sewa aktif, atau menjadi "DP Hangus" saat gagal bayar.

---

## Stack

| Lapisan | Teknologi |
|---|---|
| Web | React 18, Vite, Tailwind, Zustand (cache dari API), PWA (service worker untuk push) |
| API | Node.js 22, **Hono**, zod |
| Database | **PostgreSQL 17** + Drizzle ORM (migrasi SQL di `drizzle/`) |
| Job terjadwal | **pg-boss** (antrean di Postgres) |
| WhatsApp | **Baileys** (WhatsApp Web, scan QR). Kredensial disimpan di Postgres sehingga ikut backup. |
| PDF | pdfkit (perjanjian di server), jsPDF (faktur & laporan di browser) |
| File | Disk lokal (volume Docker) atau S3/R2. Foto dikompres dan EXIF/GPS dibuang (sharp). |
| Auth | Sesi cookie httpOnly (token di-hash di DB), argon2id, rate limit + kunci akun, CSRF header |

```
shared/    tipe domain, logika keuangan, snapshot perjanjian (dipakai web & server) + unit test
server/    API Hono, layanan (billing, kontrak, trash, notifikasi), job, WhatsApp, PDF, CLI
src/       aplikasi web
drizzle/   migrasi database (0001 = constraint anti sewa ganda)
deploy/    Caddyfile, container backup (pg_dump + age + rclone)
scripts/   dev-db (Postgres lokal), smoke test end-to-end, ikon PWA
```

---

## Menjalankan untuk pengembangan

Butuh Node.js ≥ 22.12. Docker tidak diperlukan, karena PostgreSQL 17 asli dijalankan lewat paket `embedded-postgres`.

```bash
npm install
npm run dev              # Postgres lokal (:54329) + API (:8787) + web (:5173) sekaligus
```

Saat pertama jalan, log API mencetak **username `admin` + password sementara**. Buka http://localhost:5173 dan login.

```bash
npm run cli:dev -- seed-demo        # isi data contoh (2 properti, 10 kamar, penyewa, tagihan, DP)
npm run test                        # unit test logika keuangan (prorata, denda, DP, status kamar, nomor WA)
npm run typecheck
SMOKE_PASSWORD=<password> node scripts/smoke.mjs http://localhost:8787   # ±47 pemeriksaan end-to-end
npx tsx --env-file=.env.development scripts/run-daily-at.ts 2026-10-01    # simulasi job malam pada tanggal tertentu
```

`.env.development` memakai `WA_DRIVER=mock`: QR simulasi yang "dipindai" otomatis, dan pesan tidak benar-benar dikirim.

---

## Deploy (VPS + Docker Compose)

Spesifikasi cukup: 2 vCPU, 2–4 GB RAM (mis. VPS Singapura/Indonesia).

```bash
git clone <repo> kosku && cd kosku
cp .env.example .env         # isi: PUBLIC_URL, POSTGRES_PASSWORD, token tunnel/domain, kredensial R2, kunci age
docker compose --profile tunnel up -d --build     # Cloudflare Tunnel (disarankan: tanpa port terbuka)
# atau
docker compose --profile caddy up -d --build      # HTTPS langsung (Let's Encrypt) — arahkan DNS DOMAIN ke VPS

docker compose logs app | grep -A4 SUPERADMIN     # password sementara superadmin pertama
```

**Cloudflare Tunnel:** buat tunnel di dashboard Zero Trust, arahkan hostname publik ke `http://app:8787`, lalu salin tokennya ke
`CLOUDFLARE_TUNNEL_TOKEN`. Aplikasi tetap bisa diakses dari mana pun (termasuk halaman tanda tangan penyewa), sementara VPS tidak membuka port.

**WhatsApp:** di aplikasi, buka Properti → *Koneksi WhatsApp* → *Hubungkan dengan QR*, lalu pindai dari HP dengan nomor properti
(WhatsApp → Perangkat tertaut). Gunakan nomor khusus kos. HP perlu online minimal sekali tiap 14 hari.

### Backup (wajib: ini data keuangan dan dokumen identitas)
Container `backup` berjalan tiap jam:
- `pg_dump` **dienkripsi dengan `age` sebelum keluar server**, lalu diunggah ke R2/S3.
- Retensi: per jam 48 jam, harian 35 hari, bulanan ±13 bulan.
- Berkas dokumen disalin ke `files/`.

```bash
age-keygen -o kosku-backup.key      # di komputer Anda, BUKAN di VPS. Simpan kunci ini baik-baik.
# salin baris "public key: age1..." ke BACKUP_AGE_RECIPIENT di .env
```

**Uji restore setelah setup** (backup yang belum pernah dites belum bisa dianggap backup):
```bash
docker compose stop app
docker compose run --rm -v $PWD/kosku-backup.key:/key:ro backup restore.sh db/hourly/<file>.dump.age
docker compose start app
```

### Monitoring
- `HEALTHCHECK_URL` (healthchecks.io, gratis) di-ping setelah setiap billing malam sukses. Jika satu malam terlewat, Anda diberi tahu.
- `BACKUP_HEALTHCHECK_URL`: sama, untuk backup.
- Superadmin → **Log & Sistem**: riwayat job, tombol "Jalankan sekarang", dan audit log.

### Perintah darurat (di server)
```bash
docker compose exec app node dist-server/cli.js reset-password <username>   # superadmin lupa password
docker compose exec app node dist-server/cli.js create-superadmin <username> "Nama"
docker compose exec app node dist-server/cli.js unlock <username>
docker compose exec app node dist-server/cli.js run-daily
```

### Update aplikasi
```bash
git pull && docker compose --profile tunnel up -d --build    # migrasi database berjalan otomatis saat start
```

---

## Catatan & batasan yang perlu Anda ketahui

- **WhatsApp tidak resmi.** Baileys memakai protokol WhatsApp Web, bukan WhatsApp Business API, sehingga selalu ada risiko nomor dibatasi.
  Aplikasi meminimalkan risikonya: pesan hanya ke penyewa, dikirim berurutan dengan jeda 4–9 detik, dan pengingat otomatis kedaluwarsa
  bila tertahan >24 jam. Jika WA terputus, pesan menunggu di antrean. Tombol `wa.me` tersedia sebagai kirim manual.
  Pesan yang diketik admin **langsung di HP** tidak tercatat di aplikasi (hanya pesan dari aplikasi dan pesan masuk).
  Lampiran dari nomor yang bukan penyewa, video, dan berkas selain foto/PDF tidak disimpan; lihat langsung di HP.
- **Tanda tangan elektronik** dicatat dengan jejak bukti (waktu, IP, perangkat, hash dokumen), tetapi bukan tanda tangan elektronik
  tersertifikasi (PSrE). Mintalah pihak hukum Anda meninjau template perjanjian.
- **Data pribadi (UU PDP):** KTP/KK hanya bisa dibuka admin/superadmin (staf tidak), dan setiap pembukaan tercatat di audit log.
  Aktifkan enkripsi disk VPS bila tersedia. Belum ada penghapusan permanen otomatis setelah masa retensi, karena tempat sampah
  menyimpan data sampai superadmin memulihkannya.
- **2FA (TOTP) belum diterapkan.** Proteksi saat ini: password ≥12 karakter, rate limit, kunci akun setelah 8 kali gagal, sesi yang bisa dicabut.
- Satu instance aplikasi per database (sinkronisasi dan rate limit disimpan di memori proses). Ini sesuai skala 1–3 properti.
- Admin menerima web push di iPhone hanya jika aplikasi dipasang ke Layar Utama (batasan iOS).

© 2026 Kosku · aplikasi internal

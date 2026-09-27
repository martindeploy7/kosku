# Kosku: local dan deployment

Dokumen ini memakai arsitektur yang sesuai dengan implementasi saat ini:

- lokal: PostgreSQL 17 di Docker, API Hono dan Vite native;
- preview/live awal: satu Render Web Service menjalankan FE + BE dari Dockerfile;
- database: Neon PostgreSQL;
- file upload: Cloudflare R2 melalui S3 API.

## Menjalankan lokal

Butuh Docker Desktop, Node.js >= 22.12, dan npm.

```bash
npm ci --ignore-scripts
npm run dev:db:docker
npm run dev:host
```

Jika Docker belum bisa menarik image PostgreSQL, gunakan PostgreSQL Homebrew yang
terisolasi di `.devdata/`:

```bash
npm run dev:db:host
npm run dev:host
```

Command tersebut membuat cluster lokal satu kali, menjalankannya di port `54329`,
dan membuat database `kosku` bila belum ada.

Buka:

- frontend: http://localhost:5173
- API health: http://localhost:8787/api/health

Password sementara superadmin dicetak oleh terminal API pada first boot. Login dengan
username `admin`, lalu ganti password. Data PostgreSQL tersimpan di Docker volume
`kosku_dev_pgdata`; file lokal tersimpan di `.devdata/`.

Untuk menghentikan database tanpa menghapus volume:

```bash
npm run dev:db:docker:down
```

## Deploy awal ke Render + Neon + R2

`render.yaml` sudah disediakan untuk membuat satu Web Service Docker. Free Render
adalah preview/live awal, bukan deployment production yang memiliki availability
guarantee: service tidur setelah idle, filesystem ephemeral, dan process WhatsApp/job
tidak dapat dianggap selalu aktif.

### 1. Neon

1. Buat project PostgreSQL di Neon, idealnya region yang dekat dengan Render (Singapore).
2. Ambil **direct connection string** dari branch utama, bukan connection string untuk
   aplikasi serverless yang memakai pooler transaction mode.
3. Tambahkan `sslmode=require` pada URL jika belum ada.

Contoh bentuk URL:

```text
postgresql://user:password@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

### 2. Cloudflare R2

Render Free tidak memiliki persistent disk. Karena aplikasi menyimpan KTP, bukti
transfer, foto, dan PDF, production wajib memakai object storage.

1. Buat bucket R2, misalnya `kosku-files`.
2. Buat API token dengan akses Object Read & Write hanya ke bucket tersebut.
3. Catat endpoint S3, access key, dan secret key.

Environment variable yang dibutuhkan:

```text
STORAGE_DRIVER=s3
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=kosku-files
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
```

### 3. Render

1. Push repository ke GitHub.
2. Di Render pilih **New -> Blueprint** dan pilih repository.
3. Render membaca `render.yaml`; pilih Free untuk percobaan awal.
4. Isi secret yang diminta:
   - `PUBLIC_URL`: URL final Render, atau domain custom HTTPS;
   - `DATABASE_URL`: connection string Neon;
   - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
   - `HEALTHCHECK_URL` jika memakai healthchecks.io.
5. Deploy dan cek `https://<service>.onrender.com/api/health`.
6. Baca log first boot untuk password sementara `admin`, login, lalu segera ganti password.

Blueprint Free sengaja memakai `WA_DRIVER=mock` dan `JOBS_ENABLED=false`. Aktifkan
`WA_DRIVER=baileys` dan `JOBS_ENABLED=true` hanya setelah backend dipindahkan ke
service always-on dengan storage/session strategy yang sesuai.

Migrasi database berjalan otomatis ketika server boot. Jangan menjalankan `seed-demo`
terhadap database production.

## Setelah live

- Uji login, ganti password, buat properti, upload dokumen, buat sewa, invoice, dan
  tanda tangan kontrak dari perangkat lain.
- Hubungkan WhatsApp hanya setelah URL HTTPS final stabil.
- Setiap deploy/restart Free Render dapat memutus sesi WhatsApp dan menunda job harian.
- Simpan export/backup database secara terpisah. Backup container Docker di repository
  tidak berjalan otomatis di Render Free.

## Saat siap production sungguhan

Naikkan backend ke Render paid atau VPS kecil dengan Docker Compose. Stack production
yang sudah ada di repository mendukung PostgreSQL, app, Cloudflare Tunnel/Caddy, dan
backup terenkripsi ke R2. Neon tetap dapat dipakai sebagai database managed, tetapi
pastikan backup dan restore diuji sebelum data keuangan/identitas dipakai sungguhan.

Vercel dapat dipakai untuk frontend terpisah, tetapi membutuhkan rewrite `/api` ke
Render dan perhatian khusus pada cookie/session. Karena aplikasi sekarang sudah
menyajikan frontend dari backend, satu Render Web Service lebih sederhana dan aman
untuk tahap awal.

# Permintaan bantuan IT support — keluhkampus.my.id

**Subjek:** Audit dan perbaikan koneksi PostgreSQL, login/register 500, serta auto-deploy Next.js di JKC

Mohon bantu periksa aplikasi langsung dari lingkungan hosting. Beberapa perbaikan database sudah berhasil, tetapi daftar/login masih gagal. Mohon jangan hanya mengecek homepage atau mengulang reset password. Dokumen ini tidak memuat password, API key, atau JWT secret.

## Identitas aplikasi

- Domain: https://keluhkampus.my.id
- Akun cPanel: `keluhkam`
- App root yang ditampilkan cPanel: `/home/keluhkam/public_html/keluhkampus.my.id`
- App URI yang pernah ditampilkan Node.js Selector: `keluhkampus.my.id/keluhkampus.my.id`
- PostgreSQL: `127.0.0.200:5432`, versi 13.23 dari phpPgAdmin
- Database: `keluhkam_keluhkampus_db`
- User aplikasi PostgreSQL: `keluhkam_user`
- Login phpPgAdmin: `keluhkam` — berbeda dari user koneksi aplikasi
- Stack repo: Next.js 16.2.12, Prisma Client 6.19.3; Node hosting pada log: 20.20.2
- Repo: https://github.com/Bagasbzz/kelkam
- Deploy yang sudah diperiksa: https://github.com/Bagasbzz/kelkam/actions/runs/36321443207 — commit `0d6d07a`, 27 September 2026

## Yang sudah dilakukan — jangan dianggap masih belum dikerjakan

1. Username URL aplikasi sudah diarahkan ke `keluhkam_user`; password user PostgreSQL dan kedua connection string di GitHub Secrets/cPanel telah diperbarui menurut pengguna. Nilai efektif di proses Node belum diperiksa langsung.
2. Empat migrasi repo sudah diterapkan melalui SQL phpPgAdmin. Hasil hosting: `SETUP OK`, `migrations_applied=4`, tabel `users`/`sessions` ada, kolom `role=TRUE`, akses user aplikasi ke kedua tabel `TRUE`.
3. CONNECT dan grant tabel sudah diberikan. Tabel aplikasi jangan dihapus, di-reset, atau diimpor ulang.
4. Synchronize Grants cPanel sudah dilakukan dan menampilkan `PostgreSQL grants have been synchronized`. Daftar/login masih gagal setelahnya.
5. Sebelum langkah itu, Current Databases menunjukkan kolom Privileged Users kosong, walaupun user ada. Hasil listing setelah sinkronisasi belum terlihat; mohon periksa kondisi aktual, jangan menganggap screenshot lama adalah kondisi terbaru.
6. Restart manual Node.js pernah dilakukan beberapa kali. Restart otomatis melalui workflow berbeda dan diketahui gagal.

## A. Prioritas utama — koneksi aplikasi dan error 500

**Gejala terkonfirmasi:** pendaftaran menampilkan kegagalan; login mengembalikan HTTP 500. Homepage dapat dibuka.

**Log backend terakhir yang tersedia sebelum sinkronisasi grants:**

```text
PrismaClientInitializationError
Invalid prisma.user.findUnique() invocation
User was denied access on the database `127.0.0.1`
```

Di riwayat psql juga pernah muncul `no pg_hba.conf entry for host "127.0.0.1" ... SSL off`. Log backend baru setelah sinkronisasi belum diambil; penyebab 500 saat ini tidak boleh diasumsikan pasti sama.

**Mohon periksa dan berikan bukti hasil:**

- PID/proses Node yang benar-benar melayani domain, startup file, app root, versi Node dan BUILD_ID aktif.
- DATABASE_URL efektif di proses itu: cukup username, host, port dan nama database; jangan tampilkan password.
- Sumber/precedence konfigurasi antara Node.js Selector, `.env`, `.env.local`, dan `.htaccess`; periksa apakah ada konfigurasi atau aplikasi lama yang masih melayani request.
- Tes koneksi dari lingkungan aplikasi memakai `keluhkam_user`, bukan hanya login phpPgAdmin sebagai `keluhkam`. Jalankan query sederhana dan baca `public.users`; uji tulis dengan transaksi yang dibatalkan.
- Jika ditolak, ambil pesan PostgreSQL asli dan SQLSTATE, kemudian periksa mapping cPanel, `pg_hba.conf`, alamat sumber, serta metode autentikasi/TLS yang benar-benar didukung.
- Jika koneksi sudah berhasil, telusuri request daftar/login baru hingga hashing password, insert user, insert session, penandatanganan JWT dan cookie. Catat langkah tepat yang gagal, bukan hanya HTTP 500.

**Catatan:** Prisma 6.19.3 dapat mengambil IP dari pesan pg_hba sebagai nama database. Karena itu tulisan database `127.0.0.1` tidak membuktikan host URL harus diganti dari `127.0.0.200`. SSL juga tidak boleh diubah berdasarkan tebakan.

## B. Auto-deploy belum berhasil end-to-end

Log run di atas membuktikan:

| Langkah | Hasil aktual |
|---|---|
| Migrasi Prisma di runner GitHub | P1001, gagal menjangkau `127.0.0.200:5432` |
| Seed admin | Gagal koneksi database |
| Upload ZIP | Workflow melanjutkan setelah tahap upload; ZIP terlihat di File Manager |
| Ekstraksi ZIP | Kelima fungsi Fileman yang dicoba tidak ditemukan; tidak diekstrak otomatis |
| Restart otomatis | Fileman/save_file tidak ditemukan; JSON status 0 |
| Penulisan `.env` otomatis | Gagal karena fungsi save_file tidak tersedia |
| Penulisan `.htaccess` otomatis | Gagal karena fungsi save_file tidak tersedia |
| Status workflow | Tetap hijau, karena kegagalan diabaikan |
| Health check | Hanya GET homepage; HTTP 200 bukan bukti DB/auth sehat |

**Yang perlu diselesaikan bersama pengembang:**

- Konfirmasi metode upload, penggantian file/ekstraksi, dan restart yang didukung paket JKC ini. Jangan menggunakan nama fungsi API spekulatif atau mengasumsikan SSH publik tersedia.
- Bedakan keberhasilan HTTP API dari `status` JSON operasi cPanel. Gagal ekstraksi/env/restart harus menggagalkan pipeline.
- Pilih mekanisme deploy konsisten dengan backup/release sebelumnya dan verifikasi BUILD_ID, tidak mencampur chunk/build lama dan baru.
- Tulis konfigurasi sebelum restart. Workflow sekarang meletakkan restart sebelum penulisan `.env`.
- Jangan menimpa konfigurasi domain lain ketika mengubah `.htaccess` induk.
- Pastikan file ZIP deploy, log, source dan file rahasia tidak dapat diunduh publik. Ini pemeriksaan preventif; akses publik ke file tersebut belum diuji.
- Tambahkan pemeriksaan DB/schema dan auth setelah deploy, bukan hanya homepage.

## C. Migrasi berikutnya belum otomatis dan membutuhkan role yang sesuai

Migrasi empat file sudah berhasil dipasang secara manual; masalah otomatisasinya belum diperbaiki.

`127.0.0.200` adalah loopback mesin tempat perintah berjalan. Runner GitHub tidak dapat memakai alamat itu untuk mengakses database JKC tanpa mekanisme khusus. Pilih lokasi eksekusi migrasi yang memang dapat mengakses PostgreSQL internal.

Role `keluhkam_user` diberi izin aplikasi, bukan otomatis kepemilikan tabel/DDL. Objek dibuat melalui phpPgAdmin. Mohon verifikasi pemilik objek dan tentukan role migrasi yang tepat. Jangan mengandalkan connection string DML yang sama untuk mengubah skema; jangan reset atau menjalankan migrate dev di production.

## D. Startup Next.js dan routing belum konsisten

- Root `server.js` adalah custom server yang membuang prefix `/keluhkampus.my.id` sebelum meneruskan ke Next.js.
- `public/.htaccess` melakukan rewrite ke prefix tersebut.
- `scripts/build-deploy.js` menimpa server standalone dengan custom `server.js`.
- Workflow GitHub mempertahankan server standalone bawaan Next.js, yang tidak memuat adapter prefix custom tersebut.

Mohon tetapkan satu konfigurasi startup/routing yang cocok dengan Node.js Selector/LiteSpeed di hosting dan uji route halaman serta API. Jangan sekadar mengganti startup file dengan `.next/standalone/server.js`: CI menyalin isi standalone ke root deploy, sehingga lokasi file di hosting bisa berbeda.

Riwayat log mengandung missing webpack/next, missing Prisma engine OpenSSL 1.1.x, ChunkLoadError, panic `timer has gone away`, dan ERR_SERVER_NOT_RUNNING. Semua ini pernah terjadi, tetapi lognya bercampur tanpa timestamp. Pisahkan log baru per proses/release; jangan menyatakan semuanya masih aktif. Binary target OpenSSL 1.1.x dan prisma generate sudah ada di repo; verifikasi artefak yang benar-benar aktif sebelum mengganti target.

## E. Akun admin belum terverifikasi

Akun yang dituju: `hensellbagas@gmail.com`. Skrip `prisma/seed.ts` hanya mempromosikan user yang sudah ada; tidak membuat user/password. Seed di run yang diaudit gagal. Pastikan akun benar-benar terdaftar dan pemiliknya sesuai, baru promosikan role ADMIN tanpa membagikan password.

Route admin repo saat ini adalah `/tugas/admin694`, sedangkan screenshot penggunaan masih menampilkan `/tugas/admin`. Verifikasi route dan BUILD_ID aktif; perbedaan ini bukan penyebab langsung API login 500.

## F. Temuan kode untuk pengembang, bukan hanya support hosting

1. Token JWT sesi tidak mempunyai nonce/jti. Dua login user yang sama dalam satu detik dapat menghasilkan token identik. Token dipakai sebagai primary key sesi; insert kedua bisa gagal P2002/500. Direproduksi lokal dengan jose dan data dummy.
2. Insert user lalu insert session tidak satu transaksi; kegagalan session dapat meninggalkan akun terbuat tetapi respons pendaftaran gagal.
3. Secret JWT kosong di production tidak ditolak; kode masih mempunyai fallback development yang diketahui. Perlu validasi saat startup.
4. Workflow `audit.yml` berusaha mencetak raw `.env` dan app settings. Jangan menjalankannya tanpa redaksi nilai sensitif; GitHub masking bukan jaminan semua nilai tersembunyi.
5. Beberapa secret pernah terlihat di screenshot/chat. Rotasi terkoordinasi diperlukan sebagai pekerjaan keamanan terpisah, dengan pembaruan konsisten dan tanpa mencetak nilainya. Jangan menyamakan rotasi dengan diagnosis error koneksi.

Temuan kode ini tidak menjelaskan error inisialisasi pada user.findUnique jika koneksi DB sendiri masih ditolak.

## G. Konfigurasi yang perlu dipertahankan

```text
AI_BASE_URL=https://api.z0ne.ai/v1
AI_MODEL=gpt-5.6-luna
AI_MODEL_FAST=gpt-5.6-luna
AI_MODEL_REVIEW=gpt-5.6-luna
UPLOAD_DIR=/home/keluhkam/public_html/keluhkampus.my.id/uploads
```

AI dan upload bukan penyebab error koneksi di user.findUnique. Nilai model di atas sesuai keputusan pengguna, bukan hasil membaca Secrets saat ini. Source masih punya fallback model lain jika env tidak terbaca. Setelah auth pulih, pastikan env efektif dan uji fitur AI/upload secara terpisah, termasuk izin tulis direktori.

## Kriteria selesai yang diminta

- Koneksi dan query berhasil dari proses/lingkungan aplikasi dengan role yang dimaksud.
- Daftar berhasil membuat satu akun dan sesi; logout/login ulang berhasil; kredensial salah memberikan 401, bukan 500.
- Akun target memiliki akses ADMIN; user biasa tetap ditolak.
- Route homepage, login, studio, API dan halaman admin bekerja dengan routing yang disepakati.
- Satu deploy terkontrol memasang BUILD_ID baru, menjaga data/upload, membaca env yang benar dan me-restart proses aktif.
- Pipeline gagal dengan jelas jika instalasi/migrasi/restart/readiness gagal; jangan memaksa failure di production untuk mengetes ini, gunakan staging/mocks.
- Hasil pemeriksaan dikirim berupa konfigurasi nonrahasia, log bertimestamp dan langkah yang diperbaiki. Tanpa password/API key/JWT secret.

**Batas otorisasi:** Jangan hapus/reset database, mengubah password sepihak, menonaktifkan autentikasi, membuka PostgreSQL ke semua IP, atau mengganti provider/model AI. Backup sebelum perubahan skema/deployment. Mohon jelaskan bagian yang memerlukan perubahan repo dan bagian yang harus ditangani administrator hosting.

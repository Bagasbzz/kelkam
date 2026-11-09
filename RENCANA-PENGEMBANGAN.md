# Rencana & Progres Pengembangan keluhkampus

> **Untuk AI/pengembang berikutnya:** baca file ini dulu sebelum mengerjakan apa pun.
> File ini adalah catatan resmi rencana, keputusan pemilik, dan progres. Setiap ada keputusan
> baru atau pekerjaan selesai, **perbarui file ini** (bagian Keputusan, Tahapan, dan Log Progres).
>
> Aturan dari pemilik: tahap rancangan **bukan izin implementasi**. Jangan ubah kode, database,
> atau konfigurasi untuk fitur di bawah sampai pemilik meminta secara eksplisit.

Terakhir diperbarui: 2026-11-07

---

## 1. Konteks proyek

- Situs: https://keluhkampus.my.id, repo `Bagasbzz/kelkam`, branch `main`.
- Stack: Next.js 16 (App Router), React 19, Prisma + PostgreSQL, hosting Jagoan Hosting (cPanel, Passenger).
- Deploy: push ke `main` → GitHub Actions (tes, build, upload, restart, verifikasi rilis). Lihat `DEPLOYMENT.md`.
- Pemilik & satu-satunya super admin: **hensellbagas@gmail.com**. Saat ini belum ada dosen/asdos; pengguna lain hanya beberapa user biasa.
- AI: penyedia token pihak ketiga (Mindaku, OpenAI-compatible) yang jauh lebih murah dari harga resmi
  (pemilik membeli 1 USD kredit ≈ Rp1.000). Biaya AI saat ini ditanggung pemilik.
- Prioritas bisnis sekarang: **mengumpulkan pengguna, biarkan mereka mencoba dengan bebas**. Batas pemakaian dan
  fitur berbayar disiapkan nanti, dinyalakan kapan saja oleh pemilik.

## 2. Temuan kondisi sistem (per 2026-11-07)

### Autentikasi
- Email + sandi (argon2id), JWT HS256 30 hari di cookie httpOnly, sesi tersimpan di tabel `sessions` (bisa dicabut).
  Role dibaca dari DB tiap request (`src/lib/server/auth.ts` → `getCurrentUser`), bukan dari browser.
- **Tidak ada OTP / verifikasi email** dan tidak ada layanan pengiriman email. Tidak ada "lupa sandi" mandiri.

### Role (RISIKO TINGGI, belum diperbaiki)
- Hanya ada `USER` dan `ADMIN` (`prisma/schema.prisma` enum `UserRole`). `ADMIN` dipakai untuk asdos/dosen (Tugas)
  **dan** admin global sekaligus.
- Setiap `ADMIN` bisa memakai `/api/admin/users` untuk **reset sandi siapa pun (termasuk super admin)** dan
  menjadikan orang lain `ADMIN`. Juga bisa membuka db-health, waitlist, insights global.
- Super admin "ditetapkan" lewat `prisma/seed.ts` yang mencocokkan teks email lalu set role `ADMIN`.
- Halaman admin di `/tugas/admin694` (path tersembunyi; API tetap dicek `requireAdmin` di server).
- Saat ini aman secara praktis karena satu-satunya `ADMIN` adalah pemilik, tetapi wajib diperbaiki sebelum
  ada dosen/asdos yang diberi akses.

### Maintenance & subdomain
- Belum ada mode maintenance. Tidak ada subdomain admin di kode.

### Data untuk analitik
- Ada: `users.created_at`, `agent_runs` (tool, pemilik, waktu, langkah), `report_jobs.tokens_used`, `image_jobs`,
  riwayat chat Laporan (`report_messages`) & Presentasi (di metadata proyek), file unggahan.
- Belum ada: kunjungan halaman, `last_seen`, riwayat login (baris sesi dihapus saat logout), feedback kepuasan.
- Token aktual dari provider hanya dicatat di sebagian fitur (laporan, UML).
- Anggaran AI harian: `src/lib/server/ai-budget.ts`, ledger file di `uploads/.ai-budget/` (pemilik di-hash),
  isinya **cadangan perkiraan**, bukan tagihan aktual.

## 3. Keputusan pemilik

| # | Topik | Keputusan | Status |
|---|---|---|---|
| K1 | Batas per pengguna | **Belum dipakai.** User bebas. Nanti bisa dinyalakan, lalu mungkin premium. | Diterapkan 2026-11-07 (lihat Log) |
| K2 | Saklar batas & premium | Dirancang terpisah (rem global selalu aktif, kuota on/off, premium on/off bergantung kuota). Pemilik belum memutuskan detail. | Rancangan |
| K3 | Satuan kuota (per pemakaian tool / kredit / token) | Belum diputuskan; perlu dijelaskan ulang ke pemilik dengan contoh. | Terbuka |
| K4 | Akses isi prompt | Boleh keduanya: ringkasan tema keluhan **dan** isi mentah bila pemilik meminta. Akses mentah hanya super admin, tercatat (audit), ada masa simpan. | Disetujui |
| K5 | Identitas super admin | Dikunci ke ID akun di DB + role, bukan teks email; ditambah 2FA atau login Google yang terikat. | Disetujui |
| K6 | Login sandi setelah ada Google | Tetap ada. | Disetujui |
| K7 | Analitik | Tabel milik sendiri dulu (bukan GA/Plausible). | Disetujui |
| K8 | Proses AI saat maintenance | **Dijeda**, bukan dibiarkan selesai. | Disetujui |
| K9 | Pembayaran premium | **Manual**: QRIS → pengguna unggah bukti bayar → bisa chat WA pemilik → pemilik verifikasi & aktifkan manual. Belum pakai payment gateway. | Disetujui (arah) |
| K10 | Akun lama tanpa verifikasi email | Usulan: tidak dipaksa verifikasi. Login Google pertama dengan email sama → akun ditautkan, sesi lama dicabut, sandi lama wajib diatur ulang. | Menunggu konfirmasi |
| K11 | Subdomain admin | Usulan: tidak perlu subdomain; super admin login lewat `/login` biasa yang tetap terbuka saat maintenance. | Menunggu konfirmasi |
| K12 | Anggaran rem darurat AI | Default sementara 200 juta unit, 20.000 panggilan, 300 gambar per hari untuk seluruh situs (bisa diubah via env). | Sementara, perlu konfirmasi |

## 4. Rancangan ringkas per fitur

### A. Batas pemakaian & premium
- Tiga lapis: **rem biaya global** (selalu aktif) · **kuota pengguna** (saklar) · **premium** (saklar, hanya bisa nyala jika kuota nyala).
- Super admin selalu dikecualikan dari kuota.
- Teknis: pindahkan ledger dari file ke tabel DB, cadangkan dulu lalu koreksi dengan token aktual; tabel `settings`
  (saklar), `plans`, `subscriptions`, `payments` (bukti transfer manual + status verifikasi).
- Alur premium manual (K9): halaman paket → instruksi QRIS → unggah bukti → status "menunggu verifikasi" →
  super admin setujui/tolak di dashboard → masa aktif berjalan.

### B. Login Google
- OAuth/OpenID: Google mengembalikan email terverifikasi + `sub`; simpan di tabel `auth_accounts`; sesi tetap memakai cookie yang ada.
- Tidak butuh email berdomain keluhkampus. Butuh: project Google Cloud, domain terverifikasi, **halaman kebijakan privasi & syarat layanan** (belum ada).
- Email berdomain hanya perlu untuk email sistem (reset sandi, notifikasi): cukup layanan pengirim (SMTP hosting/Resend/Brevo/SES), tidak wajib Google Workspace.

### C. Analitik
- Definisi: **kunjungan** = halaman dibuka (termasuk tamu) · **login** = peristiwa masuk · **aktif** = akun yang memakai tool
  (harian/mingguan/bulanan) · **online** = ada aktivitas 2–5 menit terakhir · **kembali** = aktif ≥2 hari berbeda.
- Tabel baru: `activity_events`, `login_events`, kolom `users.last_seen_at`, `ai_usage` (token aktual + estimasi biaya,
  diberi label jelas). Mulai mencatat lebih awal karena data tidak bisa diisi mundur.
- Feedback sengaja (👍/👎, form "laporkan masalah") dipisah dari kesimpulan AI atas percakapan (tema agregat).

### D. Role & super admin
- Role baru: `USER`, `PENGAJAR`, `SUPER_ADMIN`. `ADMIN` lama → `PENGAJAR`; hanya akun pemilik → `SUPER_ADMIN`.
- Super admin dikunci ke `SUPER_ADMIN_USER_ID` (env server) **dan** kolom role; tidak ada endpoint yang bisa memberi role ini.
- Helper terpisah: `requireSuperAdmin`, `requirePengajar`, izin per mata kuliah. Pengajar tidak bisa reset sandi orang lain atau ubah role.
- Penguatan: 2FA/Google terikat, sesi super admin lebih pendek, konfirmasi ulang aksi sensitif, log audit admin.

### E. Mode maintenance
- Saklar di DB (tanpa deploy ulang). Ditegakkan di gateway `src/proxy.ts` (halaman → halaman maintenance, API → 503)
  dan di helper auth server sebagai lapis kedua. Pengecualian hanya untuk sesi DB dengan role `SUPER_ADMIN`.
- Proses latar (agent run, report job, image job, cron) dicek sebelum langkah berikutnya → **dijeda** (K8).

## 5. Tahapan pengerjaan

| Tahap | Isi | Status |
|---|---|---|
| 0 | Lepas batas AI per pengguna (user bebas), rem global dinaikkan | ✅ Selesai 2026-11-07 |
| 1 | Role `SUPER_ADMIN`/`PENGAJAR` + tutup celah reset sandi & ubah role + log audit | Belum mulai |
| 2 | Tabel `settings` (saklar) + mode maintenance (dibangun, posisi mati) | Belum mulai |
| 3 | Pencatatan data: aktivitas, login, last_seen, token aktual, feedback 👍/👎 | Belum mulai |
| 4 | Dashboard analitik ringkasan + detail pengguna | Belum mulai |
| 5 | Mesin kuota di DB (posisi mati) | Belum mulai |
| 6 | Paket premium + pembayaran manual QRIS (posisi mati) | Belum mulai |
| 7 | Halaman kebijakan privasi & syarat layanan, lalu login Google (+ layanan email bila perlu) | Belum mulai |

## 6. Pertanyaan terbuka untuk pemilik
1. K3: satuan kuota yang paling mudah dipahami pengguna (perlu contoh konkret saat dibahas).
2. K10: setuju akun lama tidak dipaksa verifikasi dan ditautkan saat login Google pertama?
3. K11: setuju tanpa subdomain admin?
4. K12: berapa anggaran AI maksimum per hari/bulan yang nyaman? (dipakai untuk rem darurat)
5. Apakah respons API Mindaku menyertakan jumlah token (`usage`) dan apakah ada daftar harga per model?
   Akan dicek teknis saat Tahap 3.

## 7. Log progres

### 2026-11-07
- Presentasi diubah menjadi chat AI bergaya Laporan (commit `6757c2e`, deploy run #145 sukses):
  AI membaca bahan/laporan sendiri, menyusun rencana, template, usulan gambar dengan persetujuan; tombol
  "Buat presentasi dari laporan ini" di Laporan; mode Chat AI / Edit slide.
- Ditemukan: chat Presentasi terhenti "Batas pemakaian AI tercapai" karena batas harian per pengguna bawaan
  (600 ribu unit, 100 panggilan, 3 gambar) dari commit `844dd00` (2026-11-02).
- **Tahap 0:** batas per pengguna dimatikan secara default (`AI_USER_LIMITS_ENABLED` harus `true` untuk menyalakan);
  rem global dinaikkan ke 200 juta unit / 20.000 panggilan / 300 gambar per hari (env `AI_DAILY_*_GLOBAL`
  tetap bisa menimpa). File: `src/lib/server/ai-budget.ts`, tes di `scripts/security-ai.test.ts`.
- Rancangan fitur A–E disusun dan didiskusikan; keputusan dicatat di bagian 3.
- Perbaikan chat Presentasi yang gagal "Layanan AI belum dapat menyelesaikan permintaan": langkah terakhir menulis
  seluruh deck dalam satu jawaban melewati batas waktu ±90 detik per langkah server. Sekarang AI menulis slide
  bertahap lewat tool `writeSlides` (maks. 4 slide per panggilan, draft disimpan di meta run sehingga aman saat
  segmen server berganti), lalu `finishDeck` merakit deck. `commit_deck` ditolak pada chat. Langkah chat maks. 20.
  Proyek baru tidak lagi mengirim slide contoh ke AI. File: `presentasi/repository.ts`, `chat.ts`, `assistant.ts`.
- Permintaan pemilik berikutnya (belum dikerjakan): desain PPT harus unik per generate, bukan sekadar mengisi
  teks ke template. Lihat bagian 8.

## 8. Presentasi: desain unik per generate (permintaan 2026-11-07)

Keluhan pemilik: hasil PPT hanya mengisi teks ke template yang tersedia, dan templatenya masih dianggap jelek.
Yang diinginkan: setiap generate menghasilkan desain khusus, yaitu ilustrasi/objek yang relevan dengan topik,
warna dan latar yang disesuaikan, gambar dari laporan dimasukkan rapi, serta logo kampus bila ada.

### Referensi pemilik (dari chat Kilo Code 2026-11-02 s/d 11-07)
- Target kualitas: seperti **Gamma AI** dan template **Canva**, bukan template khas ChatGPT/Claude.
  Tidak hanya untuk sidang; juga presentasi makalah di kelas dan materi sederhana.
- Link Canva yang dikirim: https://www.canva.com/templates/EAFs0Ab5APE/ ,
  https://www.canva.com/templates/EAHLHupW5w0/ , https://www.canva.com/templates/EAGp4cMIF34/
- Screenshot contoh (5 Nov): (1) "Bisnis Presentasi" putih-biru: foto besar dalam bingkai heksagon/diagonal,
  bidang biru tegas dan garis kuning; (2) "Desainer Grafis": latar hitam, judul raksasa hijau lime dengan foto
  cutout orang menembus teks; (3) "Tugas Kelompok" putih-kuning: kolase cutout halftone (tangan, buku, puzzle),
  tekstur kertas, blob kuning, label pil hitam; (4) hitam-merah: blok gradien abstrak, tipografi bersih.
- Kesimpulan: yang membuat contoh itu bagus adalah **gambar/foto berukuran besar yang relevan**, **komposisi
  berani** (bingkai bentuk, teks raksasa, kolase), dan **dekorasi** (blob, halftone, garis, kutipan, pil).
  Renderer saat ini hanya punya 5 layout, motif garis sederhana, dan palet tetap, serta gambar baru muncul
  jika pengguna membuatnya manual.

### Usulan arah (menunggu persetujuan pemilik)
1. Gambar AI menjadi bagian inti: setiap deck otomatis dibuatkan 3–6 gambar (foto ilustratif/cutout) sesuai
   topik setelah slide tersusun; slide tampil dulu, gambar menyusul. Bisa dimatikan pengguna.
2. Gaya per deck dibuat AI: warna utama/aksen/latar (dengan pengecekan kontras), pasangan font aman PPTX,
   dan keluarga bentuk (geometris tegas, kolase halftone, gelap-gradien, minimal, organik).
3. Pustaka komposisi baru ±15–20 layout ala Canva: foto dalam bingkai heksagon/diagonal/lingkaran, judul
   raksasa + cutout, kolase, angka besar, perbandingan, kutipan, slide gambar laporan (gambar + keterangan
   "Gambar x.y"), dll. Dekorasi ditempatkan dengan variasi terkendali (seed per deck) sehingga tiap generate berbeda.
4. Gambar dari laporan dimasukkan rapi di layout khusus; logo kampus sebagai aset deck (unggah atau dari bahan),
   tampil di sampul dan kecil di slide lain.
5. Ekspor PPTX: bingkai bentuk dirender menjadi PNG agar sama dengan pratinjau; teks tetap bisa diedit.
- Ditolak: AI menulis SVG/HTML bebas per slide (hasil tidak konsisten, lambat/kena batas waktu, sulit diekspor
  ke PPTX yang bisa diedit, risiko keamanan).
- Usulan urutan: (a) gaya per deck + layout & dekorasi baru + slide gambar laporan + logo,
  (b) gambar AI otomatis, (c) kesamaan ekspor PPTX.

### 2026-11-09
- **Perbaikan Laporan rusak** (semua bab berisi "respons AI gagal", sumber 0, tanpa gambar):
  - Asisten kembali wajib mencari sumber (`findSources` tiap query, lalu `selectSources`) setelah membuat rencana;
    `startExecution` ditolak bila belum ada sumber tercentang. Panduan jumlah bab per jenis dokumen dikembalikan.
  - Laporan penuh kembali memakai diagram/ilustrasi secara bawaan (`diagrams: include`), kecuali pengguna menolak.
  - Penulisan bab: bila streaming gagal/kosong di provider, otomatis mencoba permintaan biasa (tanpa stream).
  - Penanda lama `[SISTEM] ... Tulis jawaban akhir SEKARANG` di riwayat run dibuang agar AI tidak menganggapnya injeksi.
  - File: `laporan/assistant.ts`, `report/report-intent.ts`, `report/generate-report.ts`, `agent-runs/engine.ts`.
- Desain presentasi baru (bagian 8) sedang dikerjakan di lokal: `src/lib/presentation/design.ts` (renderer 12 komposisi,
  10 gaya contoh, warna/font per deck, bingkai foto, logo). Belum di-commit; integrasi AI (`setPlan.design`) belum.

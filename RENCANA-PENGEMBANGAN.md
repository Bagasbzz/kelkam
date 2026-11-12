# Rencana & Progres Pengembangan keluhkampus

> **Untuk AI/pengembang berikutnya:** baca file ini dulu sebelum mengerjakan apa pun.
> File ini adalah catatan resmi rencana, keputusan pemilik, dan progres. Setiap ada keputusan
> baru atau pekerjaan selesai, **perbarui file ini** (bagian Keputusan, Tahapan, dan Log Progres).
>
> Aturan dari pemilik: tahap rancangan **bukan izin implementasi**. Jangan ubah kode, database,
> atau konfigurasi untuk fitur di bawah sampai pemilik meminta secara eksplisit.

Terakhir diperbarui: 2026-11-09

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
| K3 | Satuan kuota (per pemakaian tool / kredit / token) | **Rupiah saldo** (keputusan pemilik 2026-11-11): batas global dan per pengguna ditulis dalam rupiah, diatur dari panel super admin, periode harian/mingguan/bulanan. Kurs Mindaku 1 USD = Rp1.000 (batas Rp50.000 = kredit 50 USD). Token input/output dihitung sistem dari tabel harga per model. Lihat bagian 21. | Diterapkan 2026-11-11 |
| K4 | Akses isi prompt | Boleh keduanya: ringkasan tema keluhan **dan** isi mentah bila pemilik meminta. Akses mentah hanya super admin, tercatat (audit), ada masa simpan. | Disetujui |
| K5 | Identitas super admin | Dikunci ke ID akun di DB + role, bukan teks email; ditambah 2FA atau login Google yang terikat. | Disetujui |
| K6 | Login sandi setelah ada Google | Tetap ada. | Disetujui |
| K7 | Analitik | Tabel milik sendiri dulu (bukan GA/Plausible). | Disetujui |
| K8 | Proses AI saat maintenance | **Dijeda**, bukan dibiarkan selesai. | Disetujui |
| K9 | Pembayaran premium | **Manual**: QRIS → pengguna unggah bukti bayar → bisa chat WA pemilik → pemilik verifikasi & aktifkan manual. Belum pakai payment gateway. | Disetujui (arah) |
| K10 | Akun lama tanpa verifikasi email | Usulan: tidak dipaksa verifikasi. Login Google pertama dengan email sama → akun ditautkan, sesi lama dicabut, sandi lama wajib diatur ulang. | Menunggu konfirmasi |
| K11 | Subdomain admin | **Pakai subdomain khusus super admin** (keputusan pemilik 2026-11-10) untuk mengurus Tugas dan seluruh sistem (analitik, akun, maintenance), terpisah dari admin Tugas `/tugas/admin694` (admin course/pengajar). Dikerjakan bersama Tahap 1 (role) dan Tahap 4 (dashboard). | Disetujui |
| K12 | Anggaran rem darurat AI | Default sementara 200 juta unit, 20.000 panggilan, 300 gambar per hari untuk seluruh situs (bisa diubah via env). | Sementara, perlu konfirmasi |
| K13 | Jenis sumber Laporan | Tambah: buku & bab buku, skripsi/tesis/preprint, dokumen resmi/regulasi, artikel web/berita tepercaya (selain jurnal/prosiding). Tiap jenis punya verifikasi sendiri (DOI, ISBN, domain tepercaya). | Disetujui 2026-11-09 |
| K14 | Urutan & pencarian web | Bertahap: buku + skripsi dulu (gratis). Dokumen resmi & web menyusul setelah pemilik mendaftar kunci API pencarian web (Brave/Tavily). | Disetujui 2026-11-09 |
| K15 | Tampilan sumber | Chip filter "Semua · Jurnal · Buku · Resmi · Web · Skripsi" + jumlah, label warna jenis di tiap kartu. | Disetujui 2026-11-09 |
| K16 | Campuran sumber | AI mencari semua jenis sesuai topik, jurnal tetap mayoritas; pengguna bisa minta lewat chat ("tambah buku", "jurnal saja"). | Disetujui 2026-11-09 |
| K17 | Audit gagal setelah batas putaran | Hasil tetap dikirim **disertai catatan masalah yang tersisa**. | Disetujui 2026-11-09 |
| K18 | Putaran audit | Maksimal **2** siklus audit → perbaiki → audit ulang. | Disetujui 2026-11-09 |
| K19 | Tampilan selama audit | Pengguna hanya melihat **progres**; isi baru muncul setelah lulus audit (atau batas putaran habis, K17). | Disetujui 2026-11-09 |
| K20 | Urutan audit | **Laporan dulu**, Presentasi di tahap berikutnya. | Disetujui 2026-11-09 |

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
| 1 | Role `SUPER_ADMIN`/`PENGAJAR` + tutup celah reset sandi & ubah role + log audit | ✅ 2026-11-11 (versi tanpa ubah enum DB, lihat bagian 19) |
| 2 | Tabel `settings` (saklar) + mode maintenance (dibangun, posisi mati) | ✅ 2026-11-11 (bagian 22), saklar di /superadmin |
| 3 | Pencatatan data: aktivitas, login, last_seen, token aktual, feedback 👍/👎 | ✅ Kode selesai 2026-11-10; aktif setelah SQL `database-hotfix-2026-11-10-analytics.sql` dijalankan |
| 4 | Dashboard analitik ringkasan + detail pengguna | ✅ 2026-11-11 (bagian 22): tren 30 hari, retensi, online, /superadmin/pengguna + detail |
| 5 | Mesin kuota di DB (posisi mati) | ✅ 2026-11-11 dalam bentuk batas biaya rupiah (bagian 21), posisi mati sampai diaktifkan di panel |
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
- **Desain presentasi baru dirilis** (bagian 8, tahap a): renderer `src/lib/presentation/design.ts` dengan 11 komposisi
  (cover, section, agenda, bullets, photo, quote, stats, process, compare, figure, closing), 10 gaya contoh,
  warna/font/bingkai per deck dari `setPlan.design`, seed acak tiap generate, logo kampus, foto berbingkai
  (ellipse/poligon, juga di PPTX). Diagram laporan yang disetujui dijadikan PNG saat "Buat presentasi dari laporan"
  dan AI menanyakan dulu sebelum memasukkannya (layout figure). Tab Tampilan: pilih gaya + "Variasi tata letak lain".
  Belum: gambar AI otomatis tanpa klik (masih lewat tombol "Buat gambar" di Rencana).
- Catatan biaya: sesi Claude Code yang panjang (konteks ±685 ribu token) mahal per langkah; mulai sesi baru per tugas
  dan jangan ganti model di tengah sesi.
- **Sumber Laporan diperluas (K13–K16, tahap 1 selesai, commit `da75d82`, belum di-push/deploy):**
  - Jenis sumber baru di `src/lib/references/source-kind.ts`: `journal`, `book`, `thesis` (skripsi/tesis/preprint),
    `official` (laporan lembaga ber-DOI), `web` (belum dicari). Klasifikasi dari tipe publikasi OpenAlex/Crossref/Semantic Scholar.
  - Buku: `src/lib/references/books.ts` (Google Books dengan ISBN, cadangan Open Library) + buku/bab buku ber-DOI dari Crossref.
    Google Books tanpa kunci sering kena 429 (kuota bersama); isi env `GOOGLE_BOOKS_API_KEY` (gratis) agar stabil.
  - Verifikasi per jenis (`verifiedBy`): DOI Crossref, ISBN Google Books, katalog Open Library, atau tercatat di OpenAlex
    (skripsi/preprint, termasuk DOI DataCite). Ulasan Choice (DOI 10.5860/choice) dibuang.
  - Campuran bawaan: jurnal mayoritas (tiap jenis lain maks. ±1/4, total non-jurnal maks. 40%); syarat SINTA/Scopus → hanya jurnal + buku.
    AI bisa memakai `findSources.kinds` dan menyimpan preferensi user di `brief.sourceKinds`.
  - Sitasi APA per jenis (buku, bab buku "Dalam ...", tesis/preprint berlabel, buku tanpa penulis → judul di depan);
    daftar pustaka (`generate-report.ts` `referenceEntry`) tidak lagi menandai buku "DOI belum tersedia".
  - UI tab Sumber: chip filter Semua/Jurnal/Buku/Skripsi/Resmi + jumlah, label warna per kartu, pilih/hapus per filter,
    cek jurnal (SINTA/Scopus) hanya untuk jurnal.
  - Tes: `scripts/source-kind.test.ts`; seluruh tes lulus, typecheck bersih. Tampilan belum dicek di browser (butuh login + DB).
  - Tahap 2 (belum): regulasi/dokumen resmi + artikel web via API pencarian web (Brave/Tavily) setelah pemilik mendaftar kunci.

## 9. Audit AI sebelum hasil sampai ke pengguna (permintaan 2026-11-09, RANCANGAN)

Permintaan pemilik: untuk Laporan dan Presentasi, setelah AI selesai mengerjakan, hasil jangan langsung diberikan.
Sistem membaca ulang seluruh isi, lalu **AI auditor khusus** memeriksa terhadap semua aturan, permintaan pengguna, dan
rencana yang disetujui. Jika belum benar → diperbaiki lalu diaudit ulang. Hasil baru dikirim setelah auditor menyetujui.

Kondisi sekarang: Laporan sudah punya audit per bab (`auditChapter`, hanya mode lengkap, satu kali, tanpa vonis
lulus/gagal dan tanpa melihat dokumen utuh). Presentasi belum punya audit.

Usulan (disetujui arahnya 2026-11-09, K17–K20; implementasi belum dimulai):
1. Pemeriksaan otomatis tanpa AI (Laporan: semua bab rencana ada, sitasi hanya dari sumber tercentang, tidak ada
   placeholder `[ISI DATA ...]`, gambar ada, penomoran; PPT: jumlah slide, slide kosong, teks meluber, gambar).
2. AI auditor terpisah (`AI_MODEL_REVIEW`, beda dari model penulis) membaca permintaan awal, brief, rencana disetujui,
   aturan kampus, dan hasil utuh → JSON vonis LULUS/PERBAIKI + daftar masalah (lokasi, tingkat).
3. Perbaikan terarah hanya pada bab/slide bermasalah, lalu audit ulang; maks. 2 putaran (K18); jika masih gagal,
   kirim dengan catatan masalah tersisa (K17).
4. UI: status "Sedang diaudit (putaran n/2)", isi disembunyikan sampai selesai (K19); hasil diberi label "Lolos audit"
   + ringkasan perbaikan. Berlaku di semua mode, termasuk ringkas.
5. Urutan: Laporan dulu (perluas `auditChapter` + step audit akhir di `report-jobs.ts`), lalu Presentasi (K20).

### Status
- **Laporan: selesai 2026-11-09, commit `245c52c`, sudah di-push.**
  - `src/lib/report/final-review.ts`: `checkReportLocally` (bab hilang, placeholder gagal/terpotong, `[ISI DATA]`,
    heading kosong, sitasi di luar sumber terpilih, jumlah sumber dikutip) + `reviewReport` (AI_MODEL_REVIEW, JSON vonis,
    vonis dihitung dari tingkat masalah, bukan kata "lulus" dari model; bila AI gagal → vonis dari cek otomatis, ditandai).
  - `report-jobs.ts`: step baru `review:<n>` (selalu ada di akhir, semua mode) dan `fix:<n>:<idx>` yang ditambahkan dinamis.
    Review menolak → fix untuk bab bermasalah (bukan placeholder) + `review:<n+1>`; maks. 2 putaran perbaikan.
    Step gerbang mutu tidak dihitung dalam batas 30 langkah/40 percobaan penulisan. Bab final = fix terakhir > audit bab > tulisan.
  - Perbaikan memakai `auditChapter(..., auditorIssues)` (prompt prioritas temuan auditor, guard placeholder/penyusutan tetap).
  - Payload job kini membawa `auditContext` (10 pesan terakhir pengguna, catatan brief, target panjang, bahasa, syarat jurnal).
  - Job publik punya `review` (berjalan/lulus/catatan + masalah tersisa). Chat otomatis menulis "Lolos audit akhir" atau
    "Catatan audit akhir" + daftar masalah (K17). Draft tetap baru muncul setelah job selesai (K19).
  - UI `ReportJobProgress`: teks "Auditor AI sedang memeriksa…", info putaran, kotak hijau lolos / kuning catatan.
  - Tes: `scripts/final-review.test.ts`; 323 tes lulus, typecheck bersih. Belum diuji ujung-ke-ujung dengan AI sungguhan
    dan DB (butuh server), tampilan belum dicek di browser.
  - Biaya: tiap laporan +1 s.d. 3 panggilan auditor (Sonnet, input = seluruh laporan) + perbaikan per bab bermasalah.
- **Presentasi: belum mulai** (tahap berikutnya sesuai K20).

## 10. Presentasi: tampilan tidak boleh mirip PPT GPT/Claude (permintaan 2026-11-09)

Keluhan pemilik (dengan contoh 5 PPTX buatan GPT/Claude): elemen masih sama persis dengan PPT AI pada umumnya,
hanya sampul yang cukup bagus dan fotonya kosong padahal Word yang dikirim berisi logo, masih ada em dash,
latar/motif belum unik per generate, UI editor kurang rapi. Diminta hemat token.

Ciri PPT AI dari contoh: agenda "01/02" dalam kotak membulat, kartu bernomor dengan bilah warna di atas + bayangan,
label pil di atas judul, palet hijau/emas/krem, Calibri/Cambria, em dash di judul ("BAB I — ..."), tanpa foto.

Yang dikerjakan (selesai 2026-11-09):
- `src/lib/presentation/motifs.ts`: 9 keluarga motif generatif (contour, confetti, rings, mosaic, terrain, stripes,
  orbit, grain, arcs) + 5 latar (plain, split, glow, band, corner). Seed deck memilih keluarga, latar, dan "gen" gaya
  (kartu: tiles/columns/stagger; penanda poin: glyph/bar/ring/lead; eyebrow: caps/rule/tag; agenda: rule/stack/outline;
  warna latar condong ke warna utama). Semua parameter (jumlah, ukuran, posisi) diacak dari seed, tetap bentuk asli PPTX.
- `design.ts`: kartu bernomor + bilah + bayangan, nomor bulat di poin, kotak "01" di agenda, dan pil eyebrow diganti
  varian di atas. Sampul tanpa foto menampilkan logo besar (bila ada) atau seni motif; sampul juga diberi lapisan motif.
- Em dash: `noDash` di renderer, `stripDashes` saat hasil AI disimpan (judul/isi/catatan slide; sumber tetap kutipan asli)
  dan pada hasil akhir Laporan; aturan "TANDA BACA" di prompt chat. Diperbaiki juga bug prompt: `${LAYOUT_GUIDE}`
  sebelumnya terkirim sebagai teks mentah (bukan daftar layout).
- Logo: gambar yang tertanam di bahan DOCX/PPTX/PDF diekstrak (`material-images.ts`, maks. 6, PNG/JPEG), disimpan
  sebagai file pengguna, gambar pertama yang hampir persegi ditandai "kemungkinan logo kampus" dan otomatis dipakai
  sebagai `design.logo`. Untuk "Buat presentasi dari laporan", gambar dari bahan DOCX/PDF Laporan ikut diekstrak.
- Gambar AI otomatis (keputusan pemilik, mengubah aturan lama "gambar hanya setelah klik"): setelah "Gunakan hasil ini",
  server memulai gambar sampul (usulan slide 1 dibuat bila AI tidak mengusulkan) + maks. 2 usulan lain; panel rencana
  memasang gambar yang selesai ke slide yang masih kosong. Biaya: hingga 3 gambar per deck.
- UI editor: bilah hasil AI dibuat ringkas (tanpa notifikasi ganda), area kerja abu lembut, thumbnail lebih rapat dengan
  sudut membulat dan penanda aktif, kanvas lebih menonjol.
- Belum dicek di browser (butuh login + DB); render dicek lewat contact sheet lokal untuk 3 seed berbeda.
- Belum: audit AI untuk Presentasi (K20), gambar otomatis hanya terpasang saat panel Rencana (mode Chat AI) terbuka.

## 11. Perbaikan: semua bab Laporan "respons AI gagal" (2026-11-09, kedua kali)

- Gejala: DOCX berisi sampul + judul bab saja, setiap bab "[ISI BAB ...: respons AI gagal]", tanpa daftar pustaka.
- Penyebab yang ditemukan di kode: client OpenAI dibuat dengan `timeout: 35_000`. Penulisan bab (`streamChapter`) tidak
  memberi timeout sendiri, jadi permintaan biasa (cadangan bila streaming ditolak/kosong) selalu terputus di 35 detik,
  padahal satu bab 1500-2500 kata butuh jauh lebih lama. Cadangan streaming kedua juga masih mengirim `stream_options`
  yang sering ditolak gateway (HTTP 400). Hasilnya dua percobaan gagal lalu bab diisi placeholder.
- Perbaikan: semua panggilan penulisan bab memakai batas waktu bab (maks. 200 detik); urutan coba: streaming lengkap →
  streaming polos (tanpa `stream_options`/`reasoning_effort`) → permintaan biasa. Penyebab dari provider kini tercatat
  di log job ("Streaming ... ditolak provider: HTTP ...", "Permintaan AI gagal: ...") dan disebut di pesan selesai.
  Timeout juga dinaikkan untuk revisi laporan (100 dtk), olah data (100 dtk), dan diagram UML/konsep (90 dtk).
- Belum terverifikasi langsung di server (kunci AI hanya ada di server). Bila masih gagal, baca log job: pesan provider
  di sana menunjukkan apakah masalahnya model/kunci/kuota di sisi Mindaku.
- Lanjutan: audit keamanan `844dd00` (2026-11-02) juga menurunkan batas job Laporan. Dikembalikan sebagian:
  percobaan per bab 2 → 4, maks. bagian outline 10 → 20, total langkah 30 → 60, total percobaan 40 → 120
  (`report-jobs.ts`, tes `security-ai.test.ts` disesuaikan). Rem biaya global tetap aktif.

## 12. SEO, keterbacaan AI, panduan interaktif, audit PPT (2026-11-10)

Permintaan pemilik: semua fitur mudah ditemukan di Google dan bisa dijelaskan dengan benar oleh asisten AI
(AI Overview, ChatGPT, Claude); Laporan dan PPT paling depan; mode panduan ala onboarding; audit AI untuk PPT.

- Satu sumber data fitur: `src/lib/seo/site.ts` (deskripsi, keunggulan, langkah, FAQ). Dipakai oleh:
  halaman publik `/fitur` dan `/fitur/laporan-ai`, `/fitur/ppt-ai` (HowTo, FAQPage, SoftwareApplication, Breadcrumb
  JSON-LD), beranda (seksi "Kenapa mahasiswa memakai keluhkampus" + FAQ, JSON-LD), `/llms.txt` (ringkasan untuk AI),
  `sitemap.xml`, `robots.txt` (crawler AI diizinkan, `/api`, `/login`, admin tidak diindeks), gambar OpenGraph.
- Metadata per halaman (`layout.tsx` per rute, canonical, OpenGraph). `/dashboard` dan `/studio` noindex karena wajib login;
  halaman fitur publik yang diindeks.
- Navbar & beranda: Laporan dan Presentasi paling depan dengan label "Unggulan" dan tautan "Pelajari cara kerja".
  Beranda dipecah: `src/app/page.tsx` (server, SEO) + `src/components/home/HomeClient.tsx` (interaktif).
- Panduan interaktif `src/components/ui/GuidedTour.tsx`: sorot elemen (`data-tour`), Kembali/Lanjut/Lewati, panah
  keyboard, Esc; muncul sekali pada kunjungan pertama, lewat `?panduan=1`, atau tombol "Cara pakai?" di kanan bawah.
  Langkah di `src/lib/client/tours.ts` (Laporan 7 langkah, Presentasi 6 langkah).
- Audit AI Presentasi `src/lib/server/presentasi/deck-review.ts`: saat finishDeck, cek otomatis (slide kosong/padat,
  judul ganda, layout berulang, jumlah slide vs rencana) + auditor AI_MODEL_REVIEW. Ditolak → temuan dikembalikan ke AI
  penulis untuk diperbaiki dengan writeSlides, maks. 2 putaran (`deckAuditRound` di meta run), lalu diserahkan dengan
  catatan (K17). Auditor gagal → hanya cek otomatis.
- Tes 324 lulus, typecheck bersih. Belum dicek di browser; build diverifikasi oleh CI saat push.
- Saran lanjutan untuk pemilik: daftarkan situs di Google Search Console dan kirim sitemap.

## 13. Pertanyaan pemilik 2026-11-10: batas panjang bab dan rem biaya global (RANCANGAN, belum dikerjakan)

- Panjang bab saat ini: target 1500-2500 kata, satu langkah job per bab (maks. ±5 menit, output per panggilan maks.
  8000 token, 3 lanjutan) sehingga satu bab mentok sekitar 25-30 halaman. Usulan: panjang mengikuti kebutuhan, bab dipecah
  per sub-bab (4.1, 4.2, ...) dan tiap sub-bab satu langkah job, target kata dihitung dari target halaman pengguna;
  auditor akhir membaca per bab agar laporan ratusan halaman tetap bisa diaudit.
- Rem global: 200 juta unit, 20.000 panggilan, 300 gambar per hari. Unit dihitung dari BYTE (bukan token) dan model
  review dikali 5, jadi perkiraannya 3-4x lebih tinggi dari pemakaian nyata. Perkiraan kasar: satu skripsi 5 bab penuh
  (tulis + audit bab + audit akhir + chat) ±5-9 juta unit, artinya rem habis setelah ±20-40 skripsi/hari.
  Usulan: hitung unit dari perkiraan token (bukan byte) dan tentukan rem dari anggaran rupiah harian pemilik.
- **Dikerjakan 2026-11-10 (pemilik: "kerjakan dua-duanya"; anggaran rupiah harian belum disebut):**
  - Rem biaya: unit kini dihitung dari perkiraan token (byte/3), bukan byte; batas tetap 200 juta unit/hari, artinya
    kapasitas nyata naik ±3x (perkiraan ±60-120 skripsi penuh/hari). Batas konteks per panggilan tetap 300 ribu byte.
    Angka bisa diubah lewat env `AI_DAILY_UNITS_GLOBAL` setelah pemilik menentukan anggaran rupiah.
  - Rencana bab: `subsections` dan `targetPages` per bab (planner diberi panduan panjang wajar per jenis dokumen,
    tanpa batas atas tetap). `planChapterParts`: bab > ±13 halaman dipecah per sub-bab, tiap bagian ≤3000 kata satu
    langkah job (step `part:<sectionId>:<n>`), maks. 40 bagian per bab; bagian berikutnya menerima ekor teks bagian
    sebelumnya agar menyambung. Batas job: 150 langkah, 400 percobaan.
  - Auditor akhir membaca laporan utuh per batch paralel (120 ribu karakter/batch, maks. 8 batch ≈ 300+ halaman).
    Bab panjang tidak ditulis ulang otomatis oleh perbaikan; temuannya menjadi catatan. Audit per bab hanya untuk bab
    satu langkah.

## 14. Perbaikan 2026-11-10: bab kosong, chat timeout, sumber berkurang, matriks penelitian

- Akar masalah bab "0 kata"/timeout: audit `844dd00` mengganti penulis utama menjadi model cepat (`AI_MODEL_DEFAULT =
  AI_MODEL_FAST`) dan menghapus pengaman model lambat (gpt-5/6 yang 0 token dalam 60 dtk), sehingga env model ikut
  dipakai apa adanya. Dikembalikan: penulis = `AI_MODEL` (bawaan claude-sonnet-5), review = `AI_MODEL_REVIEW` ||
  `AI_MODEL_LARGE` || penulis, cepat = `AI_MODEL_FAST`; nama gpt-5/6 dipetakan ke bawaan. Agen chat Laporan/PPT juga
  kembali memakai model penulis.
- Diagnostik: `GET /api/admin/ai-check` (admin) mengetes tiap model (waktu token pertama, total, error provider).
- Sumber: `findSources` menerima `queries` (2-4 query dicari paralel), hasil per query maks. 25, sumber per sesi maks. 150,
  referensi ke penulis maks. 150. Target jumlah sumber per jenis dokumen di prompt (skripsi 40-70 atau sesuai dosen).
  Penurunan sebelumnya: pencarian berurutan satu query per langkah sehingga run terpotong batas waktu.
- Matriks penelitian terdahulu (`setResearchMatrix`, disimpan di `plan.researchMatrix`): AI menanyakan dulu (tidak untuk
  tugas biasa), memilih 5-8 jurnal utama dari sumber tercentang; peneliti/tahun/judul diisi sistem dari data sumber;
  ditampilkan di tab Rencana dengan research gap dan novelty; dipakai penulis di Pendahuluan, Tinjauan Pustaka (tabel
  Penelitian Terdahulu), dan Pembahasan.
- Hasil `/api/admin/ai-check` (2026-11-10, gateway Mindaku `vip-api.mind-aku.my.id`, env AI_MODEL=claude-sonnet-5,
  AI_MODEL_FAST=deepseek-v4-pro, AI_MODEL_REVIEW=claude-sonnet-5): claude-sonnet-5 dengan max_tokens 300 → 0 karakter isi,
  finish=length (token habis untuk thinking tersembunyi); deepseek-v4-pro normal (teks pertama 3,7 dtk).
  Tindakan: (1) permintaan non-stream yang isinya kosong otomatis diulang sekali dengan model cepat (`client.ts`),
  penulisan bab ikut memakai jalur ini; (2) max_tokens bab dinaikkan ke 8000 (ringkas 2400) untuk ruang thinking;
  (3) ai-check kini juga menguji varian Claude (max_tokens 300 vs 1500, reasoning_effort low/none, thinking disabled)
  untuk memilih parameter yang mematikan thinking.

## 15. Perbaikan pengumpulan Tugas: NIM dan nama roster (2026-11-10)

- Kasus: mahasiswa (Suci Sania) punya 2 akun dan pernah mengumpulkan dari keduanya. Aturan audit keamanan mengikat NIM ke
  akun yang pernah mengumpulkan; karena NIM-nya tercatat di dua akun, KEDUA akun ditolak ("NIM ini sudah terikat ke akun
  mahasiswa lain"). Perbaikan: akun yang sudah pernah mengumpulkan dengan NIM itu tetap boleh; akun baru yang belum pernah
  memakai NIM tersebut tetap ditolak (perlindungan dari pemakaian NIM orang lain).
- Nama roster terlalu ketat (harus persis). Sekarang `namesMatch`: singkatan umum (M., Muh., Moh., Mhd., Muhamad,
  Mohammad, Achmad, St.), inisial, nama sebagian ("Suci" ~ "Suci Sania"), salah ketik satu huruf; tetap menolak nama
  orang lain. Nama yang disimpan tetap nama di roster.
- Mahasiswa yang lupa akun lamanya: admin cukup "Reset sandi" akun lama di Daftar akun, lalu mahasiswa login dengan akun itu.

## 16. Perbaikan chat Laporan gagal "AI tidak mengirim jawaban lengkap" (2026-11-10)

- ai-check terbaru: claude-sonnet-5 normal dengan max_tokens 1500 (teks pertama ±3 dtk); kegagalan sebelumnya hanya karena
  uji max_tokens 300. Jadi Claude tidak bermasalah.
- Penyebab chat gagal: saat run mendekati batas langkah/40 tool (banyak pencarian sumber), langkah "jawaban akhir" dipaksa
  memakai model cepat (deepseek-v4-pro) dengan 4000 token; model itu menghabiskan token untuk reasoning sehingga jawaban
  terpotong, dan langkah akhir yang terpotong langsung menggagalkan seluruh run. Perbaikan (`agent-runs/engine.ts`):
  jawaban akhir memakai model run (Claude), 6000 token, dan jawaban akhir terpotong yang sudah berisi teks diterima.
- Sumber didominasi buku (29 jurnal, 43 buku): kuota campuran dulu mengisi slot kosong dengan buku. Sekarang slot kosong
  tidak diisi non-jurnal (maks. ±25% per jenis, 40% total per query), jurnal tetap mayoritas.
- Keputusan pemilik 2026-11-10: fokus utama jurnal; cari semaksimal mungkin semua jurnal relevan, jangan memaksa jurnal
  melenceng; sumber lain hanya pelengkap terbaik. Diterapkan: kandidat per penyedia dinaikkan (Semantic Scholar/OpenAlex 50,
  Crossref 40), verifikasi DOI maks. 45 per query, saringan relevansi (minimal sepertiga kata kunci query di judul/abstrak),
  non-jurnal maks. ±30% per query (tiap jenis ±20%), prompt menegaskan jurnal dominan. Uji langsung: query Inggris
  14 hasil (10 jurnal, 4 preprint), query Indonesia 8 jurnal.
- Masih gagal setelah perbaikan di atas: agen Laporan dibatasi 4000 token output per langkah, sedangkan rencana bab dengan
  sub-bab, pencarian multi-query, dan matriks penelitian butuh argumen tool panjang → respons terpotong 3x → gagal.
  Perbaikan: `maxTokens` agen Laporan 8000; event mencatat "terpotong batas token".
- Lanjut otomatis (permintaan pemilik): run yang sudah menghasilkan kemajuan (ada hasil tool berhasil) dan berhenti karena
  respons kosong/terpotong atau batas langkah diteruskan otomatis maks. 2 kali (+10 langkah tiap kali, event
  "Melanjutkan otomatis (n/2)"). Gangguan provider tetap berhenti setelah 3 kegagalan berturut-turut.

## 17. Tahap 3 pencatatan data (2026-11-10)

- Tabel baru (tanpa mengubah tabel users): `activity_events` (kunjungan halaman, termasuk tamu lewat cookie acak
  `kk_vid`, tanpa IP), `user_presence` (terakhir aktif, ditulis maks. tiap 5 menit dari `getCurrentUser`), `login_events`
  (login & daftar), `ai_usage` (per panggilan AI: pemilik, operasi, model, token input/output; `actual=true` bila dari
  `usage` provider, termasuk streaming lewat clone respons), `feedbacks` (👍/👎 + komentar per jawaban AI).
- Migrasi: `prisma/migrations/20261110000000_analytics` dan file manual `database-hotfix-2026-11-10-analytics.sql`
  (deploy tidak menjalankan migrasi; jalankan di phpPgAdmin). Semua pencatatan dibungkus try/catch, jadi kode aman
  walau SQL belum dijalankan. `/api/admin/db-health` ikut mengecek 5 tabel ini.
- Pencatat: `src/lib/server/analytics.ts`, `POST /api/track` (publik di proxy, rate limit 120/menit per pengunjung),
  `PageTracker` di layout, `recordLogin` di login/register, `recordAiUsage` di `budgetedAiFetch`,
  `POST /api/feedback` + `FeedbackButtons` di chat Laporan dan Presentasi.
- Berikutnya: Tahap 4 dashboard analitik (membaca tabel-tabel ini).

## 18. Catatan 2026-11-10 malam

- Teks hero beranda dikembalikan ke aslinya ("Bantuan tugas kuliah di satu tempat" + subjudul lama); pemilik tidak ingin
  teks lama diganti tanpa diminta. Kartu unggulan Laporan/Presentasi tetap.
- Run chat Laporan tampil "Berjalan (langkah 1/20)" 76 menit: dimulai 19.51 tepat saat restart deploy; proses lama
  terus memperpanjang lock tanpa kemajuan. Ditambah watchdog di `agent-runs/engine.ts`: tanpa kemajuan > 5 menit,
  heartbeat berhenti dan run dilepas untuk diteruskan proses lain.
- Pemilik ingin subdomain admin khusus (K11 diperbarui). Rencana: `admin.keluhkampus.my.id` (subdomain cPanel diarahkan ke
  aplikasi Node yang sama), `src/proxy.ts` memetakan host admin ke halaman `/superadmin/*`, hanya role SUPER_ADMIN.
  Isi awal: dashboard analitik (Tahap 4), daftar akun, dan pintasan ke admin Tugas. Dikerjakan setelah Tahap 1.

## 19. Tahap 1 + panel super admin (2026-11-11)

- Tanpa mengubah enum DB: `ADMIN` = admin Tugas/pengajar; **super admin** = role ADMIN **dan** ID akun ada di env
  `SUPER_ADMIN_USER_IDS` (pisahkan koma). Selama env kosong, sementara dicocokkan dengan `SUPER_ADMIN_EMAILS`
  (bawaan hensellbagas@gmail.com). Helper `isSuperAdmin`/`requireSuperAdmin` di `src/lib/server/auth.ts`.
  Pemilik perlu menambah env `SUPER_ADMIN_USER_IDS` = ID akun (tampil di panel) di cPanel → Setup Node.js App.
- Hanya super admin: `/api/admin/users` (reset sandi, ubah role), `/api/admin/db-health`, `/api/admin/ai-check`,
  `/api/tugas/admin/insights`, daftar waitlist, cache referensi. Akun super admin tidak bisa direset/diturunkan dari panel.
  Admin Tugas lain (role ADMIN) tetap bisa mengelola course seperti biasa.
- Log audit: tabel `admin_audit_logs` (reset sandi, ubah role). SQL manual `database-hotfix-2026-11-11-admin-audit.sql`.
- Panel `/superadmin` (Tahap 4 ringkas): pengguna, online, aktif, login, pendaftaran 14 hari, kunjungan & per fitur,
  pemakaian AI per model/operasi/pengguna, feedback 👍/👎 + komentar, log audit, pintasan ke admin Tugas/daftar akun.
  Tautan "Panel super admin" di menu akun (hanya super admin). Non-super admin mendapat 404.
- Subdomain `admin.keluhkampus.my.id`: `src/proxy.ts` memetakan "/" di host `admin.*` ke `/superadmin` (wajib login);
  origin admin diizinkan di `csrf-origin.ts` (atau env `ADMIN_ORIGIN`). Sesi login di subdomain terpisah dari domain utama.
  Langkah cPanel: buat subdomain `admin`, salin blok `Passenger...` dari `.htaccess` domain utama ke `.htaccess`
  document root subdomain, aktifkan SSL (AutoSSL). Sampai itu selesai, panel bisa dibuka di `/superadmin`.

## 20. Perbaikan: "maksimal 50 sumber" terbaca sebagai syarat minimal (2026-11-11)

- Kasus: pengguna menulis "50 aja maksimal nya". Agen menyimpan `brief.minSources = 50`. Setelah 47 sumber tercentang,
  tombol "Setujui & eksekusi" ditolak ("syarat minimal 50"), walaupun pengguna sudah menegaskan kurang sedikit tidak apa-apa
  dan agen menjawab "aman". Penyebab: (1) field `minSources` di tool `updateBrief` tanpa penjelasan, tidak ada field
  maksimal; (2) `mergeBrief` tidak bisa menghapus `minSources` (nilai 0 diabaikan); (3) agen hanya menjawab tanpa
  memperbarui brief; (4) tombol UI tidak punya pilihan tetap lanjut, dan pesan error berisi nama tool internal.
- Perbaikan (`src/lib/server/laporan/assistant.ts`, `src/app/dashboard/page.tsx`, route `execute`):
  field baru `brief.maxSources` (batas atas, tidak memblokir); `minSources: 0` menghapus syarat; deskripsi tool dan prompt
  membedakan "minimal N" vs "maksimal/sekitar N" dan mewajibkan `updateBrief` saat pengguna melonggarkan syarat; state
  prompt menampilkan syarat min/maks; tombol eksekusi yang ditolak karena kurang sumber kini menampilkan pesan yang jelas
  dan tombol "Tetap tulis dengan N sumber" (memakai `ignoreMinSources` yang sudah ada di server). Tes di
  `scripts/report-chat.test.ts`.
- Sesi lama yang sudah tersimpan `minSources = 50`: pengguna cukup klik "Setujui & eksekusi" lalu "Tetap tulis dengan
  47 sumber", atau bilang ke agen bahwa 50 itu maksimal (agen akan menghapus syarat minimal).

## 21. Batas biaya AI dalam rupiah dari panel super admin (2026-11-11, SELESAI DIKERJAKAN)

- Permintaan pemilik: batas global dan per pengguna diatur dari dashboard admin, satuannya **nominal saldo rupiah**,
  bukan token. Contoh: saldo Mindaku diisi Rp100.000, batas dipasang Rp50.000 (= kredit 50 USD, kurs 1 USD = Rp1.000).
  Hitungan token input/output diserahkan ke sistem.
- Kondisi sekarang: rem global hanya lewat env (`AI_DAILY_UNITS_GLOBAL`, satuan "unit" perkiraan), batas per pengguna lewat
  env `AI_USER_LIMITS_ENABLED`. Belum bisa diubah dari panel. Token aktual per panggilan sudah tercatat di `ai_usage`
  (Tahap 3), jadi biaya rupiah bisa dihitung dari data itu.
- Usulan teknis (gabungan Tahap 2 + Tahap 5): tabel `settings` (kurs Rp/USD, batas global Rp, batas per pengguna Rp,
  saklar on/off) + tabel harga per model (USD per 1 juta token input/output, bisa diedit di panel; bawaan claude-sonnet-5
  2/10, model lain diisi pemilik dari daftar harga Mindaku). Sebelum panggilan AI: cadangan perkiraan; sesudah: koreksi
  dengan token aktual dari `ai_usage`. Panel menampilkan "terpakai Rp X dari Rp Y" global dan per pengguna. Super admin
  dikecualikan. Rem byte/unit lama tetap sebagai pengaman cadangan.
- Perkiraan biaya satu skripsi lengkap ±100 halaman (±30.000 kata), claude-sonnet-5 harga 2/10 USD per 1 juta token,
  dihitung dari kode (bukan data nyata): tahap chat (rencana, cari sumber, matriks) ±0,3-0,6 juta token input; penulisan
  ±12-15 bagian × ±18 ribu token input dan ±7 ribu output; audit bab + audit akhir + perbaikan ±0,1-0,3 juta input.
  Total ±0,8-1,3 juta input + ±0,15-0,25 juta output ≈ 3,5-5 USD ≈ **Rp3.500-5.000**; dengan revisi, percobaan ulang,
  gambar, dan diagram **±Rp5.000-10.000**. Perlu dicocokkan dengan data `ai_usage` dari skripsi nyata di panel.
- Jawaban pemilik: periode bisa diatur **harian, mingguan, dan bulanan**; pemilik meminta fitur ini dikerjakan lebih dulu.
- **Dikerjakan 2026-11-11:**
  - Tabel `app_settings` (kunci `ai_cost`, isi JSON): migrasi `20261111120000_app_settings` + SQL manual
    `database-hotfix-2026-11-11-app-settings.sql` (wajib dijalankan di phpPgAdmin; `db-health` ikut mengecek).
  - `src/lib/server/ai-cost.ts`: pengaturan (saklar, kurs Rp/USD bawaan 1.000, batas global dan per pengguna untuk
    harian/mingguan/bulanan, kosong = tanpa batas, harga model USD per 1 juta token input/output, harga bawaan untuk model
    yang belum diisi = 2/10, harga gambar bawaan 0,05 USD). Periode WIB: hari, minggu mulai Senin, bulan mulai tanggal 1.
    Biaya = token di `ai_usage` (semua baris, termasuk yang gagal, agar aman) x harga x kurs.
  - Pengecekan di `budgetedAiFetch` (`src/lib/ai/client.ts`) sebelum tiap panggilan provider: terpakai + perkiraan panggilan
    ini (input perkiraan + max_tokens) > batas → ditolak dengan pesan jelas ("Batas pemakaian AI akun Anda untuk hari ini
    sudah tercapai. Coba lagi besok." / versi global). Super admin dikecualikan dari batas per pengguna; batas global
    berlaku untuk semua. Cache: pengaturan 30 dtk, pemakaian 10 dtk, jadi proses paralel bisa sedikit melewati batas.
    Bila DB/`ai_usage` bermasalah, pengecekan dilewati (rem harian lama di `ai-budget.ts` tetap aktif).
  - Panel `/superadmin` seksi "Batas biaya AI (rupiah)" (`src/components/superadmin/AiCostPanel.tsx`): kartu terpakai
    hari/minggu/bulan ini vs batas global, form batas + kurs + harga model (daftar model diambil dari pemakaian 30 hari),
    tabel pengguna dengan biaya terbesar bulan ini. API `GET/PUT /api/admin/ai-cost` (super admin saja, tercatat di log audit
    `set-ai-cost`). Input rupiah menerima "50.000".
  - Tes `scripts/ai-cost.test.ts`; seluruh 335 tes lulus, typecheck bersih. Belum dicek di browser (butuh login + DB).
- Langkah pemilik setelah deploy: (1) jalankan `database-hotfix-2026-11-11-app-settings.sql` (dan SQL analytics
  2026-11-10 bila belum); (2) buka `/superadmin`, isi harga model sesuai Mindaku, isi batas, centang "Batas biaya aktif",
  simpan.

## 22. Mode maintenance, gambar Presentasi otomatis di server, dashboard analitik lengkap (2026-11-11)

Permintaan pemilik: kerjakan mode maintenance, poin G (gambar AI Presentasi otomatis), dan dashboard analitik, lalu push.

- **Mode maintenance** (`src/lib/server/maintenance.ts`, kunci `app_settings` "maintenance", butuh SQL
  `database-hotfix-2026-11-11-app-settings.sql`):
  - Saklar + pesan + perkiraan selesai di `/superadmin` (`MaintenancePanel`, API `GET/PUT /api/admin/maintenance`, log audit
    `maintenance-on/off`). Berlaku dalam ±10 detik (cache per proses).
  - `src/proxy.ts`: matcher diperluas ke semua halaman tanpa ekstensi file; saat aktif, halaman di-rewrite ke `/maintenance`
    (503), API → JSON 503 `{maintenance: true}` dengan pesan jelas. Terbuka untuk semua: `/maintenance`, `/login`,
    `/api/auth/*`. Super admin (cek ID akun dari JWT ke DB, cache 60 dtk) tetap bisa memakai seluruh situs. Cron tick ikut 503.
  - Lapis kedua: `requireAdmin` menolak admin non-super saat maintenance (route unggah besar yang tidak lewat proxy).
  - Proses latar dijeda, bukan digagalkan (K8): agent run (`engine.ts`) melepas run ke `queued` sebelum langkah berikutnya,
    job laporan (`report-jobs.ts`) tidak memulai langkah baru, job gambar tetap antre. Langkah yang sedang berjalan selesai
    dulu. Semua berlanjut otomatis setelah dimatikan (polling klien/cron). Milik super admin tidak dijeda.
  - Tanpa DB/tabel → dianggap mati (situs tidak pernah tertutup karena error).
- **Poin G, gambar AI Presentasi terpasang otomatis**: saat job gambar usulan rencana selesai, `image-jobs.ts` memanggil
  `placeFinishedPlanImage` (`presentasi/repository.ts`) yang memasang gambar ke slidenya bila slide masih kosong dan tidak
  dikunci, langsung di server (editor tidak perlu terbuka, tidak terganggu AI yang sedang berjalan). Deck diubah tanpa
  menaikkan revisi agar editor yang punya perubahan belum disimpan tidak kena konflik. Editor (`PresentationWorkspace`)
  memantau job di semua tampilan: tanpa perubahan lokal → muat ulang hasil server; ada perubahan → gambar ikut dipasang
  di editor. Pemasangan otomatis lama di panel Rencana dihapus (tombol "Pasang ke slide" manual tetap ada).
- **Dashboard analitik lengkap** (`src/lib/server/superadmin-analytics.ts`, UI `src/components/superadmin/ui.tsx`):
  - `/superadmin`: ringkasan hari ini (termasuk biaya AI), daftar yang sedang online (tautan ke detail), tren 30 hari
    (akun aktif, pengunjung unik, halaman, pendaftaran, panggilan AI, biaya AI per hari), retensi (akun aktif di ≥2 hari
    berbeda), akun aktif 7/30 hari, rata-rata aktif harian. "Aktif" = membuka halaman atau memakai AI hari itu.
  - `/superadmin/pengguna`: cari email/nama, urut terakhir aktif/terbaru/AI terbanyak/biaya bulan ini; kolom login,
    halaman, panggilan AI (30 hari), jumlah laporan & presentasi, biaya bulan ini.
  - `/superadmin/pengguna/[id]`: ringkasan, grafik harian (halaman, AI, biaya), fitur yang dipakai, operasi AI + biaya,
    daftar laporan & job, presentasi (judul saja, tanpa isi percakapan, sesuai K4), login terakhir, feedback, gambar AI.
    Membuka detail tercatat di log audit (`view-user`).
- Tes: `scripts/maintenance.test.ts` (termasuk simulasi proxy saat maintenance aktif); seluruh 342 tes lulus, typecheck
  bersih. Dicek di dev server lokal: `/`, `/fitur`, `/login`, `/maintenance` normal, `/dashboard` & `/superadmin` tetap
  minta login. Panel super admin belum dicek di browser (butuh login + DB).
- Langkah pemilik: pastikan `database-hotfix-2026-11-11-app-settings.sql` sudah dijalankan (dipakai maintenance & batas biaya).

## 23. Audit UI/UX responsif semua halaman (permintaan 2026-11-11, RENCANA KERJA)

Permintaan pemilik: fokus UI/UX, terutama responsif di semua perangkat dan kenyamanan (ukuran teks, tombol, posisi).
Dicek berurutan: pengguna dulu, lalu dosen (admin Tugas), lalu super admin.

Ukuran layar uji: 360 (Android kecil), 390/414 (iPhone), 768 (tablet tegak), 1024 (tablet mendatar/laptop kecil),
1280 dan 1440 (desktop). Daftar cek tiap halaman: tidak ada geser samping; teks isi ≥14px dan input ≥16px (cegah zoom
iOS); tombol/area sentuh ≥44px; elemen menempel (navbar, input chat, tombol "Cara pakai?") tidak menutupi isi atau
keyboard HP; modal dan panel muat di layar; tabel bisa digeser sendiri; teks panjang (judul, email, URL) terpotong rapi.

Urutan (centang saat selesai):
- Fase A, pengguna:
  0. ✅ Komponen global: Navbar + menu HP, menu akun, footer, tombol "Cara pakai?" dan panduan, modal login, feedback 👍/👎.
  1. ✅ Beranda `/`
  2. ✅ Login/daftar `/login`
  3. ✅ Laporan `/dashboard` (riwayat kiri, chat, panel kanan Rencana/Sumber/Bahan/Gambar/Draft, progres job)
  4. ✅ Presentasi `/presentasi` (daftar, chat + rencana, editor slide, tayang)
  5. ✅ Tugas mahasiswa: `/tugas`, `/tugas/[token]`, `/tugas/[token]/[tugasId]` (pengumpulan)
  6. Studio `/studio`
  7. ✅ Diagram `/uml-builder`
  8. Editor Dokumen `/template-generator` → `/editor`
  9. Olah Data `/data-synthesizer`
  10. Alat Bantu AI `/ai-tools`
  11. Rapikan Format `/fix-format`
  12. PDF, Word & Gambar `/tools`
  13. Pantau Progres `/tracker`
  14. ✅ Halaman publik fitur `/fitur`, `/fitur/laporan-ai`, `/fitur/ppt-ai`; `/maintenance`; halaman 404
  15. `/research/new` (tidak ada di menu; cek apakah masih dipakai)
- Fase B, dosen/admin Tugas: `/tugas/admin694` (daftar course), `/tugas/admin694/users`, `/tugas/admin694/insights`,
  `/tugas/[token]/admin` (kelola course), `.../admin/mahasiswas`, `.../admin/tugas/new`, `.../admin/tugas/[id]/edit`,
  `.../admin/tugas/[id]/submissions`, `.../admin/insights`, `.../admin/assistant`.
- Fase C, super admin: `/superadmin`, `/superadmin/pengguna`, `/superadmin/pengguna/[id]`.

Database lokal untuk uji (disetujui pemilik 2026-11-11, terpasang): PostgreSQL 17 portable (tanpa installer) di
`C:/Users/bagas/pgsql-local` (folder `pgsql/` + `data/`), port **5433**, database `keluhkampus_dev`, tidak menyentuh produksi.
- `.env.local` (tidak di-commit) berisi `DATABASE_URL`/`DIRECT_URL` ke database itu dan `AUTH_ORIGIN="http://localhost:3000"`
  (dev server berjalan dengan `--hostname 0.0.0.0`, tanpa ini login ditolak cek CSRF).
- `node scripts/local-db.mjs start|stop|reset` (reset = migrasi + `scripts/dev-seed.ts`). Seed menolak berjalan bila
  DATABASE_URL bukan localhost.
- Akun contoh (sandi `devpass123`): `hensellbagas@gmail.com` (super admin), `dosen@contoh.test` (admin Tugas),
  `mahasiswa@contoh.test` (pengguna dengan 9 laporan termasuk percakapan panjang & draft, 3 presentasi, tugas di course
  `/tugas/kelas-demo`), `user01..24@contoh.test`. Data analitik 30 hari (kunjungan, login, pemakaian AI, feedback) dan
  pengaturan batas biaya ikut terisi.

### 23.1 Hasil nomor 0, komponen global (2026-11-11)

Dicek di 360, 768, 1024, 1280 (dev server + database lokal). Temuan dan perbaikan:
- Tombol "Cara pakai?" melayang di kanan bawah menutupi kotak chat dan tombol kirim di HP (dan teks panel di desktop).
  Sekarang GuidedTour mendaftar ke `src/lib/client/tour-registry.ts`; Navbar menampilkannya di navbar (1024px+, ikon;
  1280px+ dengan label) dan di bagian atas menu HP/tablet. Panduan otomatis kunjungan pertama tetap jalan.
- Menu lengkap desktop baru muncul di 1280px, padahal laptop 1366px dengan skala Windows 125% hanya ±1093px → dulu
  mendapat menu hamburger. Sekarang menu desktop mulai 1024px (teks kecil di 1024-1279, normal di 1280+);
  "by Bazzcreate" hanya di 1536px+ dan di dalam menu HP.
- Menu HP: 11 item satu kolom harus digulir. Sekarang "Fitur utama" (4 item besar) + "Alat lainnya" grid 2 kolom, muat
  tanpa gulir di 360×780; tablet berupa panel lebar 384px di kanan; tinggi memakai `dvh` (aman dengan bar alamat HP).
- Tombol akun di HP hanya ikon sehingga pengunjung baru tidak melihat "Masuk". Sekarang "Masuk" selalu terlihat saat belum
  login; saat login hanya ikon di bawah 1280px (email di 1280px+); saat memuat hanya ikon (nama situs tidak terpotong).
  Tombol akun dan hamburger 44px. Nama situs tidak terpotong di 360px (ukuran teks/jarak menyesuaikan di bawah 380px).
- Tinggi navbar 76-80px melebihi jarak konten 72px (isi teratas sedikit tertutup). Sekarang maksimal 72px.
- Modal login/daftar: input 16px di HP (cegah zoom iPhone), `<form>` (Enter & pengelola sandi), `autocomplete`
  username/current-password/new-password, tombol lihat sandi, tautan "Daftar/Masuk" lebih besar.
- Global (`globals.css`): semua input/select/textarea 16px di layar <640px (aturan tanpa layer, menang atas text-sm
  Tailwind), `text-size-adjust`, `touch-action: manipulation`.
- Feedback 👍/👎: area sentuh lebih besar, kolom komentar memenuhi lebar di HP.
- Catatan: footer hanya ada di beranda (dicek di nomor 1). Tidak ada perubahan perilaku selain tata letak.

### 23.2 Hasil nomor 1, Beranda (2026-11-11)

Teks/isi tidak diubah (sesuai keinginan pemilik), hanya tata letak. Dicek di 360, 768, 1024, 1440.
- Halaman di HP 7.515px → 4.932px. Kartu unggulan pertama dulu mulai di 497px (tombolnya di bawah layar pertama);
  sekarang 356px dan tombol "Buat laporan" terlihat di layar pertama 360×780.
- Judul hero 48px → 40-44px di HP, 60px di tablet, 72px di 1024, 96px di 1280+ (desktop besar tetap seperti semula);
  jarak atas dan bawah hero dirapatkan di HP.
- Studio, Tugas, dan 7 alat bantu di HP tampil sebagai baris ringkas (ikon, judul, deskripsi 2 baris, panah) alih-alih
  kartu ±300px; mulai 768px tetap kartu penuh seperti sebelumnya (`FeatureCardLink compact`).
- "Pertanyaan umum" menjadi daftar buka-tutup (`<details>`), teks tetap ada di HTML untuk mesin pencari; JSON-LD FAQ tetap.
- Area sentuh tautan "Pelajari cara kerja", "Lihat cara kerja", tautan footer, dan tombol "Lihat fitur penyusun laporan"
  diperbesar (≥40px).

### 23.3 Keputusan pemilik 2026-11-11: urutan dikerjakan & hemat token

- Dikerjakan dulu (paling sering dipakai): **2 Login, 14 Halaman publik, 5 Tugas mahasiswa, 3 Laporan, 4 Presentasi,
  7 Diagram** (urutan dari yang kecil/cepat ke yang besar).
- **Ditunda (dicatat saja):** 6 Studio, 8 Editor Dokumen, 9 Olah Data, 10 Alat Bantu AI, 11 Rapikan Format,
  12 PDF/Word/Gambar, 13 Pantau Progres, 15 `/research/new`, seluruh Fase B (dosen) dan Fase C (super admin).
- Cara kerja hemat token (permintaan pemilik): kerjakan di sesi baru (riwayat sesi lama sangat panjang), ukur dengan
  satu skrip DOM per lebar layar (geser samping, input <16px, tombol <40px, elemen terpotong) alih-alih banyak
  screenshot; screenshot hanya kecil (skala 0,5) untuk bukti akhir; baca bagian file yang relevan saja; satu commit + push
  per halaman; tes penuh hanya sebelum push.
- Rencana per halaman menunggu persetujuan pemilik (lihat percakapan 2026-11-11).

### 23.4 Hasil nomor 2, Login `/login` (2026-11-11)

Dicek di 360, 768, 1280 (mode masuk dan daftar), tanpa geser samping. Teks tidak diubah.
- Disamakan dengan modal login: input 16px di HP, `autocomplete` username/current-password/new-password, tombol lihat
  sandi; `<form>` sudah ada sebelumnya.
- Tautan "Beranda" dan tombol "Belum punya akun?/Sudah punya akun?" kini area sentuh 44px; catatan cookie 11px → 12px.
- Tinggi halaman memperhitungkan navbar (dulu `min-h-screen` + jarak 72px membuat halaman selalu bisa digulir);
  jarak dalam kartu 24px di HP (32px mulai 640px).

### 23.5 Hasil nomor 14, halaman publik (2026-11-11)

`/fitur`, `/fitur/laporan-ai`, `/maintenance`, 404. Dicek di 360, 768, 1280, tanpa geser samping. Teks lama tidak diubah.
- Jarak tepi/atas halaman lebih rapat di HP (16px/32px), judul 30px di HP (36px tablet, 48px desktop seperti semula).
- `/fitur`: tautan "Cara kerja"/"Buka aplikasi" area sentuh 44px; seluruh kartu "Alat lain" kini bisa diketuk.
- `/fitur/[slug]`: dua tombol ajakan selebar layar di HP; tautan breadcrumb dan "Fitur lain" lebih tinggi (36px).
- `/maintenance`: tombol 44px, jarak kartu menyesuaikan HP.
- Baru: `src/app/not-found.tsx` (dulu memakai 404 bawaan Next.js berbahasa Inggris): "Halaman tidak ditemukan", tombol
  "Kembali ke beranda" dan "Lihat semua fitur", `noindex`.

### 23.6 Hasil nomor 5, Tugas mahasiswa (2026-11-11)

`/tugas`, `/tugas/KELAS-DEMO`, `/tugas/KELAS-DEMO/[tugasId]`. Dicek di 360, 768, 1280, tanpa geser samping. Teks tidak diubah.
- Jarak atas 96px di bawah navbar (ruang kosong besar di HP) → 24px HP / 48px desktop; tinggi halaman memperhitungkan navbar.
- Kartu mata kuliah/tugas/materi: jarak dalam 32px → 20px di HP (komponen `Card` global tidak diubah).
- Kartu tugas: judul panjang tidak lagi terpotong "…" di HP (maks. 2 baris); tombol "Lihat & kumpulkan" selebar kartu
  di HP dan 44px di HP/tablet.
- Form kumpul: label terhubung ke input (ketuk label memfokuskan isian), tombol "Kumpulkan" selebar form di HP, tombol
  hapus file 24px → 40px, "Ganti file"/"Pakai file lama lagi" 40px.
- Tautan kembali ("Ganti mata kuliah", nama mata kuliah) 44px dan nama panjang terpotong rapi; tombol unduh lampiran 40px.
- Isian token: huruf besar otomatis di keyboard HP, tanpa koreksi ejaan.
- Data contoh: token course `kelas-demo` diganti `KELAS-DEMO` di `scripts/dev-seed.ts` (aplikasi selalu mencari token huruf
  besar, jadi course contoh dulu tidak bisa dibuka).
- Catatan: eslint `react-hooks` melaporkan 4 error lama di `src/app/tugas/page.tsx` dan `SubmissionForm.tsx` (setState di
  effect, `Date.now` saat render); bukan dari perubahan ini, belum diperbaiki.

### 23.7 Hasil nomor 3, Laporan `/dashboard` (2026-11-12)

Dicek di 360, 390, 768, 1024, 1440 dengan sesi berisi draft dan 8 sumber. Teks tidak diubah.
- Bug utama: halaman memakai `h-[100dvh]` + jarak atas 64/72px padahal layout sudah memberi jarak 72px untuk navbar.
  Akibatnya ada ruang kosong di bawah navbar dan **kotak chat + tombol kirim terdorong 72px ke bawah layar** (halaman bisa
  digulir). Sekarang tinggi `calc(100dvh - 72px)`, kotak chat selalu terlihat di bawah.
- 1024-1279px: daftar sesi (300px) + panel kanan (460px) membuat area chat hanya 264px, judul hilang dan deretan tombol tab
  menimpa panel. Sekarang di lebar itu daftar sesi dan panel saling menutup otomatis; panel 420px (1024), 460px (1280),
  520px (1536+); deretan tab di judul disembunyikan saat panel terbuka (panel punya tab sendiri); label tab hanya ikon +
  jumlah di bawah 1280px.
- Deretan tombol di atas kotak chat (Tulis ulang, Revisi, Kirim DOCX, Lampirkan, Model teliti) dulu 3 baris di HP; sekarang
  satu baris yang bisa digeser, tombol 40px.
- Tab panel di lembar bawah HP (Rencana/Sumber/Bahan/Gambar/Draft) dulu melebar keluar layar 360px; sekarang bisa digeser.
- Area sentuh: chip Sesi/tab 44px, tombol kirim 40px, tutup lembar 44px, hapus sesi/bahan 40px, filter sumber 36px,
  "Pilih semua/Hapus pilihan/Unduh ZIP" 36px, kotak centang sumber 20px, tombol & tautan cek jurnal (`JournalCheck`) 36px.
- Brief di tab Rencana: kolom label lebih sempit di HP dan teks panjang turun baris; tabel matriks tetap bisa digeser.
- Catatan: tombol 👍/👎 (komponen global) masih 32px; eslint melaporkan 7 error lama di `dashboard/page.tsx` (bukan dari
  perubahan ini).

### 23.8 Hasil nomor 4, Presentasi `/presentasi` (2026-11-12)

Daftar, Chat AI + rencana, Edit slide, Tayangkan. Dicek di 360, 390, 768, 1024, 1440. Teks tidak diubah.
- Daftar (HP): ikon, jarak, dan kotak "Buat presentasi" diringkas; kotak itu kini utuh di layar pertama 360×780
  (dulu terpotong di bawah).
- Bilah atas editor di HP dulu 4 baris (159px) dan "Unduh PPTX" pecah 2 baris. Sekarang 2 baris (115px): "Semua
  presentasi" + judul, lalu Chat AI/Edit slide + tombol Tayangkan/Simpan/Unduh PPTX berupa ikon 44px (label tetap ada
  untuk pembaca layar, tampil lagi mulai 640px).
- Chat AI di HP: tinggi kolom chat disesuaikan sehingga kotak pesan + tombol kirim terlihat di layar pertama (dulu tepat
  di tepi bawah/terpotong); tombol saran pembuka satu baris yang bisa digeser; tombol kirim 40px.
- Edit slide di HP: isian teks 12px → 16px (cegah zoom iPhone; aturan global kalah oleh CSS modul); tombol alat cepat,
  tab Edit/Tampilan/Versi, ringkasan "Isi dan pengaturan tambahan" 44px; teks petunjuk 10px → 12px.
- Layar sentuh (HP/tablet, `pointer: coarse`): titik ubah ukuran objek 12px → 22px, tombol bilah atas 44px.
- Mode tayang: tombol 44px, teks bilah atas 12px.
- Catatan: kotak pilih objek di kanvas tetap kecil di HP (skala slide 320px); edit penuh lebih nyaman di tablet/laptop.

### 23.9 Hasil nomor 7, Diagram `/uml-builder` (2026-11-12)

Dicek di 360, 768, 1024 (mode atas-bawah dan Panel Samping), 1440, plus modal Asisten AI di 360. Teks lama tidak diubah.
- HP (<768px): catatan baru di bawah judul "Di HP, diagram bisa dilihat, diedit ringan, dan diunduh. Untuk mengedit penuh,
  gunakan laptop atau tablet. Lihat kanvas" (tautan langsung ke kanvas). Tombol "Panel Samping" disembunyikan di HP.
- Toolbar HP: tombol Simpan/Ekspor/Rapikan/Kosongkan/Hubungkan jadi grid 2 kolom (dulu deretan acak 3-4 baris), garis
  pemisah disembunyikan; tombol 40px di HP/tablet/layar sentuh (desktop tetap); zoom +/− kanvas 40px.
- Isian (select, label elemen, kebutuhan diagram di modal AI) 14px → 16px di HP (CSS modul dan inline style mengalahkan
  aturan global); select/input 44px.
- Kanvas di HP: diagram dibuat mulai x≈500 sehingga dulu tidak terlihat di layar 360px; sekarang saat diagram pertama kali
  berisi, tampilan otomatis digeser ke tengah diagram (sekali, `DiagramCanvas`, hanya bila lebar kanvas <700px).
- Tombol AI melayang 64px + label menutupi isi di HP: sekarang 56px tanpa label di HP (label jadi `aria-label`), jarak bawah
  halaman ditambah agar konten terakhir tidak tertutup. Tombol itu juga dulu tampil di atas modal Asisten AI dan menutupi
  tombol "Generate"; sekarang disembunyikan saat modal terbuka. Tombol tutup modal/petunjuk diperbesar.
- Mode Panel Samping (1024px+): tinggi memperhitungkan navbar (dulu 100vh sehingga halaman tergulir 72px dan bawah kanvas
  terpotong).
- Catatan: kanvas memakai `touch-action: none` (geser/cubit untuk pan/zoom), jadi di HP halaman digulir dari luar kanvas;
  eslint 3 error lama di `uml-builder/page.tsx` (bukan dari perubahan ini).

### 23.10 Tindak lanjut catatan audit (permintaan pemilik 2026-11-12)

- Tombol 👍/👎 (`FeedbackButtons`, dipakai Laporan & Presentasi): 32px → 40px.
- Edit slide di HP/layar sentuh: objek kini juga bisa dipilih dari deretan tombol di bawah kanvas (Label, Judul, Teks 1, ...);
  area ketuk objek di kanvas diperluas di layar sentuh (Label 7px → 23px); ketukan untuk memilih tidak lagi ikut menggeser
  objek (geser baru dimulai setelah jari berpindah 8px).

## 24. Presentasi: desain ala template Canva, font unik, animasi, latar AI (permintaan 2026-11-12, RANCANGAN)

Keluhan pemilik (screenshot deck "SakuRapi" di produksi + contoh Canva): tampilan masih khas PPT buatan GPT/Claude.
Contoh yang ditandai pemilik:
- Label kecil di atas judul ("LAPORAN FINAL", "ALUR SISTEM"), nama merek kecil di pojok kiri atas.
- Baris info "Disusun oleh | NIM | Waktu" dengan garis tegak pemisah.
- Panah chevron berderet untuk alur, dan **bug**: bila poin tidak berformat "Label: isi", panah berisi "Tahap 2/Tahap 3"
  dan teks jatuh di bawah panah (`design.ts` layout `process`, fallback `Tahap ${i + 1}`).
- Penomoran "01 / 15" di pojok, bentuk geometris polos; font hanya font sistem (Arial, Impact, Georgia, dll.).
- Animasi yang diminta belum terasa: yang ada hanya transisi slide fade/push dan judul muncul (`SLIDE_MOTIONS`),
  dan AI tidak menanyakan animasi ke pengguna.

Contoh yang disukai pemilik (Canva): EAG3Gea7O7M, EAHSKPH3cio, EAGIqWYwzXg, EAGwfKloeDk, EAGJNtARgls, EAFvJsVqL_s,
EAHGf4Z-788, EAHKp7vMtFo, EAHBKh1RTlM (+ screenshot: "Presentasi Kelompok" tekstur denim/kotak-kotak dengan kancing dan
jahitan, "Tugas Presentasi" doodle awan + pesawat kertas + garis putus-putus, bingkai bunga tulip + pita, kertas kotak
dengan stiker, "Seminar Proposal" bersih dengan bingkai garis). Catatan: halaman Canva menolak akses otomatis (403), jadi
acuan visual hanya dari screenshot; pemilik bisa mengirim screenshot halaman isi (bukan hanya sampul) bila ada.
Ciri yang membuat contoh itu terasa "didesain manusia": **latar bertekstur/bergambar** (kain, kertas, cat air, foto),
**dekorasi ilustratif** (stiker, kancing, selotip, bunga, doodle, coretan tangan), **tipografi berkarakter** (display tebal,
tulisan tangan sebagai aksen), komposisi tidak simetris, dan **animasi elemen** saat tayang.

### Rancangan (menunggu persetujuan pemilik)

**Fase 1, tampilan baru tanpa biaya AI tambahan**
1. Buang pola khas AI dari renderer: label kecil di atas judul hanya bila memang bermakna (bawaan mati), merek kecil di
   pojok, baris info bergaris tegak, chevron berderet, penghitung "01 / 15", kartu bernomor seragam. Perbaiki bug "Tahap n".
2. Gaya visual baru ala Canva (±8 keluarga), masing-masing punya latar, dekorasi, pasangan font, dan komposisi sendiri:
   Kertas & scrapbook (tekstur kertas, selotip, sobekan, stiker), Kain & jahitan (denim/kotak-kotak, garis jahit, kancing),
   Doodle kelas (awan, pesawat kertas, garis putus-putus, coretan), Bunga & pita lembut, Editorial majalah (judul raksasa,
   foto penuh), Neo-brutal (blok warna, garis hitam tebal, bayangan keras), Retro (gelombang, matahari), Gelap neon.
   Dekorasi digambar sebagai vektor (tetap tajam, ikut ke PPTX sebagai bentuk/gambar), posisinya diacak dari seed deck.
3. Komposisi isi baru per gaya: alur sebagai jalur/tangga/kartu foto (bukan chevron), sampul dengan nama penyusun yang
   menyatu dengan desain, kutipan, angka besar, perbandingan, galeri.
4. Font unik dari Google Fonts (lisensi OFL, disimpan di server sendiri): mis. Fraunces, DM Serif Display, Bricolage
   Grotesque, Syne, Unbounded, Archivo Black, Bebas Neue, Lilita One, Shrikhand, Fredoka, Baloo 2, Space Grotesk, Playfair
   Display, serta tulisan tangan untuk aksen (Caveat, Patrick Hand, Gloria Hallelujah). Dipakai di pratinjau web dan
   **ditanam ke file PPTX** agar tampil sama di PowerPoint tanpa memasang font (didukung PowerPoint 2019/365; versi lama
   memakai font pengganti; perlu uji di PowerPoint asli).
5. Warna utama tetap bisa diganti pengguna di tab Tampilan; dekorasi dan latar mengikuti palet.

**Fase 2, animasi ala Canva**
1. Preset animasi per deck: Tanpa, Halus (muncul memudar bertahap), Dinamis (naik/geser bertahap, transisi dorong),
   Ceria (pop/memantul pada stiker dan judul), Ketik (judul muncul per kata). Animasi per elemen dengan jeda bertahap
   (judul → gambar → poin satu per satu → dekorasi), bukan hanya transisi slide.
2. Sama di pratinjau web (mode Tayangkan) dan di PPTX (efek masuk PowerPoint: fade, fly in, zoom, wipe, float; transisi
   fade/push/morph untuk elemen yang sama di slide berurutan).
3. AI **menanyakan** ke pengguna sebelum menyusun: "Mau ditambah animasi? Tanpa / Halus / Dinamis / Ceria"; bisa diubah per
   deck atau per slide di tab Tampilan.

**Fase 3, latar dan elemen dibuat AI khusus per presentasi**
1. Setelah pengguna memilih template, AI bertanya lebih detail: suasana (formal/ceria/elegan/futuristik), gaya gambar
   (foto, ilustrasi datar, cat air, 3D, kolase kertas), objek yang ingin muncul, dan animasi.
2. Dari jawaban itu AI menyusun arahan seni lalu membuat: 2 latar penuh (sampul dan isi; latar isi dibuat lembut dengan
   ruang kosong agar teks terbaca), 3–5 elemen terpisah berlatar transparan (stiker/ilustrasi), dan gambar utama yang sudah
   ada. Latar dipasang sebagai gambar latar slide (teks tetap bisa diedit di PPTX). Bila warna utama diganti jauh, ditawarkan
   membuat ulang latar.
3. Dibuat di server lewat antrean gambar yang sudah ada (gpt-image-2, ±2 menit per gambar, paralel); slide tampil dulu
   dengan latar vektor Fase 1, latar AI menyusul otomatis.

### Pertanyaan untuk pemilik (keputusan K21–K23)
- K21 Font: tanam font ke PPTX (rekomendasi) atau cukup font sistem di PPTX dan font unik hanya di pratinjau/Google Slides?
- K22 Batas gambar AI per presentasi untuk Fase 3: sekarang maks. 3; usulan maks. 8 (2 latar + 3–5 elemen + 1–2 gambar utama).
  Biaya gambar naik sekitar 2–3 kali per deck.
- K23 Animasi bawaan bila pengguna tidak menjawab: Halus (rekomendasi) atau Tanpa.
- Urutan usulan: Fase 1 → Fase 2 → Fase 3, satu commit + push per fase.

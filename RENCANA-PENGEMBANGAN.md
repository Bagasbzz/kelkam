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

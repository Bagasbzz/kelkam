# KeluhKampus - Implementation Status

Tanggal update: 2026-08-02
Blueprint: `PRODUCT_BLUEPRINT.md`
Audit awal: `AUDIT_CONTEXT.md`
Runbook migration: `MIGRATION_RUNBOOK.md`

Dokumen ini mencatat status implementasi agar keputusan teknis, pekerjaan selesai, pekerjaan tertunda, dan urutan deployment tidak tercecer di percakapan.

## Status saat ini

Versi testing sudah difinalkan di source: lint, typecheck, production build, security baseline, Studio engine test, dan UML quality test sudah lulus pada tree terbaru. Browser smoke end-to-end dengan env dan database final masih harus dijalankan setelah migrasi Supabase dan env production diisi. Migration Supabase production belum dijalankan dari workspace ini sesuai instruksi user; semua SQL tetap disiapkan sebagai bundle deferred dan harus dijalankan sadar mengikuti `MIGRATION_RUNBOOK.md`.

Login global sudah tersedia sebagai containment awal, tetapi fitur premium, billing, dan usage-limit komersial belum diaktifkan. Extension point-nya sudah dicatat di blueprint dan harus ditegakkan server-side sebelum billing dibuka.

## Verifikasi final 2026-08-02

- `node node_modules/eslint/bin/eslint.js src scripts next.config.ts eslint.config.mjs --max-warnings=0` — lulus.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false` — lulus.
- `node node_modules/next/dist/bin/next build` — lulus, 38 route berhasil digenerate/ditandai dynamic sesuai kebutuhan.
- `node scripts/check-security-baseline.mjs` — lulus, 96 file TypeScript + policy assertions.
- `node --test --experimental-strip-types scripts/studio-engine.test.ts scripts/uml-quality.test.ts` — lulus, 9 test pass.
- Build blocker `OpenAI client instantiated during import without runtime env` sudah diperbaiki dengan lazy AI client, sehingga build tidak lagi membutuhkan `AI_API_KEY` saat collect page data.

## Selesai pada batch Project Studio

- Menambahkan `/studio` sebagai workspace enam tahap: Intake, Question Engine, Decision Ledger, Project Specification, Artifact Graph/UML, dan Format Preflight.
- Menambahkan context vault dengan klasifikasi otoritas sumber: binding, primary, supporting, example-only, dan unverified.
- Menambahkan engine pertanyaan deterministik yang memprioritaskan dampak, ketidakpastian, jumlah artefak, dan risiko revisi.
- Menambahkan AI Deep Scan terautentikasi sebagai pelengkap; flow inti tetap dapat dipakai tanpa AI.
- Jawaban dikompilasi menjadi keputusan berversi yang dapat dikonfirmasi, dikunci, dibuka, ditolak, dan diaudit.
- Menambahkan Project Specification sebagai single source of truth untuk scope, aktor, requirement, business rule, alur, exception, data, metode, permintaan dosen, dan format.
- Menambahkan artifact dependency graph, approval gate, lock, stale propagation, payload UML, serta sinkronisasi approve dari UML Builder kembali ke Studio.
- Menambahkan format contract dan deterministic preflight untuk sumber pedoman, margin, font, heading, spacing, penomoran, sitasi, dan bagian wajib.
- Menambahkan readiness score/gate agar finalisasi tidak hanya bergantung pada prompt atau tampilan output.
- Menambahkan local workspace versioning, multi-project, duplicate/delete, autosave, dan import dari `report_builder_project_v1`.
- Menambahkan golden tests untuk question gate, specification compilation, dependency/stale propagation, format preflight, dan UML quality gate.
- Menambahkan migration deferred `006_create_project_studio.sql` dan runbook deployment/rollback tanpa mengeksekusi database production.

## Selesai pada batch hardening

### Auth dan API boundary

- Menambahkan auth helper server terpusat berbasis Supabase publishable key + bearer token.
- Menambahkan user-scoped Supabase client agar query server tetap tunduk pada RLS.
- Menambahkan `authenticatedFetch` untuk caller browser.
- Menambahkan login global berbasis magic link pada navbar.
- Menambahkan API gateway `src/proxy.ts` untuk memvalidasi session pada endpoint privat.
- Menambahkan rate limit in-memory dasar per user/IP sebagai containment awal.
- Mengganti pesan error sensitif dengan pesan publik yang lebih generik pada route yang disentuh.
- Mengunci POST `/api/references/cache` dengan `REFERENCE_CACHE_ADMIN_TOKEN`.

### Report jobs

- Semua job baru memiliki `owner_id`.
- Start dan status job membutuhkan user terautentikasi.
- Query status dan update job selalu difilter dengan `owner_id`.
- Payload proyek disanitasi dari pola secret sebelum disimpan.
- Job memory dibatasi jumlah dan umur agar tidak tumbuh tanpa batas.
- ID job tidak lagi dianggap sebagai authorization.

### Supabase dan RLS

- Menghapus desain policy report job yang menggunakan `using (true)` / `with check (true)`.
- Menambahkan owner-based policy untuk `projects`, `reference_library`, `reference_evidence`, dan `report_jobs`.
- Menambahkan migrasi containment deployment: `004_secure_multitenant_tables.sql`.
- Menambahkan waitlist insert-only RLS: `005_secure_waitlist.sql`.
- Route reference/evidence memakai user-scoped client, bukan service-role fallback.
- `src/lib/supabase-client.ts` lama dihapus karena membuat admin client pada import dan mendorong bypass RLS.

### Upload, parser, dan AI safety

- `.env`, credential, private key, `.npmrc`, dan nama file sensitif dikeluarkan dari ZIP context.
- Menambahkan secret redaction untuk teks dan object sebelum persistence.
- Menambahkan batas ukuran file, jumlah entry ZIP, ukuran entry, total expansion, dan compression ratio.
- Menambahkan pemeriksaan signature PDF, DOCX/ZIP, PNG, JPEG, dan WebP.
- Menambahkan timeout parser DOCX/PDF/ZIP.
- Menambahkan timeout dan batas stderr pada Python formatter.
- Menambahkan ukuran maksimum DOCX dan gambar UML.
- Menguatkan route UML, revise-report, research chat/search-plan/outline/novelty, dan references search dengan parsing `unknown`, body limit, output normalization, dan prompt-injection boundary.

### UI/UX dan reliability

- Menghapus panel auth debug dari `/research/new` dan menggantinya dengan selector project lokal yang lebih sesuai untuk testing.
- Merapikan navbar mobile, modal, keyboard escape, aria state, dan body scroll lock.
- Menguatkan editor agar localStorage rusak tidak membuat layar blank.
- Merapikan command palette Tiptap, structure sidebar, formatting panel, dan DOCX exporter tanpa `any`.
- Menguatkan UML Builder: strict quality gate, auto-layout, validation endpoint/edge, repair sekali, dan test golden scenarios.

## Environment production

Yang dibutuhkan untuk flow saat ini:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` atau `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`
- `REFERENCE_CACHE_ADMIN_TOKEN` bila admin cache clear perlu dipakai

`SUPABASE_SERVICE_ROLE_KEY` tidak diperlukan untuk request user yang sudah dipindahkan ke user-scoped client. Bila kelak worker privat memakai service role, key itu hanya boleh tersedia server-side dan worker wajib memverifikasi owner/job sebelum memproses.

## Verification result

- `npm run lint`: lulus.
- `tsc --noEmit --pretty false`: lulus.
- `npm run security:check`: lulus untuk 96 file TypeScript + policy assertions.
- `npm run test:uml`: lulus 5/5.
- `npm run build`: lulus.
- Browser smoke test production: route `/`, `/research/new`, `/fix-format`, `/uml-builder`, `/dashboard`, `/editor`, dan `/research/new` mobile semuanya HTTP 200, tanpa console/page error, editor menampilkan isi localStorage, dan mobile tidak overflow.
- Server uji sudah dihentikan kembali setelah smoke test selesai.

## Urutan deployment wajib

Jangan deploy kode route baru sebelum schema production siap.

1. Backup tabel tenant dan periksa row lama pada `report_jobs`.
2. Jalankan `supabase/report_jobs.sql` di Supabase SQL Editor.
3. Jalankan `scripts/supabase_migrations/004_secure_multitenant_tables.sql`.
4. Jalankan `scripts/supabase_migrations/005_secure_waitlist.sql` jika tabel waitlist tersedia.
5. Jalankan `scripts/supabase_migrations/006_create_project_studio.sql` saat Studio ingin disinkronkan ke database.
6. Pastikan Supabase Auth URL Configuration memuat domain production dan preview Vercel yang memang diizinkan.
7. Jalankan negative test dengan dua akun: user B tidak boleh melihat project, reference, evidence, atau job user A.
8. Redeploy Vercel.
9. Smoke test login, pilih project, simpan reference, extract evidence, upload context, generate report, polling job, UML, fix-format, studio, dan waitlist.

## Pekerjaan production berikutnya

1. Jalankan migration sesuai runbook saat user sudah siap.
2. Tambahkan rate limiter persisten/distributed untuk Vercel, bukan hanya in-memory.
3. Tambahkan automated tenant-isolation test terhadap Supabase staging.
4. Audit dan purge row production lama yang tidak memiliki owner.
5. Tambahkan retention policy dan delete/export project.
6. Aktifkan premium/usage-limit hanya setelah enforcement server-side siap.

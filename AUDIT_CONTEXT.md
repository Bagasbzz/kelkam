# KeluhKampus — Web Security & Architecture Audit Context

Tanggal audit: 2026-07-26  
Scope: source code, API routes, Supabase SQL/RLS, dependency manifest, client-side state, upload/parser flow, dan konfigurasi Next.js di workspace ini. Audit ini bersifat white-box/static review pada kode lokal. Tidak ada exploit destruktif, brute force, atau akses ke data production yang dilakukan.

## Ringkasan eksekutif

Status saat ini: **belum aman untuk production**.

Risiko paling besar bukan SQL injection/XSS klasik, melainkan boundary tenant dan biaya/availability:

1. `report_jobs` secara eksplisit memberi role `anon` hak insert/select/update ke seluruh tabel. Tabel itu menyimpan `project` mentah dan hasil laporan. Ini dapat membocorkan isi proyek lintas pengguna dan memungkinkan manipulasi job.
2. `reference_library`, `projects`, dan `reference_evidence` belum memiliki isolasi tenant yang konsisten. Sebagian policy hanya memeriksa status authenticated, bukan owner project.
3. Banyak endpoint AI, upload, parsing, pencarian provider, dan job generation dapat dipanggil tanpa login, tanpa rate limit, dan tanpa batas body/file yang memadai. Ini membuka abuse biaya AI, provider quota exhaustion, dan DoS.
4. ZIP context extractor membaca file berekstensi `.env`; isi tersebut dapat masuk ke localStorage, dikirim ke model AI, dan disimpan lagi di `report_jobs`.
5. `next@16.1.6` dan `react@19.2.3` sudah berada di bawah patch keamanan resmi yang relevan pada tanggal audit.

## Temuan kritis

### C-01 — Kebocoran lintas pengguna dan manipulasi total pada `report_jobs`

Severity: **Critical / P0**

Bukti:

- `supabase/report_jobs.sql:17-33` membuat RLS policy `report_jobs_mvp_select` dan `report_jobs_mvp_update` dengan `using (true)`, serta policy insert dengan `with check (true)`, untuk `anon, authenticated`.
- `src/lib/report/report-jobs.ts:71-88` menyimpan object `project` mentah ke kolom JSONB melalui `saveJob(job, project)`.
- `src/lib/report/report-jobs.ts:92-105` membaca job berdasarkan ID menggunakan client server-side.
- `src/app/api/report-jobs/status/[jobId]/route.ts:6-19` tidak meminta Bearer token dan tidak memeriksa owner.

Dampak:

- Anonymous user dapat membaca semua row melalui Supabase Data API jika tabel aktif sesuai SQL tersebut, termasuk `project`, `result`, error, dan metadata.
- Anonymous user dapat mengubah status/progress/result job melalui Data API sesuai policy.
- Endpoint status juga mengembalikan hasil job kepada siapa pun yang memiliki/menemukan ID job. ID UUID bukan authorization.

Remediasi wajib:

- Hentikan policy MVP tersebut. Gunakan tabel privat dengan `owner_id uuid not null references auth.users(id)`.
- Semua read/write harus memakai `auth.uid() = owner_id`; service role hanya boleh dipakai di server setelah authorization diverifikasi.
- Jangan simpan project mentah yang berisi file context/secrets di job table. Simpan reference ke object privat atau payload yang sudah direduksi.
- Tambahkan auth dan ownership check di `status/[jobId]`.
- Jika tabel ini sudah pernah terisi di production, audit dan purge data sensitif; rotasi secret yang mungkin ikut tersimpan.

### C-02 — Isolasi tenant Supabase tidak konsisten

Severity: **Critical / P0**

Bukti:

- `scripts/supabase_migrations/001_create_reference_library_with_rls.sql:28-52` memberi semua user authenticated hak `select` dan `insert` ke `reference_library`; policy tidak membatasi `project_id` ke owner.
- `scripts/supabase_migrations/002_create_projects_table.sql:3-12` membuat `projects` tanpa `alter table ... enable row level security` atau policy.
- `scripts/supabase_migrations/003_create_evidence_table.sql:3-18` membuat `reference_evidence` tanpa RLS.
- `src/lib/supabase-client.ts:14-24` menggunakan service-role client, sehingga RLS dilewati dan seluruh ownership harus benar-benar ditegakkan oleh route.

Dampak:

- Public Supabase client/token dapat menjadi jalur langsung ke tabel yang RLS-nya tidak aktif atau policy-nya terlalu longgar, tergantung grant Data API di project Supabase.
- User authenticated berpotensi membaca/menulis referensi user lain secara langsung, tanpa melewati API ownership check.
- `project_id` adalah string dari localStorage/user input, bukan foreign key owner yang kuat.

Remediasi wajib:

- Aktifkan RLS pada **setiap** tabel tenant: `projects`, `reference_library`, `reference_evidence`, dan job table.
- Ganti policy berbasis `auth.role()` menjadi policy berbasis relasi owner: `exists (select 1 from projects p where p.project_id = reference_library.project_id and p.owner_id = auth.uid())`.
- Tambahkan foreign key dan unique constraint yang sesuai; validasi `projectId` sebagai format yang dibatasi.
- Jalankan negative tests: user A tidak boleh select/insert/update row project user B, baik lewat API route maupun Supabase REST langsung.

### C-03 — Endpoint mahal/berat dapat dipanggil publik tanpa abuse control

Severity: **Critical / P0** untuk production yang memakai paid AI; **High** untuk availability.

Endpoint yang tidak memiliki auth check yang terlihat:

- `src/app/api/ai/academic-rewrite/route.ts`
- `src/app/api/ai/structure-check/route.ts`
- `src/app/api/ai/generate-report/route.ts`
- `src/app/api/ai/revise-report/route.ts`
- `src/app/api/ai/synthesize-data/route.ts`
- `src/app/api/ai/generate-uml/route.ts`
- `src/app/api/ai/analyze-uml-image/route.ts`
- `src/app/api/research/chat/route.ts`
- `src/app/api/research/search-plan/route.ts`
- `src/app/api/references/search/route.ts`
- `src/app/api/report-jobs/start/route.ts`
- upload/parser routes di `context/extract`, `fix-format`, dan `fix-format/format`.

Bukti tambahan:

- `src/lib/ai/client.ts:27-36` hanya memastikan API key tersedia; tidak ada user auth, quota, rate limit, atau per-user budget.
- `src/app/api/research/search-plan/route.ts:72-136` dapat menghasilkan banyak query lalu client mengeksekusi beberapa panggilan provider berurutan.
- `src/app/api/report-jobs/start/route.ts:15-26` menerima project besar dan langsung membuat asynchronous job publik.

Dampak:

- Abuse dapat menghabiskan kredit AI, quota Semantic Scholar/OpenAlex/Crossref, CPU, memory, dan connection pool.
- Anonymous attacker dapat mengirim prompt berukuran besar berkali-kali.
- Tidak ada idempotency key atau batas concurrent job per user/IP.

Remediasi wajib:

- Terapkan satu auth helper/middleware untuk semua endpoint privat.
- Tambahkan rate limit berbasis user + IP, body size limit, timeout, concurrency limit, dan per-user AI budget.
- Pisahkan endpoint publik yang memang dibutuhkan dari endpoint privat; default harus fail-closed.
- Tambahkan `Retry-After`/429 dan observability untuk abuse.

### C-04 — Upload/parser DoS: file size, decompression ratio, dan subprocess tidak dibatasi

Severity: **High / P1**

Bukti:

- `src/app/api/context/extract/route.ts:50-81` membaca seluruh `file.arrayBuffer()` sebelum ada batas ukuran.
- `src/app/api/context/extract/route.ts:24-45` menjalankan `JSZip.loadAsync(buffer)` dan membaca entry tanpa batas total uncompressed bytes atau compression ratio. `MAX_ZIP_FILES` hanya membatasi jumlah entry yang dibaca, bukan ukuran archive/decompressed content.
- `src/app/api/fix-format/route.ts:13-24` dan `src/app/api/ai/analyze-uml-image/route.ts:21-34` juga tidak membatasi ukuran file dan hanya mengandalkan extension/content-type yang dikirim client.
- `src/app/api/fix-format/format/route.ts:48-73` men-spawn Python formatter tanpa timeout, memory limit, atau ukuran input/output limit.
- Official Mammoth documentation memperingatkan bahwa input untrusted tidak disanitasi dan dokumen tertentu dapat menyebabkan CPU/memory tinggi: https://github.com/mwilliamson/mammoth.js/.

Dampak:

- ZIP bomb/PDF/DOCX pathological input dapat membuat worker kehabisan memory/CPU.
- Request upload dapat menahan server sampai parser atau Python selesai.
- Fake MIME/extension dapat melewati filter tipe.

Remediasi wajib:

- Tolak file di atas batas kecil yang eksplisit sebelum `arrayBuffer()` bila platform memungkinkan; tetap cek `file.size` setelah form parsing.
- Validasi magic bytes/container structure, bukan extension saja.
- Batasi total uncompressed ZIP bytes, per-entry bytes, jumlah entry, nested archive, dan waktu parsing.
- Jalankan parser di worker/process terisolasi dengan timeout dan resource limit.
- Pastikan temp directory selalu dibersihkan dan jangan memakai input name untuk path.

### C-05 — `.env` dari ZIP dapat terkirim ke AI dan tersimpan sebagai data job

Severity: **High / P1**, dapat menjadi **Critical** bila ZIP production mengandung secret aktif.

Bukti:

- `src/app/api/context/extract/route.ts:7` memasukkan `env` ke `TEXT_EXTENSIONS`.
- `src/app/api/context/extract/route.ts:30-44` membaca semua entry text yang lolos filter; `.env`, `.env.local`, dan file konfigurasi sensitif tidak dikecualikan.
- `src/app/dashboard/page.tsx:697-720` memasukkan hasil extractor ke `project.sources`.
- `src/lib/report/report-jobs.ts:71-88` menyimpan project mentah tersebut ke Supabase.
- `src/lib/report/generate-report.ts:140-169` mengirim compact project ke provider AI eksternal.

Dampak:

- User yang upload ZIP proyek secara wajar dapat tanpa sengaja mengirim API key, database password, JWT, private URL, atau service-role key ke AI provider dan database job.
- Policy `report_jobs` yang permisif memperbesar dampak menjadi kebocoran lintas pengguna.

Remediasi wajib:

- Jangan ekstrak `.env`, `.env.*`, `.pem`, `.key`, credential/config secret, atau file binary sensitif secara default.
- Tambahkan secret scanner/redaction sebelum data masuk localStorage, prompt AI, atau database.
- Tampilkan daftar file yang dikecualikan dan minta konfirmasi sebelum data dikirim ke third party.
- Jika secret pernah masuk production, anggap compromised dan rotate.

### C-06 — Project/job identity masih client-controlled dan predictable

Severity: **High / P1**

Bukti:

- `src/components/Auth.tsx:12-14,69-86` menerima `projectId` bebas dari input dan menyimpannya di localStorage.
- Banyak komponen memakai fallback `proj_local_1`.
- `src/app/api/references/persist/route.ts:45-70` dan `src/app/api/references/evidence/generate/route.ts:48-74` membuat mapping owner saat project belum ada.
- `supabase/report_jobs.sql` tidak memiliki kolom owner.

Dampak:

- Default ID menjadi collision point antar user.
- User dapat mencoba claim identifier yang belum terdaftar; race/claim semantics bergantung pada endpoint pertama yang dipanggil.
- Job tidak dapat diotorisasi dengan kuat karena owner tidak disimpan.

Remediasi: server yang menerbitkan UUID project dan job, simpan `owner_id` pada kedua tabel, jangan gunakan fallback shared, dan jangan izinkan user memilih ID tenant arbitrer.

## Temuan high/medium lainnya

### H-01 — Framework/dependency berada di bawah patch keamanan terbaru

Severity: **High / P1**

Manifest saat ini memakai `next: 16.1.6`, `react: 19.2.3`, dan `react-dom: 19.2.3` (`package.json:30-32`). Official Next.js advisories pada tanggal audit menunjukkan beberapa issue 16.x yang patched version-nya minimal `16.2.3` atau `16.2.11`, termasuk Server Components DoS dan cache/confidential response issues:

- https://github.com/vercel/next.js/security/advisories/GHSA-q4gf-8mx6-v5v3
- https://github.com/vercel/next.js/security/advisories/GHSA-4633-3j49-mh5q
- https://github.com/vercel/next.js/security/advisories/GHSA-955p-x3mx-jcvp

React official advisory juga mencantumkan `19.2.3` sebagai affected untuk beberapa React Server Components DoS dan menyarankan `19.2.4` atau lebih baru: https://github.com/facebook/react/security/advisories/GHSA-83fc-fqcc-2hmg.

Remediasi: upgrade Next ke patch yang mencakup seluruh advisory (setidaknya `16.2.11` berdasarkan advisory yang ditemukan) dan React/React DOM ke patch terbaru yang kompatibel (versi 19.2 terbaru yang tervalidasi), lalu rebuild dan smoke test. Jangan hanya mengandalkan caret range di `package.json`; lockfile harus ikut diperbarui.

Catatan: `npm audit --omit=dev` tidak selesai karena timeout network/cache di environment ini, jadi status dependency non-Next/non-React belum dapat dianggap bersih. `jszip` yang terpasang `3.10.1` berada di atas advisory prototype pollution yang patched di `3.7.0`, tetapi tetap memerlukan resource limits untuk ZIP bomb.

### H-02 — Tidak ada security headers di konfigurasi aplikasi

Severity: **High / P1**

`next.config.ts:3-5` masih kosong dan tidak ditemukan middleware/header policy. Tidak ada app-level evidence untuk CSP, HSTS, `X-Content-Type-Options`, frame-ancestors/X-Frame-Options, Referrer-Policy, atau Permissions-Policy.

Dampak: XSS/unsafe third-party content menjadi lebih mudah dieksploitasi, clickjacking tidak dibatasi, dan token/data localStorage mendapat perlindungan defense-in-depth yang lemah.

Remediasi: pasang header melalui `next.config.ts`/middleware/platform, mulai dengan CSP report-only lalu enforce; gunakan nonce/hash bila diperlukan, `frame-ancestors 'none'`, `nosniff`, referrer policy ketat, HSTS hanya setelah HTTPS konsisten, dan allowlist provider AI/API.

### H-03 — Waitlist berpotensi membuka seluruh email subscriber

Severity: **High / P1**

- `README.md` menginstruksikan membuat tabel `waitlist` tanpa RLS.
- `src/components/WaitlistForm.tsx:25` menulis langsung dari browser menggunakan anon Supabase client.
- Tidak ada migration/policy waitlist di repo.

Jika tabel dibuat seperti README dan role Data API masih mendapat grant default, anonymous client dapat membaca/menulis/mengubah data waitlist, bukan hanya insert yang dibutuhkan UI.

Remediasi: pindahkan insert ke server endpoint dengan validation/rate limit/anti-bot, enable RLS, izinkan anon hanya insert terkontrol atau gunakan provider form khusus, dan jangan pernah expose email list.

### H-04 — Error response membocorkan detail internal

Severity: **Medium / P2**

Banyak route mengembalikan `error.message` langsung, misalnya `src/app/api/ai/academic-rewrite/route.ts:32-36`, `src/app/api/references/evidence/generate/route.ts:102-105,147-155`, `src/app/api/fix-format/format/route.ts:81-83`, dan route Supabase lainnya.

Dampak: provider/model name, SQL/PostgREST details, filesystem path, Python stderr, atau internal implementation dapat bocor ke client. Remediasi: log detail internal dengan request ID di server, kembalikan pesan generik + code stabil ke client.

### H-05 — Cache administration endpoint publik

Status terkini: route ini sudah dikunci di branch testing. `src/app/api/references/cache/route.ts` tetap mengizinkan GET stats, tetapi POST kini butuh `REFERENCE_CACHE_ADMIN_TOKEN` via header `x-admin-token`. Endpoint ini tetap tidak boleh dibuka publik saat production.

### H-06 — Prompt injection dan data boundary AI belum ditangani sebagai untrusted content

Abstract, source files, draft, brief, dan clarification answers langsung digabung ke system/user prompt pada banyak route. Ini dapat membuat instruksi dari dokumen akademik/code mengubah perilaku model atau menyebabkan data sensitif ikut diproses. Remediasi: label semua source sebagai data tidak tepercaya, pisahkan delimiters, redaction, max length/token budget, output schema validation, dan policy untuk data yang tidak boleh dikirim ke provider.

### H-07 — External URL dipakai langsung sebagai `href`

`src/components/ReferenceCard.tsx:120-131` dan link serupa di dashboard memakai `paper.url`/`paper.pdfUrl` dari provider tanpa allowlist protocol/host. Provider saat ini resmi, tetapi data metadata tetap untrusted. Validasi hanya `https:`/`http:` sesuai kebutuhan; reject `javascript:`, `data:`, `file:`, control characters, dan URL internal. DOI juga perlu canonicalization yang ketat.

### H-08 — localStorage menyimpan token dan data akademik dalam jumlah besar

`src/lib/supabase-browser.ts:19-26` mengaktifkan `persistSession: true`; berbagai komponen menyimpan brief, referensi, evidence, draft, dan diagram ke localStorage. XSS atau browser profile compromise dapat membaca seluruhnya. Gunakan cookie httpOnly untuk session bila arsitektur SSR memungkinkan, minimalkan data lokal, beri expiry/encryption yang realistis, dan jangan simpan secrets.

### H-09 — In-memory maps/cache tidak punya eviction atau upper bound

`src/lib/report/report-jobs.ts:22-39` menyimpan jobs/projects/runners di global Map/Set tanpa TTL cleanup. `src/lib/references/provider-client.ts:5-11,54` menyimpan response cache tanpa max keys/size. Request/job abuse dapat membuat memory growth; serverless multi-instance juga membuat state tidak konsisten. Gunakan queue/cache bounded eksternal dengan TTL dan quota.

## Bug fungsional/reliability yang terkonfirmasi dari source

### F-01 — Reference save/load ke Supabase tidak mengirim token

`src/components/ReferenceLibrary.tsx:82-86` dan `112-114` melakukan POST/GET tanpa `Authorization`, padahal backend `persist` dan `list` menolak request tanpa Bearer token di awal route. Import `supabase` di component juga dilaporkan unused oleh ESLint. Akibatnya fitur save/load server akan 401; ambil session token sebelum fetch atau buat helper request terpusat.

### F-02 — Sinkronisasi `ProjectBrief` berisiko update loop/cascading render

`src/components/ProjectBrief.tsx:68-82` menjalankan `onChange(brief)` dalam effect yang bergantung pada callback; parent di `src/app/research/new/page.tsx:39-40` membuat callback inline. Effect lain di `ProjectBrief.tsx:77-87` selalu membuat object baru dari `value`. Kombinasi ini dapat memicu render/effect berulang saat brief diinisialisasi atau berubah. Gunakan single source of truth di parent, callback `useCallback`, dan bandingkan value sebelum set state.

### F-03 — Hydration/state staleness dari akses localStorage saat render

`src/components/Auth.tsx:11-18` dan beberapa workbench membaca localStorage di initializer/`useMemo`, sementara server tidak memiliki localStorage. Ini berpotensi mismatch hydration. Selain itu projectId di beberapa workbench dimemoisasi dengan dependency kosong sehingga pergantian project lewat event tidak selalu mengubah key yang dipakai. Gunakan `useEffect`/`useSyncExternalStore` atau state project terpusat.

### F-04 — Kualitas build/lint belum production-ready

Verifikasi lokal:

- `tsc --noEmit --pretty false`: **lulus**.
- ESLint API/lib: **141 masalah** (134 errors, 7 warnings).
- ESLint client/app/utils: **137 masalah** (92 errors, 45 warnings).
- Masalah dominan: `no-explicit-any`, unused variables, `prefer-const`, missing hook dependencies, dan beberapa `setState` sinkron di effect.
- `npm run build` melewati batas 300 detik di environment audit; hasil build tidak dapat dinyatakan lulus.
- `npm audit --omit=dev` juga timeout, sehingga audit dependency lengkap masih perlu dijalankan di CI dengan network yang sehat.

### F-05 — Coverage test otomatis belum terlihat

Inventory repo menunjukkan script E2E manual di `scripts/e2e-test.js` dan helper E2E, tetapi tidak ada test/spec suite untuk auth, RLS, API limits, parser abuse, tenant isolation, atau output validation. Tambahkan integration tests yang menjalankan dua user Supabase dan negative cases.

## Hal yang sudah terlihat baik

- `.gitignore:34` mengabaikan `.env*`; tidak ada secret literal production yang ditemukan di tracked source pada pemeriksaan ini. Tetap jangan menganggap `.env.local` aman untuk upload/AI.
- Route research/reference tertentu memang sudah memanggil `supabaseAdmin.auth.getUser(token)` dan membandingkan `projectRow.owner_id` dengan user ID.
- Query database menggunakan Supabase query builder; tidak ditemukan interpolasi SQL mentah di route.
- `src/components/Editor.tsx:159` memakai `dangerouslySetInnerHTML` hanya untuk CSS statis, bukan input user. Tetap pertahankan pemisahan ini.
- UML normalizer/guard sudah membatasi sebagian jumlah node/message dan memvalidasi koneksi, tetapi request AI-nya tetap perlu auth, input limit, dan rate limit.

## Catatan deployment production dari follow-up

User mengonfirmasi bahwa Vercel production/preview memiliki `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` yang berisi key berprefix `sb_publishable`, serta `AI_API_KEY`, `AI_BASE_URL`, dan `AI_MODEL` sebagai sensitive environment variables.

- `sb_publishable_*` adalah public/publishable key; key ini tidak boleh diberi hak lebih dari yang diizinkan RLS dan aman untuk diketahui browser. Jangan pernah memasukkan service-role/secret key ke `NEXT_PUBLIC_*`.
- Nilai key lengkap sengaja tidak disalin ke audit context atau log.
- Read-only probe ke Supabase REST production dicoba tanpa menampilkan body/row, tetapi environment audit gagal resolve DNS host Supabase. Karena itu status permission tabel production belum terkonfirmasi secara live; temuan SQL/RLS pada audit tetap harus dianggap blocking sampai diverifikasi dari Supabase SQL Editor/Data API atau deployment region yang dapat resolve host.
- Setelah memperbaiki RLS/policy dan route authorization, lakukan redeploy. Environment variable Vercel yang berubah biasanya memerlukan redeploy agar deployment aktif memakai nilai baru.

## Urutan perbaikan yang disarankan

### Hari 0 — containment sebelum production

1. Disable/drop public `report_jobs` anon policies dan protect/rotate Supabase service-role key serta AI key jika pernah masuk ZIP, database, log, atau prompt.
2. Audit row `report_jobs`/`reference_*` yang sudah ada; hapus atau encrypt payload sensitif.
3. Nonaktifkan endpoint publik AI/upload/cache sampai auth + rate limit siap.
4. Tambahkan temporary response size/body/file limit di edge/platform jika belum bisa patch kode segera.

### P0/P1 engineering

1. Buat `requireUser(req)` dan `requireOwnedProject(userId, projectId)` yang dipakai semua route privat.
2. Redesign schema owner/RLS dan tulis negative integration tests lintas user.
3. Tambah central request guards: JSON/form size, per-field limits, file magic checks, parser timeout, AI timeout, rate/concurrency/quota, idempotency.
4. Exclude/redact secrets dari ZIP/context dan jangan simpan project mentah di jobs.
5. Upgrade Next/React dan lockfile ke patch keamanan yang kompatibel.

### P2 hardening/quality

1. Security headers/CSP, generic error responses, request IDs, structured audit log, monitoring AI/provider cost.
2. Perbaiki auth header client reference flow, project state, dan ProjectBrief effect loop.
3. Kurangi `any`, pecah file client besar, tambah loading/error boundaries, unit/integration tests, dan CI gate untuk typecheck/lint/build/audit.

## Definition of done keamanan

- Anonymous request ke endpoint privat mendapat 401/403 dan tidak memicu AI/parser/provider call.
- User A tidak dapat membaca/mengubah row milik user B lewat route maupun Supabase REST.
- Semua body dan file punya hard limit; ZIP total expansion dan parser timeout teruji.
- `.env`, credential, key, token, dan private config tidak masuk prompt, localStorage, job JSON, atau log.
- `report_jobs` menyimpan owner dan tidak bisa dibaca anonymous.
- Next/React berada pada patch yang tervalidasi; `tsc`, lint, build, audit, dan integration tests lulus.

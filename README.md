# keluhkampus

> Platform berbagai tools mahasiswa untuk mempermudah pengerjaan tugas kuliah: UML auto-build, data synthesizer narasi, laporan builder, fix-format DOCX, AI tools, dan studio penelitian.

[![Domain](https://img.shields.io/badge/domain-keluhkampus.my.id-blue)](https://keluhkampus.my.id)

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS v4
- **Backend**: Next.js API routes (Node.js runtime)
- **Database**: PostgreSQL via [Prisma](https://prisma.io) ORM (hosting di JKC cPanel)
- **Auth**: Email + password ([argon2id](https://github.com/ranisalt/node-argon2)) + httpOnly JWT cookie (via [jose](https://github.com/panva/jose))
- **File storage**: Filesystem server di `${UPLOAD_DIR}` dengan SHA256 dedup
- **AI**: OpenAI-compatible (GPT-5, GPT-5-mini) atau Groq fallback
- **Editor**: [TipTap 3](https://tiptap.dev) rich text, DOCX export via `docx` package
- **Reference search**: Semantic Scholar, OpenAlex, Crossref
- **Deployment**: Jagoan Hosting cPanel + GitHub Actions CI/CD

---

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma client
npx prisma generate

# 3. Setup PostgreSQL lokal (Docker)
docker run --name keluh-pg -e POSTGRES_PASSWORD=keluh -p 5432:5432 -d postgres:16

# 4. Copy env template & edit
cp .env.local.example .env.local
# Generate JWT secret: openssl rand -base64 32
# Isi DATABASE_URL, AUTH_JWT_SECRET, AI_API_KEY

# 5. Apply migrations
node scripts/migrate.js

# 6. Jalankan dev server
npm run dev
# → http://localhost:3000
```

---

## Deploy ke JKC (keluhkampus.my.id)

Lihat **[DEPLOYMENT.md](DEPLOYMENT.md)** untuk panduan step-by-step lengkap.

Ringkasan:

1. **Setup DB** di cPanel JKC → PostgreSQL Databases
2. **Setup Node.js App** di cPanel (Node 20.x, startup `server.js`)
3. **Copy `public/.htaccess`** ke `public_html/` untuk Apache reverse proxy
4. **Set env vars** di cPanel (lihat DEPLOYMENT.md §5)
5. **Generate SSH key** untuk GitHub Actions deploy
6. **Set GitHub Secrets** (lihat DEPLOYMENT.md §6)
7. **Push ke `main`** → auto-deploy 🎉

---

## Project Structure

```
keluhkampus/
├── prisma/
│   ├── schema.prisma              # 13 tabel database
│   └── migrations/0001_init/      # SQL migration (auto-generated)
├── scripts/
│   ├── migrate.js                 # Apply Prisma migrations ke JKC
│   ├── check-db.js                # Verifikasi koneksi DB
│   ├── check-security-baseline.mjs # Security policy assertions
│   ├── studio-engine.test.ts      # Studio state machine tests
│   ├── uml-quality.test.ts        # UML validation tests
│   └── format_docx.py             # Python DOCX formatter (Fix Format)
├── server.js                      # Custom Next.js entry (dipakai Passenger)
├── public/.htaccess               # Apache reverse proxy → Node
├── .github/workflows/deploy.yml   # CI/CD ke JKC
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout (AuthProvider wrapper)
│   │   ├── page.tsx               # Landing page
│   │   ├── api/                   # 25+ API routes
│   │   │   ├── auth/              # register, login, logout, me
│   │   │   ├── files/upload/      # Generic file upload
│   │   │   ├── context/extract/   # PDF/DOCX/ZIP text extraction
│   │   │   ├── references/        # Search, persist, list, evidence
│   │   │   ├── research/          # Chat, search-plan, novelty, outline
│   │   │   ├── studio/            # Questions + project CRUD
│   │   │   ├── report-jobs/       # Async report generation
│   │   │   ├── ai/                # Rewrite, structure-check, UML, dll
│   │   │   └── ...                # Lihat src/app/api/
│   │   ├── studio/                # Unified Project Studio (6 tab)
│   │   ├── dashboard/             # Report Builder
│   │   ├── uml-builder/           # UML Flow Studio
│   │   ├── data-synthesizer/      # Narasi kuesioner/wawancara
│   │   ├── ai-tools/              # Structure checker + rewriter
│   │   ├── fix-format/            # DOCX formatter
│   │   ├── editor/                # TipTap editor + DOCX export
│   │   └── tracker/               # Progress tracker
│   ├── components/                # React components
│   │   ├── AuthProvider.tsx       # React Context untuk user state
│   │   ├── AuthMenu.tsx           # Navbar login/register
│   │   ├── Editor.tsx             # TipTap wrapper
│   │   └── ...                    # Lihat src/components/
│   ├── lib/
│   │   ├── db/prisma.ts           # Prisma singleton
│   │   ├── server/
│   │   │   ├── auth.ts            # argon2 + JWT helpers
│   │   │   ├── projects.ts        # Project ownership helpers
│   │   │   └── request-guards.ts  # Rate limit + error helpers
│   │   ├── storage/upload.ts      # Filesystem + SHA256 dedup
│   │   ├── ai/client.ts           # OpenAI/Groq wrapper
│   │   ├── references/            # Semantic Scholar, OpenAlex, Crossref
│   │   ├── report/report-jobs.ts  # Async job queue
│   │   └── studio/                # State machine + project store
│   └── proxy.ts                   # Edge middleware (auth check)
└── tests/                         # (planned)
```

---

## Environment Variables

Lihat `.env.local.example` untuk template lengkap. Wajib diisi:

| Key | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_JWT_SECRET` | ✅ | Generate: `openssl rand -base64 32` |
| `AI_API_KEY` | ✅ | OpenAI / Groq API key |
| `NEXT_PUBLIC_SITE_URL` | ✅ | `https://keluhkampus.my.id` |
| `UPLOAD_DIR` | ✅ | Path absolut folder `uploads/` di server |
| `AI_MODEL`, `AI_MODEL_FAST`, `AI_MODEL_REVIEW` | opsional | Default: gpt-5.5 / gpt-5-mini |
| `AUTH_COOKIE_NAME`, `AUTH_COOKIE_SECURE` | opsional | Default: `keluhkampus_session` / `true` |
| `REFERENCE_CACHE_ADMIN_TOKEN` | opsional | Token untuk admin endpoint cache |
| `PYTHON_EXECUTABLE` | opsional | Path Python 3 untuk Fix Format |

---

## Scripts

| Script | Fungsi |
|---|---|
| `npm run dev` | Dev server (HMR) di port 3000 |
| `npm run build` | Production build (output standalone di `.next/standalone/`) |
| `npm start` | Jalankan production server (`node server.js`) |
| `npm run lint` | ESLint |
| `npm run migrate` | Apply Prisma migrations ke DB |
| `npm run studio:test` | Unit test Studio state machine |
| `npm run uml:test` | Unit test UML validator |
| `npm run security:check` | Verify security baseline |

Test standalone:

```bash
node scripts/check-db.js                  # Verify DB connectivity
node scripts/check-security-baseline.mjs  # Check security policies
node scripts/studio-engine.test.ts        # Studio tests
node scripts/uml-quality.test.ts          # UML tests
```

---

## Architecture

### Auth flow

```
User → AuthMenu (UI)
  → /api/auth/register or /api/auth/login (POST)
    → argon2.hash / argon2.verify
    → INSERT users / SELECT users
    → createSession(userId, email, name)
      → jose.SignJWT → JWT (HS256, 30 days)
      → INSERT sessions (token = primary key)
      → Set httpOnly cookie "keluhkampus_session"

Every request:
  → proxy.ts (Edge middleware) decode JWT
    → Set x-keluh-user-id header
    → Forward to route handler
  → Route handler call getCurrentUser()
    → Verify JWT signature
    → SELECT sessions WHERE id = token (anti-revoke)
    → SELECT users WHERE id = sub
    → Return SessionUser or null
```

### Database

Semua tabel user-scoped punya kolom `owner_id` + index. Anti data leak = filter by owner di setiap query. Lihat `src/lib/server/projects.ts` untuk `ownsProject()` helper.

### Report Jobs

Async job queue pattern:
- Client: `POST /api/report-jobs/start` → return `{ jobId }`
- Server: insert row `report_jobs` (status `queued`), spawn background runner
- Background: update progress tiap stage, panggil AI, finalize
- Client: poll `GET /api/report-jobs/status/[jobId]` tiap 1-2 detik
- Persistence: row di DB + cache di memory (untuk fast read)

### CI/CD

```
git push origin main
  → GitHub Actions (.github/workflows/deploy.yml)
    → npm ci
    → npx prisma generate
    → npm run build
    → Copy deploy/ bundle
    → SCP ke JKC server
    → touch tmp/restart.txt (trigger Passenger restart)
    → Health check curl keluhkampus.my.id
```

---

## Branding

- **Domain**: keluhkampus.my.id
- **Brand**: keluhkampus (lowercase)
- **Author attribution**: "by Bazzcreate" di navbar (link ke https://bazzcreate.vercel.app)
- **Git user**: Bazzcuy

---

## Contributing

1. Branch dari `main`: `git checkout -b feat/nama-fitur`
2. Commit: pesan imperative (`tambah:`, `perbaiki:`, `hapus:`)
3. Push: `git push origin feat/nama-fitur`
4. Buka PR ke `main`

Sebelum PR:
- `npm run lint` lulus
- `npx tsc --noEmit` lulus
- `npm run security:check` lulus
- Tests pass

---

## License

Proprietary — © keluhkampus. All rights reserved.

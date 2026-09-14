# Deployment Guide: keluhkampus.my.id di Jagoan Hosting (JKC)

> Panduan step-by-step deploy Next.js ke JKC paket "Dev II" (NextGen Hosting) dengan PostgreSQL JKC + GitHub Actions CI/CD ala Vercel.

---

## Daftar Isi

1. [Prasyarat](#1-prasyarat)
2. [Setup PostgreSQL di cPanel](#2-setup-postgresql-di-cpanel)
3. [Setup SSH Key untuk GitHub Actions](#3-setup-ssh-key-untuk-github-actions)
4. [Setup Node.js App di cPanel](#4-setup-nodejs-app-di-cpanel)
5. [Environment Variables](#5-environment-variables)
6. [GitHub Secrets](#6-github-secrets)
7. [Manual Deploy Pertama Kali](#7-manual-deploy-pertama-kali)
8. [CI/CD Auto Deploy](#8-cicd-auto-deploy)
9. [Verifikasi](#9-verifikasi)
10. [Migrasi Schema ke DB](#10-migrasi-schema-ke-db)
11. [Rollback](#11-rollback)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prasyarat

| Prasyarat | Status |
|---|---|
| Akun JKC + domain `keluhkampus.my.id` aktif di cPanel | ✅ |
| Akses SSH di paket (request ke support JKC kalau belum) | ✅ |
| Node.js 20.x tersedia di cPanel Setup Node.js App | ✅ |
| GitHub repo `Bazzcuy/keluhkampus` (atau repo baru) | ✅ |
| Local: `node`, `npm`, `git`, `ssh-keygen` | ✅ |

> **Catatan tentang paket**: "Paket Dev II" mungkin adalah nama lama. Saat ini JKC menjual paket **NextGen Hosting** (ICON/SUPERSTAR/LEGEND). Tier apapun yang punya Setup Node.js App + PostgreSQL cukup.

---

## 2. Setup PostgreSQL di cPanel

1. Login cPanel JKC → **PostgreSQL Databases** (atau **PostgreSQL Databases Wizard**)
2. Create database + user:
   - Database name: `keluhkampus_db`
   - User: `keluhkampus_user`
   - Password: `[generate kuat, simpan di password manager]`
3. Add user ke database dengan **ALL PRIVILEGES**
4. Catat connection string:
   ```
   postgresql://keluhkampus_user:PASSWORD@localhost:5432/keluhkampus_db
   ```
   `localhost` karena app & DB satu server.

---

## 3. Setup SSH Key untuk GitHub Actions

Generate key khusus untuk CI/CD (JANGAN pakai SSH key pribadi):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/jkc_deploy
# Tampilkan public key
cat ~/.ssh/jkc_deploy.pub
```

Di cPanel JKC → **SSH Access** → **Manage SSH Keys**:

1. **Import Key** → paste public key
2. Klik **Import** → klik **Manage** → **Authorize**

Test dari lokal:

```bash
ssh -i ~/.ssh/jkc_deploy USERNAME@keluhkampus.my.id "ls -la"
```

---

## 4. Setup Node.js App di cPanel

1. cPanel → **Setup Node.js App** → **Create Application**:
   - **Node.js version**: `20.x` (atau tertinggi)
   - **Application mode**: `Production`
   - **Application root**: `keluhkampus.my.id`
   - **Application URL**: `keluhkampus.my.id` (domain utama)
   - **Application startup file**: `server.js`
2. **Create**
3. Catat:
   - `USERNAME` (cPanel username)
   - `DEPLOY_DIR`: `/home/USERNAME/keluhkampus.my.id`

---

## 5. Environment Variables

Di Setup Node.js App → app → **Environment Variables**:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://keluhkampus_user:PASS@localhost:5432/keluhkampus_db` |
| `DIRECT_URL` | sama dengan `DATABASE_URL` |
| `AUTH_JWT_SECRET` | `openssl rand -base64 32` |
| `AUTH_COOKIE_NAME` | `keluhkampus_session` |
| `AUTH_COOKIE_SECURE` | `true` |
| `NEXT_PUBLIC_SITE_URL` | `https://keluhkampus.my.id` |
| `AI_API_KEY` | OpenAI key |
| `AI_BASE_URL` | `https://api.openai.com/v1` |
| `AI_MODEL` | `gpt-5.5` |
| `AI_MODEL_FAST` | `gpt-5-mini` |
| `AI_MODEL_REVIEW` | `gpt-5.5` |
| `AI_REPORT_TIMEOUT_MS` | `25000` |
| `UPLOAD_DIR` | `/home/USERNAME/keluhkampus.my.id/uploads` |
| `MAX_UPLOAD_BYTES` | `12582912` |
| `REFERENCE_CACHE_ADMIN_TOKEN` | random string (opsional) |

---

## 6. GitHub Secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Isi |
|---|---|
| `JKC_HOST` | `keluhkampus.my.id` |
| `JKC_USER` | cPanel username |
| `JKC_SSH_KEY` | `cat ~/.ssh/jkc_deploy` (private key, multi-line) |
| `JKC_DEPLOY_DIR` | `/home/USERNAME/keluhkampus.my.id` |
| `DATABASE_URL` | connection string |
| `DIRECT_URL` | connection string |
| `AUTH_JWT_SECRET` | sama dengan env var |
| `NEXT_PUBLIC_SITE_URL` | `https://keluhkampus.my.id` |
| `AI_API_KEY` | OpenAI key |
| `AI_BASE_URL` | `https://api.openai.com/v1` |
| `AI_MODEL` | `gpt-5.5` |
| `AI_MODEL_FAST` | `gpt-5-mini` |
| `AI_MODEL_REVIEW` | `gpt-5.5` |
| `REFERENCE_CACHE_ADMIN_TOKEN` | random (opsional) |

---

## 7. Manual Deploy Pertama Kali

SSH ke server dan setup project dari nol:

```bash
ssh -i ~/.ssh/jkc_deploy USERNAME@keluhkampus.my.id

# Buat folder deploy
mkdir -p keluhkampus.my.id
cd keluhkampus.my.id

# Clone repo
git clone https://github.com/Bazzcuy/keluhkampus.git .

# Install deps
npm ci

# Generate Prisma client
npx prisma generate

# Apply migrations (perlu DATABASE_URL di env atau .env.local)
echo 'DATABASE_URL=postgresql://keluhkampus_user:PASS@localhost:5432/keluhkampus_db' > .env.local
node scripts/migrate.js

# Verifikasi DB
node scripts/check-db.js

# Build
npm run build

# Copy static & public ke standalone output
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

# Setup .htaccess di public_html (domain utama)
cat > ~/public_html/.htaccess <<'EOF'
RewriteEngine On
RewriteRule ^(.*)$ http://localhost:3000/$1 [P,L]
EOF

# Folder uploads
mkdir -p uploads
chmod 755 uploads

# Restart Passenger (touch restart.txt di application root)
mkdir -p tmp
touch tmp/restart.txt
```

Test:

```bash
curl -I http://localhost:3000/
# Harusnya return 200/302, bukan error
```

---

## 8. CI/CD Auto Deploy

Setiap push ke `main` di GitHub akan otomatis:

1. Checkout kode
2. `npm ci` install deps
3. `npx prisma generate`
4. `npm run build` (Next.js standalone output)
5. Copy `deploy/` bundle
6. SCP ke JKC `DEPLOY_DIR`
7. SSH: `touch tmp/restart.txt` (trigger Passenger restart)
8. Health check `https://keluhkampus.my.id/`

Lihat `.github/workflows/deploy.yml` untuk detail step.

---

## 9. Verifikasi

Setelah deploy, cek:

```bash
# Public endpoint
curl -I https://keluhkampus.my.id/

# API hidup?
curl https://keluhkampus.my.id/api/auth/me

# DB connection (dari server)
ssh USERNAME@keluhkampus.my.id "cd keluhkampus.my.id && node scripts/check-db.js"

# Lihat log error (kalau ada)
ssh USERNAME@keluhkampus.my.id "tail -f ~/keluhkampus.my.id/logs/*.log"
```

Smoke test:

- [ ] Landing page `https://keluhkampus.my.id/` load tanpa error
- [ ] Register akun → cookie set
- [ ] Login → cookie set
- [ ] Buat project → row di `projects`
- [ ] Upload file → row di `file_uploads`, file di disk
- [ ] Reference search → 200
- [ ] Evidence extract → row di `reference_evidence`
- [ ] Studio project create → row di `studio_projects`
- [ ] Report job start → row di `report_jobs`, polling jalan
- [ ] DOCX export dari `/editor` → file download

---

## 10. Migrasi Schema ke DB

Setiap ada perubahan `prisma/schema.prisma`:

**Dev lokal:**

```bash
# Generate migration baru
DATABASE_URL="postgresql://..." npx prisma migrate dev --name deskripsi_perubahan

# Commit migration SQL
git add prisma/migrations/
git commit -m "schema: tambah tabel xxx"
git push origin main
```

**Auto-deploy:** CI/CD workflow jalankan `npm run build` (tidak auto-apply migration). Cara paling aman: deploy manual setelah push:

```bash
ssh USERNAME@keluhkampus.my.id "cd keluhkampus.my.id && node scripts/migrate.js"
```

Atau tambah step `npx prisma migrate deploy` ke `.github/workflows/deploy.yml` setelah build.

---

## 11. Rollback

**Rollback kode:**

```bash
git log --oneline -5
git revert HEAD
git push origin main
# CI/CD auto-deploy versi sebelumnya
```

**Rollback DB:**

Kalau migration baru menyebabkan masalah, restore backup PostgreSQL via cPanel → Backup Wizard → restore database.

**Atau hapus migration baru:**

```bash
# Hapus folder migration yang bermasalah
rm -rf prisma/migrations/<timestamp>_bad_migration
git commit -am "revert: migration broken"
git push origin main
```

---

## 12. Troubleshooting

| Masalah | Solusi |
|---|---|
| 502 Bad Gateway | Cek `.next/standalone/server.js` ada. Restart: `touch tmp/restart.txt` |
| 500 di API route | Cek env vars lengkap (terutama `DATABASE_URL`, `AUTH_JWT_SECRET`). Cek `node scripts/check-db.js` |
| Mod_proxy tidak aktif | Hubungi support JKC minta enable `mod_proxy` & `mod_proxy_http` |
| Python formatter error | Opsional, set `PYTHON_EXECUTABLE` env ke path Python 3 di JKC. Atau rewrite ke JS fallback |
| Permission uploads folder | `chmod -R 755 uploads` |
| File upload gagal | Cek `UPLOAD_DIR` env exists & writable |
| Cookie session invalid | Clear browser cookie. Pastikan `AUTH_JWT_SECRET` sama di semua instance |
| Rate limit 429 | Tunggu window (5-10 menit) atau naikkan limit di route handler |
| Migration failed | Cek `node scripts/check-db.js` → cek error message → fix schema atau reset DB |
| Standalone build missing | Jalankan `npm run build` dulu, lalu `cp -r .next/static .next/standalone/.next/` |

---

## Appendix: File-File Penting

| File | Fungsi |
|---|---|
| `prisma/schema.prisma` | Schema database |
| `prisma/migrations/*` | SQL migrations |
| `src/lib/server/auth.ts` | Auth (argon2 + JWT) |
| `src/lib/db/prisma.ts` | Prisma client singleton |
| `src/lib/storage/upload.ts` | Filesystem upload + SHA256 dedup |
| `src/lib/server/projects.ts` | Project ownership check |
| `src/lib/server/request-guards.ts` | Rate limit + error helpers |
| `src/proxy.ts` | Edge middleware (auth check) |
| `next.config.ts` | CSP, security headers, `output: standalone` |
| `server.js` | Custom Next.js entry (dipakai Passenger) |
| `public/.htaccess` | Apache reverse proxy ke Node |
| `scripts/migrate.js` | Apply Prisma migrations |
| `scripts/check-db.js` | Verifikasi DB connectivity |
| `.github/workflows/deploy.yml` | CI/CD auto-deploy |

/**
 * scripts/build-deploy.js
 * -----------------------------------------------------------------------------
 * Build Next.js standalone bundle ke folder ./deploy/ siap di-upload ke JKC.
 *
 * Cara pake:
 *   1. Set DATABASE_URL & DIRECT_URL di .env.local (Prisma perlu waktu generate)
 *   2. node scripts/build-deploy.js
 *   3. Upload isi folder deploy/ ke /home/keluhkam/keluhkampus.my.id/ via
 *      cPanel File Manager (drag-drop) ATAU lftp/WinSCP.
 *   4. Pastikan tmp/restart.txt ada di server (touch = restart app).
 *
 * Output folder ./deploy/ sudah di-ignore via .gitignore (/deploy/).
 * -----------------------------------------------------------------------------
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");

function step(msg) {
  console.log(`\n→ ${msg}`);
}

function run(cmd) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

function copy(srcRel, destRel) {
  const src = path.join(ROOT, srcRel);
  const dest = path.join(DEPLOY, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`  ✓ ${srcRel} → deploy/${destRel}`);
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  step("Clean previous bundle");
  rimraf(DEPLOY);
  fs.mkdirSync(DEPLOY, { recursive: true });

  step("Install deps (jika perlu)");
  // Skip kalau udah ada node_modules — biar cepet.
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    run("npm ci");
  } else {
    console.log("  node_modules/ udah ada, skip");
  }

  step("Generate Prisma client");
  run("npx prisma generate");

  step("Build Next.js (standalone)");
  run("npm run build");

  step("Copy bundle ke deploy/");
  copy(".next/standalone", ".");
  copy(".next/static", ".next/static");
  copy("public", "public");
  copy("prisma", "prisma");
  copy("package.json", "package.json");
  copy("server.js", "server.js");

  step("Prepare tmp/ untuk Passenger restart");
  fs.mkdirSync(path.join(DEPLOY, "tmp"), { recursive: true });
  fs.writeFileSync(path.join(DEPLOY, "tmp", "restart.txt"), "");
  console.log("  ✓ tmp/restart.txt (kosong = trigger restart)");

  step("Buat .env placeholder untuk server");
  // File ini WAJIB ada di server agar app bisa baca env. Lo yang isi manual
  // via cPanel File Manager setelah upload.
  fs.writeFileSync(
    path.join(DEPLOY, ".env"),
    [
      "# Isi manual via cPanel File Manager setelah upload.",
      "# Samain dengan isi .env.local di lokal (kecuali DATABASE_URL pakai",
      "# yang dari JKC PostgreSQL cPanel).",
      "NODE_ENV=production",
      "",
    ].join("\n")
  );
  console.log("  ✓ .env (placeholder — WAJIB diedit di server)");

  step("Bundle size");
  try {
    const out = execSync(`du -sh "${DEPLOY}"`, { encoding: "utf8" });
    console.log(`  ${out.trim()}`);
  } catch {}

  console.log("\n✓ Bundle siap di: ./deploy/");
  console.log("  Upload seluruh isi folder deploy/ ke:");
  console.log("    /home/keluhkam/keluhkampus.my.id/");
  console.log("  Lalu edit .env di server (samain dengan .env.local).");
}

main();

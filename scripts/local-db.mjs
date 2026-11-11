/**
 * scripts/local-db.mjs — PostgreSQL LOKAL untuk uji tampilan (bukan database produksi).
 *
 *   node scripts/local-db.mjs start   → jalankan server (port 5433)
 *   node scripts/local-db.mjs stop    → hentikan server
 *   node scripts/local-db.mjs reset   → migrasi + isi ulang data contoh (scripts/dev-seed.ts)
 *
 * Lokasi PostgreSQL portable: env PGSQL_HOME, bawaan ~/pgsql-local (berisi folder pgsql/ dan data/).
 * .env.local perlu: DATABASE_URL & DIRECT_URL = postgresql://postgres@localhost:5433/keluhkampus_dev?schema=public
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = process.env.PGSQL_HOME || path.join(os.homedir(), "pgsql-local");
const bin = (name) => path.join(home, "pgsql", "bin", process.platform === "win32" ? `${name}.exe` : name);
const data = path.join(home, "data");
const url = "postgresql://postgres@localhost:5433/keluhkampus_dev?schema=public";
const command = process.argv[2];

if (!existsSync(bin("pg_ctl"))) {
  console.error(`PostgreSQL portable tidak ditemukan di ${home}. Set PGSQL_HOME atau pasang dulu.`);
  process.exit(1);
}

const running = () => spawnSync(bin("pg_ctl"), ["-D", data, "status"], { stdio: "ignore" }).status === 0;

if (command === "start") {
  if (running()) { console.log("Database lokal sudah berjalan (port 5433)."); process.exit(0); }
  // Dilepas dari terminal agar server tetap hidup setelah perintah ini selesai.
  const child = spawn(bin("pg_ctl"), ["-D", data, "-o", "-p 5433", "-l", path.join(home, "pg.log"), "start"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  for (let i = 0; i < 30 && !running(); i++) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},500)"]);
  console.log(running() ? "Database lokal berjalan di port 5433." : "Gagal menjalankan database lokal; lihat pg.log.");
} else if (command === "stop") {
  spawnSync(bin("pg_ctl"), ["-D", data, "stop", "-m", "fast"], { stdio: "inherit" });
} else if (command === "reset") {
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  for (const args of [["prisma", "migrate", "deploy"], ["tsx", "scripts/dev-seed.ts"]]) {
    const result = spawnSync(npx, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} else {
  console.log("Pakai: node scripts/local-db.mjs start | stop | reset");
}

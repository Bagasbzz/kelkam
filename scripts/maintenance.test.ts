import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_MAINTENANCE, isMaintenanceExemptPath, maintenanceText, normalizeMaintenance } from "../src/lib/server/maintenance.ts";
import { getErrorMessage } from "../src/lib/errors.ts";

test("status maintenance divalidasi dan waktu mulai dipertahankan saat pesan diperbarui", () => {
  const on = normalizeMaintenance({ enabled: true, message: "  Update <b>fitur</b>\n Laporan ", until: "pukul 22.00 WIB" });
  assert.equal(on.enabled, true);
  assert.equal(on.message, "Update  b fitur /b  Laporan".replace(/\s+/g, " "));
  assert.ok(on.startedAt && !Number.isNaN(Date.parse(on.startedAt)));
  const updated = normalizeMaintenance({ enabled: true, message: "baru" }, on);
  assert.equal(updated.startedAt, on.startedAt);
  assert.deepEqual(normalizeMaintenance({ enabled: false, message: "x" }, on).startedAt, null);
  assert.equal(normalizeMaintenance(null).enabled, false);
  assert.equal(DEFAULT_MAINTENANCE.enabled, false);
});

test("halaman login, auth, dan halaman maintenance tetap terbuka", () => {
  for (const path of ["/maintenance", "/login", "/api/auth/login", "/api/auth/me"]) assert.equal(isMaintenanceExemptPath(path), true, path);
  for (const path of ["/", "/dashboard", "/api/laporan/sessions", "/api/report-jobs/tick", "/superadmin", "/api/admin/maintenance"]) assert.equal(isMaintenanceExemptPath(path), false, path);
});

test("pesan maintenance jelas dan tidak diganti pesan teknis", () => {
  const text = maintenanceText({ message: "Kami memperbarui fitur Laporan.", until: "pukul 22.00 WIB" });
  assert.match(text, /pemeliharaan.*Laporan.*22\.00/);
  assert.equal(getErrorMessage(new Error(text)), text);
  assert.equal(getErrorMessage(new Error(maintenanceText({ message: "", until: "" }))), maintenanceText({ message: "", until: "" }));
});

test("proxy menutup semua halaman & API saat maintenance, kecuali super admin", async () => {
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  // Cek maintenance terjadi sebelum endpoint publik (cron tick, track) dilewatkan.
  assert.ok(proxy.indexOf("maintenanceResponse(request, pathname)") < proxy.indexOf("PUBLIC_API_EXACT_PATHS.includes(pathname)"));
  assert.match(proxy, /isSuperAdminId\(userId\)/);
  assert.match(proxy, /status: 503/);
  assert.match(proxy, /"\/\(\(\?!api\/\|_next\/\|maintenance\)\[\^\.\]\*\)"/);
});

test("proses latar dijeda (bukan digagalkan) saat maintenance", async () => {
  const engine = await readFile(new URL("../src/lib/server/agent-runs/engine.ts", import.meta.url), "utf8");
  assert.match(engine, /maintenanceBlocks\(row0\.ownerId\)\) return release\("queued"/);
  const jobs = await readFile(new URL("../src/lib/report/report-jobs.ts", import.meta.url), "utf8");
  assert.match(jobs, /if \(await maintenanceBlocks\(ownerId\)\) return toPublic\(row\);/);
  const images = await readFile(new URL("../src/lib/server/image-jobs.ts", import.meta.url), "utf8");
  assert.match(images, /maintenanceBlocks\(pending\.ownerId\)\) return;/);
});

test("gambar usulan presentasi dipasang server ke slide kosong saat job selesai", async () => {
  const images = await readFile(new URL("../src/lib/server/image-jobs.ts", import.meta.url), "utf8");
  assert.match(images, /placeFinishedPlanImage\(job\.ownerId, sessionId, id, upload\.id\)/);
  const repo = await readFile(new URL("../src/lib/server/presentasi/repository.ts", import.meta.url), "utf8");
  assert.match(repo, /if \(!slide \|\| slide\.art \|\| slide\.locked\) return false;/);
  assert.match(repo, /validatePresentationArt\(ownerId, projectId, deck, state\.deck, tx\)/);
  const workspace = await readFile(new URL("../src/components/presentation/PresentationWorkspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /pendingArtKey/);
  const panel = await readFile(new URL("../src/components/presentation/PresentationPlanPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /autoPlace/);
});

test("proxy saat maintenance aktif: API 503, halaman ke /maintenance, super admin & login tetap lewat", async () => {
  const ts = (await import("typescript")).default;
  const { runInNewContext } = await import("node:vm");
  const source = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const { isMaintenanceExemptPath: exempt } = await import("../src/lib/server/maintenance.ts");
  const rewrites: string[] = [];
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: {
      next: () => new Response(null, { status: 204 }),
      json: Response.json.bind(Response),
      rewrite: (url: URL, init?: ResponseInit) => { rewrites.push(url.pathname); return new Response(null, { status: init?.status ?? 200 }); },
      redirect: (url: URL) => new Response(null, { status: 307, headers: { location: String(url) } }),
    } },
    jose: { jwtVerify: async (token: string) => ({ payload: { sub: token === "admin-token" ? "owner-id" : "user-id" } }) },
    "@/lib/server/auth": { SESSION_COOKIE_NAME: "session" },
    "@/lib/server/request-guards": { enforceRateLimit: () => null },
    "@/lib/server/maintenance": { isMaintenanceExemptPath: exempt, isSuperAdminId: async (id: string) => id === "owner-id", loadMaintenance: async () => ({ enabled: true, message: "", until: "" }), maintenanceText: () => "Sedang pemeliharaan." },
  };
  const exports: { proxy?: (request: unknown) => Promise<Response> } = {};
  runInNewContext(compiled.outputText, {
    exports, Headers, TextEncoder, URL, process: { env: { NODE_ENV: "test", AUTH_JWT_SECRET: "offline" } },
    require: (name: string) => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; },
  });
  const call = (pathname: string, token?: string) => exports.proxy!({
    nextUrl: { pathname }, method: "GET", url: `http://localhost${pathname}`, headers: new Headers(),
    cookies: { get: () => (token ? { value: token } : undefined) },
  });
  const api = await call("/api/laporan/sessions", "user-token");
  assert.equal(api.status, 503);
  assert.equal((await api.json()).maintenance, true);
  assert.equal((await call("/api/report-jobs/tick")).status, 503, "cron tick ikut dijeda");
  assert.equal((await call("/")).status, 503);
  assert.equal((await call("/fitur")).status, 503);
  assert.deepEqual(rewrites, ["/maintenance", "/maintenance"]);
  assert.equal((await call("/login")).status, 204);
  assert.equal((await call("/api/auth/login")).status, 204);
  assert.equal((await call("/api/laporan/sessions", "admin-token")).status, 204, "super admin tetap bisa memakai situs");
  assert.equal((await call("/fitur", "admin-token")).status, 204);
});

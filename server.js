/**
 * server.js
 * -----------------------------------------------------------------------------
 * Custom Next.js server entry untuk cPanel Node.js App / Passenger.
 *
 * Kenapa pakai custom server (bukan `next start` default)?
 *   - cPanel Passenger menjalankan `node server.js` sebagai entry point.
 *   - `next start` bawaan Next.js juga jalan di Node, tapi custom server
 *     lebih transparan — kita bisa lihat log, custom port, dll.
 *   - Output `standalone` di next.config.ts menghasilkan server.js ini
 *     di .next/standalone/ yang siap di-copy ke server.
 *
 * CARA PAKAI:
 *   - Dev lokal:        npm run dev  (pakai next dev)
 *   - Production local: node server.js
 *   - cPanel:           Passenger jalankan `node server.js` otomatis.
 *
 * ENVIRONMENT VARIABLES:
 *   - PORT     : port listen (default 3000)
 *   - HOSTNAME : interface listen (default 0.0.0.0 — semua interface)
 *   - NODE_ENV : "production" untuk disable dev features
 *
 * APACHE REVERSE PROXY:
 *   - JKC jalankan Apache di :80/:443 (public).
 *   - Apache .htaccess forward ke http://localhost:3000 (lihat public/.htaccess).
 *   - Custom server listen di 0.0.0.0:3000 (loopback atau internal).
 *
 * CATATAN:
 *   - `process.chdir(__dirname)` supaya Next.js resolve path relatif
 *     terhadap file ini, bukan cwd Passenger.
 *   - `parse()` dari `url` module adalah legacy API, tapi stabil & no deps.
 *   - JKC Main Domain DocumentRoot = /public_html/. Passenger cuma handle
 *     path yang match Application root (/keluhkampus.my.id/). Apache
 *     .htaccess rewrite "/" → "/keluhkampus.my.id/" secara internal supaya
 *     request root juga sampai ke app. Kita strip prefix di sini sebelum
 *     forward ke Next.js biar route matching tetap bener.
 * -----------------------------------------------------------------------------
 */

const { createServer } = require("http");
const { parse } = require("url");
const { existsSync, readFileSync } = require("fs");
const path = require("path");

// Keep relative uploads/data paths anchored to the Passenger application root.
process.chdir(__dirname);

const dev = process.env.NODE_ENV !== "production";
const standaloneDir = path.join(__dirname, ".next", "standalone");
const appDir = !dev && existsSync(standaloneDir) ? standaloneDir : __dirname;
const { loadEnvConfig } = require(require.resolve("@next/env", { paths: [appDir] }));
loadEnvConfig(__dirname, dev);
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";
// Runtime assets follow the selected release; private data stays rooted at cwd.
process.env.APPLICATION_NODE_MODULES = path.join(appDir, "node_modules");
const manifestPath = path.join(appDir, ".next", "required-server-files.json");
if (!dev && (appDir === standaloneDir || existsSync(manifestPath))) {
  // Use the traced build's resolved config, not an obsolete root next.config file.
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(manifest.config);
}
const next = require(require.resolve("next", { paths: [appDir] }));

// Path prefix yang ditambahin sama Apache .htaccess rewrite di root domain.
// Main domain DocumentRoot = /public_html/, jadi request "/" di-rewrite ke
// "/keluhkampus.my.id/" sebelum sampai ke Passenger. Kita strip prefix di
// sini supaya Next.js route matching (Next.js gak tau soal subfolder).
const APP_PATH_PREFIX = "/keluhkampus.my.id";

const app = next({ dev, dir: appDir });
const handle = app.getRequestHandler();

app.prepare()
  .then(() => {
    createServer((req, res) => {
      const parsedUrl = parse(req.url || "/", true);
      if (parsedUrl.pathname && parsedUrl.pathname.startsWith(APP_PATH_PREFIX)) {
        parsedUrl.pathname =
          parsedUrl.pathname.replace(APP_PATH_PREFIX, "") || "/";
      }
      handle(req, res, parsedUrl);
    })
    .listen(port, hostname, () => {
      console.log(`keluhkampus ready on http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start Next.js:", err);
    process.exit(1);
  });

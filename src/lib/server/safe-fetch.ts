/**
 * src/lib/server/safe-fetch.ts
 * -----------------------------------------------------------------------------
 * Fetch keluar (server → internet) yang aman dari SSRF.
 *
 * Kenapa perlu: URL PDF jurnal / gambar datang dari pihak luar (OpenAlex,
 * Crossref, Unpaywall, provider AI). Tanpa pengecekan, URL atau REDIRECT-nya
 * bisa diarahkan ke jaringan internal (127.0.0.1, 10.x, 169.254.169.254
 * metadata cloud, dsb) sehingga server kita dipakai untuk mengintip layanan dalam.
 *
 * Cara kerja:
 *   - Hanya http/https, port standar (80/443/8080/8443) atau tanpa port.
 *   - Hostname di-resolve via DNS; SEMUA alamat hasil resolve harus publik.
 *   - Redirect diikuti manual (maks 5), tiap lompatan dicek ulang.
 *   - Ukuran body dibatasi (stream dibaca bertahap, berhenti saat lewat batas).
 *
 * Catatan: masih ada celah teoretis DNS rebinding (resolve publik, lalu koneksi
 * ke IP lain). Risikonya kecil untuk kasus ini; untuk perlindungan penuh perlu
 * custom dispatcher yang mem-pin IP.
 * -----------------------------------------------------------------------------
 */

import { lookup } from "node:dns/promises";
import net from "node:net";

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

/** true bila alamat IP termasuk jaringan privat/loopback/link-local/reserved. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (TEST-NET-1)
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a === 198 && b === 51) return true; // TEST-NET-2
    if (a === 203 && b === 0) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    // IPv4-mapped (::ffff:10.0.0.1) → cek bagian IPv4-nya.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(v)) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
    if (/^ff/.test(v)) return true; // multicast
    if (v.startsWith("2001:db8")) return true; // dokumentasi
    if (v.startsWith("64:ff9b:")) return true; // NAT64 (bisa memetakan ke IPv4 privat)
    return false;
  }
  return true; // bukan IP valid → anggap tidak aman
}

const ALLOWED_PORTS = new Set(["80", "443", "8080", "8443"]);

/** Validasi URL + resolve DNS. Lempar SafeFetchError bila tidak aman. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("URL tidak valid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SafeFetchError("Skema URL tidak diizinkan.");
  if (url.username || url.password) throw new SafeFetchError("URL dengan kredensial tidak diizinkan.");
  // 8080/8443 dipakai banyak server OJS jurnal kampus; port lain tetap ditolak.
  if (url.port && !ALLOWED_PORTS.has(url.port)) throw new SafeFetchError("Port tidak diizinkan.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || /^localhost$/i.test(host) || /\.(localhost|local|internal|lan|home|corp)$/i.test(host)) {
    throw new SafeFetchError("Host tidak diizinkan.");
  }

  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new SafeFetchError("Host tidak bisa di-resolve.");
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new SafeFetchError("Alamat jaringan internal tidak diizinkan.");
  return url;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Batas ukuran body (byte). Default 15 MB. */
  maxBytes?: number;
  maxRedirects?: number;
  /** Lewati pembacaan body (mis. hanya butuh header). */
  skipBody?: boolean;
  /**
   * Baca body hanya sampai N byte lalu putus koneksi (tanpa error).
   * Dipakai untuk mengintip signature file / meta HTML tanpa mengunduh semuanya.
   */
  peekBytes?: number;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  headers: Headers;
  finalUrl: string;
  body: Buffer;
}

/** Fetch dengan validasi SSRF di setiap lompatan redirect + batas ukuran body. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 20_000;
  // Batas total supaya rantai redirect lambat tetap berhenti; tiap hop juga punya
  // timeout sendiri agar satu hop lambat tidak memakan jatah hop berikutnya.
  const overall = AbortSignal.timeout(timeoutMs * 2);

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const signal = AbortSignal.any([overall, AbortSignal.timeout(timeoutMs)]);
    const resp = await fetch(url, { method: options.method ?? "GET", headers: options.headers, redirect: "manual", signal });

    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      await resp.body?.cancel().catch(() => undefined);
      current = new URL(resp.headers.get("location") as string, url).toString();
      continue;
    }

    if (options.skipBody || options.method === "HEAD" || !resp.body) {
      await resp.body?.cancel().catch(() => undefined);
      return { ok: resp.ok, status: resp.status, headers: resp.headers, finalUrl: url.toString(), body: Buffer.alloc(0) };
    }

    const peek = options.peekBytes && options.peekBytes > 0 ? Math.min(options.peekBytes, maxBytes) : 0;
    const declared = Number(resp.headers.get("content-length") || 0);
    if (!peek && declared > maxBytes) {
      await resp.body.cancel().catch(() => undefined);
      throw new SafeFetchError("Ukuran respons melebihi batas.");
    }

    // Baca bertahap: berhenti segera bila melebihi batas (anti server yang bohong content-length).
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (peek && total >= peek) {
        chunks.push(value);
        await reader.cancel().catch(() => undefined);
        return { ok: resp.ok, status: resp.status, headers: resp.headers, finalUrl: url.toString(), body: Buffer.concat(chunks).subarray(0, peek) };
      }
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SafeFetchError("Ukuran respons melebihi batas.");
      }
      chunks.push(value);
    }
    return { ok: resp.ok, status: resp.status, headers: resp.headers, finalUrl: url.toString(), body: Buffer.concat(chunks) };
  }
  throw new SafeFetchError("Terlalu banyak redirect.");
}

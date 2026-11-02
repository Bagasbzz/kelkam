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
 * DNS validation does NOT pin the connection address. DNS rebinding remains
 * possible between lookup and fetch; a pinned dispatcher or egress policy is
 * required when that guarantee is needed.
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
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // special use + TEST-NET-1
    if (a === 192 && b === 88 && c === 99) return true; // deprecated 6to4 relay
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (net.isIPv6(ip) && !ip.includes("%")) {
    // WHATWG URLs convert dotted mapped IPv4 to hex. Classify words, not spelling.
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split("::");
    const head = left ? left.split(":") : [];
    const tail = right ? right.split(":") : [];
    const words = (right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail])
      .map((word) => parseInt(word, 16));
    if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
      return isPrivateAddress(`${words[6] >>> 8}.${words[6] & 255}.${words[7] >>> 8}.${words[7] & 255}`);
    }
    // Only global unicast 2000::/3; excludes compatible IPv4, NAT64, ULA,
    // link/site-local, multicast, unspecified and other reserved allocations.
    if ((words[0] & 0xe000) !== 0x2000) return true;
    if (words[0] === 0x2001 && words[1] < 0x200) return true; // special-use /23, incl. Teredo
    if (words[0] === 0x2001 && words[1] === 0xdb8) return true;
    if (words[0] === 0x2002) return true; // 6to4 can embed private IPv4
    if (words[0] === 0x3fff && words[1] < 0x1000) return true; // documentation /20
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

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
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
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647 / 2 ||
      (options.peekBytes !== undefined && (!Number.isSafeInteger(options.peekBytes) || options.peekBytes < 0))) {
    throw new SafeFetchError("Batas fetch tidak valid.");
  }
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
        chunks.push(value.subarray(0, peek - (total - value.byteLength)));
        await reader.cancel().catch(() => undefined);
        return { ok: resp.ok, status: resp.status, headers: resp.headers, finalUrl: url.toString(), body: Buffer.concat(chunks, peek) };
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

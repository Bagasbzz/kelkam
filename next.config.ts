/**
 * next.config.ts
 * -----------------------------------------------------------------------------
 * Konfigurasi Next.js untuk keluhkampus.
 *
 * FITUR UTAMA:
 *   1. output: "standalone"
 *      Build menghasilkan .next/standalone/ yang berisi Next.js server +
 *      minimal node_modules. Cocok untuk deploy ke JKC cPanel Node.js App
 *      (lihat DEPLOYMENT.md).
 *
 *   2. Content-Security-Policy (CSP)
 *      Hardening default — batasi sumber script, image, connect, dll.
 *      Boleh dilonggarkan kalau ada integrasi eksternal baru.
 *
 *   3. Security Headers (X-Frame-Options, X-Content-Type-Options, dll)
 *      Dipakai di SEMUA response via async headers().
 *
 * ENVIRONMENT VARIABLES:
 *   - NEXT_PUBLIC_SITE_URL: domain publik (default keluhkampus.my.id).
 *     Ditambahkan ke CSP connect-src supaya browser boleh fetch dari origin ini.
 *   - NODE_ENV: production / development.
 *     Saat production: CSP pakai 'unsafe-eval' OFF, upgrade-insecure-requests ON.
 *
 * HEADER DAFTAR:
 *   - Content-Security-Policy: lihat variable di atas
 *   - Referrer-Policy: strict-origin-when-cross-origin (no leak ke third party)
 *   - X-Content-Type-Options: nosniff (anti MIME confusion)
 *   - X-Frame-Options: DENY (anti clickjacking)
 *   - Permissions-Policy: disable camera/mic/geo/payment (prinsip minimal)
 *   - Cross-Origin-Opener-Policy: same-origin (Spectre mitigation)
 *   - Cross-Origin-Resource-Policy: same-origin
 *   - poweredByHeader: false (hilangkan "X-Powered-By: Next.js" leak)
 * -----------------------------------------------------------------------------
 */

import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Origin publik aplikasi. Ditambahkan ke CSP `connect-src` supaya
 * browser boleh melakukan fetch cross-origin ke URL ini.
 * Override via NEXT_PUBLIC_SITE_URL kalau deploy ke domain lain.
 */
const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL || "https://keluhkampus.my.id";

/** Origin AI providers — boleh di-fetch langsung dari browser (mis. proxy). */
const aiOrigins = ["https://api.openai.com", "https://api.groq.com"];

// ---------------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------------

/**
 * Content Security Policy.
 * Catatan: 'unsafe-inline' untuk script diperlukan karena Next.js inject
 * inline script untuk hydration. Untuk production yang butuh strict,
 * pakai nonce-based CSP.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${siteOrigin} ${aiOrigins.join(" ")}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(!isDevelopment ? ["upgrade-insecure-requests"] : []),
].join("; ");

/** Daftar security headers yang dipasang di SEMUA response. */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

// ---------------------------------------------------------------------------
// Next.js config
// ---------------------------------------------------------------------------

const nextConfig: NextConfig = {
  /** Build sebagai standalone → .next/standalone/ siap di-deploy ke JKC. */
  output: "standalone",
  /** Hilangkan header "X-Powered-By: Next.js" (info disclosure). */
  poweredByHeader: false,
  /** Pasang security headers di semua response. */
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
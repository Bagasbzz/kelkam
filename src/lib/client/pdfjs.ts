/**
 * src/lib/client/pdfjs.ts
 * -----------------------------------------------------------------------------
 * Konfigurasi pdfjs-dist worker untuk browser.
 *
 * pdfjs-dist secara default spawn Web Worker untuk parsing PDF.
 * Next.js webpack tidak otomatis mendeteksi worker file dari
 * node_modules/pdfjs-dist/build/, jadi kita pakai ?url import untuk
 * mendapat URL statis.
 *
 * Hanya dipanggil saat di browser (typeof window !== "undefined").
 * Import modul ini dari komponen client yang pakai `getDocument`.
 * -----------------------------------------------------------------------------
 */

"use client";

import * as pdfjsLib from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — ?url import di-handle Next.js webpack, return string URL.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let configured = false;

/**
 * Set global workerSrc untuk pdfjs-dist. Idempotent — aman dipanggil
 * berkali-kali. Hanya jalan di browser; di server no-op.
 */
export function configurePdfJs(): void {
  if (configured) return;
  if (typeof window === "undefined") return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  configured = true;
}
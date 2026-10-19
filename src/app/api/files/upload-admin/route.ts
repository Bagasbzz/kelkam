/**
 * POST /api/files/upload-admin
 * -----------------------------------------------------------------------------
 * Upload file APAPUN untuk role ADMIN, TANPA batas ukuran aplikasi (video,
 * materi besar, arsip, dll). User biasa tetap lewat /api/files/upload (12 MB).
 * Detail desain & keamanan: src/lib/server/admin-upload.ts.
 * Route ini dikecualikan dari matcher proxy.ts (anti body terpotong).
 */

import { handleAdminRawUpload } from "@/lib/server/admin-upload";

export const runtime = "nodejs";

/** File besar + koneksi lambat: 30 menit. */
export const maxDuration = 1800;

export async function POST(req: Request) {
  return handleAdminRawUpload(req);
}

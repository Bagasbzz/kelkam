/**
 * POST /api/files/upload-video
 * -----------------------------------------------------------------------------
 * Upload video admin (kompatibilitas). Sama dengan /api/files/upload-admin
 * tetapi MIME wajib video yang bisa diputar browser.
 * Route ini dikecualikan dari matcher proxy.ts (anti body terpotong).
 */

import { handleAdminRawUpload } from "@/lib/server/admin-upload";
import { SAFE_VIDEO_MIME_RE } from "@/lib/security/file-types";

export const runtime = "nodejs";
export const maxDuration = 1800;

export async function POST(req: Request) {
  return handleAdminRawUpload(req, {
    requireMime: SAFE_VIDEO_MIME_RE,
    requireMimeMessage: "Hanya file video (MP4/WebM/MOV/MKV/AVI) yang boleh diunggah lewat endpoint ini.",
  });
}

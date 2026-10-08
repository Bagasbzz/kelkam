/**
 * GET /api/files/[fileId]
 * Mengirim byte file milik user yang login (FileUpload.ownerId harus cocok).
 * Dipakai untuk preview gambar hasil AI dan untuk ekspor DOCX di browser.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { readUpload } from "@/lib/storage/upload";

const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

export async function GET(_req: Request, context: { params: Promise<{ fileId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const { fileId } = await context.params;
  if (!/^[a-z0-9]{10,40}$/i.test(fileId)) {
    return NextResponse.json({ success: false, error: "ID file tidak valid." }, { status: 400 });
  }

  const meta = await prisma.fileUpload.findFirst({
    where: { id: fileId, ownerId: auth.user.id },
    select: { mime: true, originalName: true, size: true },
  });
  if (!meta) return NextResponse.json({ success: false, error: "File tidak ditemukan." }, { status: 404 });

  const bytes = await readUpload(fileId, auth.user.id);
  if (!bytes) return NextResponse.json({ success: false, error: "File tidak ditemukan." }, { status: 404 });

  const mime = INLINE_MIME.has(meta.mime) ? meta.mime : "application/octet-stream";
  const disposition = INLINE_MIME.has(meta.mime) ? "inline" : "attachment";
  const safeName = meta.originalName.replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "file";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

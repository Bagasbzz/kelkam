import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { safeFetch } from "@/lib/server/safe-fetch";
import { BROWSER_USER_AGENT } from "@/lib/references/verify-pdf";
import { collectReferencePdfs, MAX_PDF_BYTES, MAX_PDF_DOWNLOADS } from "@/lib/references/download-pdfs";
import type { VerifiedSource } from "@/lib/references/find-sources";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ ids: z.array(z.string().min(1).max(300)).min(1).max(MAX_PDF_DOWNLOADS), zip: z.boolean().optional() }).strict();

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const limited = enforceRateLimit(`reference-pdf-download:${auth.user.id}`, { limit: 12, windowMs: 10 * 60 * 1000 });
    if (limited) return limited;
    const parsed = Body.safeParse(await readJsonBody<unknown>(req, 8 * 1024));
    if (!parsed.success) throw new ApiRequestError(400, `Pilih 1-${MAX_PDF_DOWNLOADS} sumber untuk diunduh.`);
    const { sessionId } = await context.params;
    const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId: auth.user.id }, select: { sources: true } });
    if (!row) throw new ApiRequestError(404, "Sesi tidak ditemukan.");
    const ids = new Set(parsed.data.ids);
    const sources = ((Array.isArray(row.sources) ? row.sources : []) as unknown as VerifiedSource[]).filter((s) => ids.has(s.id));
    if (sources.length !== ids.size) throw new ApiRequestError(404, "Sumber tidak ditemukan di sesi ini.");
    if (!parsed.data.zip && sources.length !== 1) throw new ApiRequestError(400, "Pakai unduhan ZIP untuk beberapa sumber.");
    const { files, skipped } = await collectReferencePdfs(sources, async (url) => {
      const response = await safeFetch(url, { timeoutMs: 15_000, maxBytes: MAX_PDF_BYTES, headers: { Accept: "application/pdf", "User-Agent": BROWSER_USER_AGENT } });
      return response.ok ? response.body : null;
    });
    if (!files.length) throw new ApiRequestError(422, "PDF belum bisa diunduh dari penerbit. Gunakan Buka PDF atau halaman artikel sebagai alternatif.");
    let bytes: Uint8Array;
    let name: string;
    if (parsed.data.zip) {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const file of files) zip.file(file.path, file.bytes, { compression: "STORE" });
      zip.file("daftar-sumber.json", JSON.stringify({ downloaded: files.map((f) => f.path), skipped, sources: sources.map((s) => ({ title: s.title, citation: s.citationApa, doi: s.doiUrl, url: s.url })) }, null, 2));
      bytes = await zip.generateAsync({ type: "uint8array" });
      name = "referensi-laporan.zip";
    } else {
      bytes = new Uint8Array(files[0].bytes);
      name = files[0].path;
    }
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": parsed.data.zip ? "application/zip" : "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Downloaded-Count": String(files.length),
      "X-Skipped-Count": String(skipped.length),
    } });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal mengunduh referensi.");
  }
}

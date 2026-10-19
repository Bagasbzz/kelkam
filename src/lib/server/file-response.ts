/**
 * Helper respons file dari disk: streaming (bukan readFile) + dukungan HTTP Range.
 * Aman untuk file besar (video/arsip ratusan MB) tanpa membebani memori server.
 */
import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

/** Parse header `Range: bytes=start-end` (hanya satu range yang didukung). */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, s, e] = m;
  if (s === "" && e === "") return "invalid";
  let start: number;
  let end: number;
  if (s === "") {
    const suffix = Number(e);
    if (suffix <= 0) return "invalid";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid";
  return { start, end };
}

/** Header Content-Disposition aman (ASCII fallback + RFC 5987 UTF-8). */
export function contentDisposition(type: "inline" | "attachment", originalName: string, fallback = "file"): string {
  const safeName = originalName.replace(/[\\/\r\n"\x00-\x1f]/g, "_") || fallback;
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

/**
 * Stream file dari disk. Return null kalau file tidak ada (caller kirim 404).
 * `headers` tambahan digabung (Content-Type, Content-Disposition, Cache-Control, ...).
 */
export async function streamFileResponse(
  req: Request,
  filePath: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return null;
  }

  const base: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ...headers,
  };

  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  base["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  if (range) base["Content-Range"] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;

  if (req.method === "HEAD" || size === 0) return new NextResponse(null, { status, headers: base });

  const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
  return new NextResponse(body, { status, headers: base });
}

/**
 * Ekspor DOCX laporan di server: draft markdown sesi + diagram (SVG → PNG via
 * resvg) + ilustrasi (image job selesai) → file DOCX tersimpan sebagai
 * FileUpload milik user, diunduh lewat /api/files/[fileId]. Dipakai untuk
 * mengirim tautan unduhan langsung di chat saat job selesai / setelah revisi.
 */
import { Packer } from "docx";
import { stripDashes } from "@/lib/ai/client";
import { prisma } from "@/lib/db/prisma";
import { listImageJobs } from "@/lib/server/image-jobs";
import { readUpload, saveUpload } from "@/lib/storage/upload";
import { buildDocxDocument, docxFileName, DOCX_PRESETS, parseFormatRules, presetForDocumentType } from "@/utils/markdown-docx-exporter";
import { svgToPngServer } from "./svg-raster";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface SessionDocxInput {
  sessionId: string;
  ownerId: string;
  title: string;
  draft: string;
  brief: {
    documentType?: string; course?: string; institution?: string; formatRules?: string;
    studentName?: string; studentId?: string; lecturer?: string; program?: string; faculty?: string;
  };
  diagrams: { title: string; svg?: string }[];
  /** Gambar dari bahan user (PNG tersimpan sebagai FileUpload milik owner). */
  figures?: { title: string; fileId?: string }[];
}

export interface SessionDocxResult {
  url: string;
  name: string;
  size: number;
  /** Ilustrasi yang masih diproses saat ekspor (belum ikut di file). */
  pendingFigures: number;
  /** Placeholder gambar yang tidak punya sumber gambar. */
  missingImages: number;
}

export async function exportSessionDocx(input: SessionDocxInput): Promise<SessionDocxResult> {
  const images: Record<string, Uint8Array> = {};
  // Kunci gambar disamakan dengan draft yang sudah dibersihkan dari em/en dash.
  const imageKey = (title: string) => stripDashes(title).trim().toLowerCase();
  const [user, imageJobs] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.ownerId }, select: { name: true } }),
    listImageJobs(input.ownerId, { sessionId: input.sessionId, limit: 40 }).catch(() => []),
  ]);

  await Promise.all(imageJobs.filter((job) => job.status === "done" && job.fileId && job.title).map(async (job) => {
    const bytes = await readUpload(job.fileId!, input.ownerId).catch(() => null);
    if (bytes) images[imageKey(job.title)] = new Uint8Array(bytes);
  }));
  await Promise.all((input.figures || []).filter((f) => f.fileId && f.title).map(async (f) => {
    const bytes = await readUpload(f.fileId!, input.ownerId).catch(() => null);
    if (bytes) images[imageKey(f.title)] = new Uint8Array(bytes);
  }));
  // Rasterisasi berurutan: WASM single-thread, hindari lonjakan memori.
  for (const diagram of input.diagrams) {
    if (!diagram.svg || !diagram.title) continue;
    try {
      images[imageKey(diagram.title)] = await svgToPngServer(diagram.svg);
    } catch (error) {
      console.warn("[laporan] rasterisasi diagram gagal:", diagram.title, error instanceof Error ? error.message : error);
    }
  }

  const draft = stripDashes(input.draft);
  const placeholders = Array.from(draft.matchAll(/^\[Gambar:\s*(.+?)\]\s*$/gim)).map((m) => {
    const inner = m[1].trim();
    const sep = inner.lastIndexOf(" - ");
    return (sep > 0 ? inner.slice(0, sep) : inner).trim().toLowerCase();
  });
  const missingImages = placeholders.filter((key) => !images[key]).length;
  const pendingFigures = imageJobs.filter((job) => job.status === "queued" || job.status === "running").length;

  const subtitle = input.brief.documentType ? `${input.brief.documentType}${input.brief.course ? ` ${input.brief.course}` : ""}` : undefined;
  // Preset dari jenis dokumen, lalu ditimpa ketentuan format kampus yang ditulis user.
  const preset = DOCX_PRESETS[presetForDocumentType(input.brief.documentType)].profile;
  const rules = parseFormatRules(input.brief.formatRules);
  const doc = buildDocxDocument(draft, {
    profile: {
      ...preset,
      ...rules,
      margin: { ...preset.margin, ...rules.margin },
      cover: {
        title: input.title,
        subtitle,
        author: input.brief.studentName || user?.name || undefined,
        studentId: input.brief.studentId,
        lecturer: input.brief.lecturer,
        program: input.brief.program,
        faculty: input.brief.faculty,
        institution: input.brief.institution || undefined,
        year: String(new Date().getFullYear()),
      },
    },
    images,
  });
  const buffer = await Packer.toBuffer(doc);
  const name = docxFileName(input.title);
  const saved = await saveUpload({ ownerId: input.ownerId, buffer, originalName: name, mime: DOCX_MIME });
  return { url: `/api/files/${saved.id}`, name, size: buffer.length, pendingFigures, missingImages };
}

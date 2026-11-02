/**
 * Ekspor DOCX laporan di server: draft markdown sesi + diagram (SVG → PNG via
 * resvg) + ilustrasi (image job selesai) → file DOCX tersimpan sebagai
 * FileUpload milik user, diunduh lewat /api/files/[fileId]. Dipakai untuk
 * mengirim tautan unduhan langsung di chat saat job selesai / setelah revisi.
 */
import { Packer } from "docx";
import { figurePlaceholders, normalizeFigureKey, reconcileFigurePlaceholders, type FigureAsset, type FigureOutlineSection } from "@/lib/report/figure-placeholders";
import { prisma } from "@/lib/db/prisma";
import { listImageJobs } from "@/lib/server/image-jobs";
import { readUpload, saveUpload } from "@/lib/storage/upload";
import { buildDocxDocument, docxFileName, DOCX_PRESETS, parseFormatRules, presetForDocumentType } from "@/utils/markdown-docx-exporter";
import { svgToPngServer } from "./svg-raster";
import { normalizeReportIntent, type ReportIntent } from "@/lib/report/report-intent";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface SessionDocxInput {
  sessionId: string;
  ownerId: string;
  title: string;
  draft: string;
  preset?: keyof typeof DOCX_PRESETS;
  outline?: FigureOutlineSection[];
  brief: {
    documentType?: string; course?: string; institution?: string; formatRules?: string;
    studentName?: string; studentId?: string; lecturer?: string; program?: string; faculty?: string;
    intent?: ReportIntent;
  };
  diagrams: { title: string; status?: "planned" | "approved" | "failed"; svg?: string; caption?: string; purpose?: string; sectionId?: string }[];
  /** Gambar dari bahan user (PNG tersimpan sebagai FileUpload milik owner). */
  figures?: { title: string; fileId?: string; caption?: string; sectionId?: string }[];
}

export interface SessionDocxResult {
  url: string;
  name: string;
  size: number;
  /** Ilustrasi yang masih diproses saat ekspor (belum ikut di file). */
  pendingFigures: number;
  /** Placeholder gambar yang tidak punya sumber gambar. */
  missingImages: number;
  missingImageTitles: string[];
  pendingFigureTitles: string[];
}

export async function exportSessionDocx(input: SessionDocxInput): Promise<SessionDocxResult> {
  const intent = normalizeReportIntent(input.brief.intent);
  const scoped = intent.outputMode !== "full_report" || intent.explicit.scope;
  const omitAssets = intent.diagrams === "omit" || intent.outputMode === "citations_only";
  const diagrams = omitAssets ? [] : input.diagrams;
  const figures = omitAssets ? [] : input.figures || [];
  const images: Record<string, Uint8Array> = Object.create(null);
  const [user, imageJobs] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.ownerId }, select: { name: true } }),
    (omitAssets ? Promise.resolve([]) : listImageJobs(input.ownerId, { sessionId: input.sessionId, limit: 50 })).catch((error) => {
      console.warn("[laporan] gagal memuat ilustrasi saat ekspor:", error);
      return [];
    }),
  ]);

  // Jobs are newest-first. Resolve sequentially so duplicate titles never race.
  for (const job of imageJobs.filter((job) => job.status === "done" && job.fileId && job.title)) {
    const key = normalizeFigureKey(job.title);
    if (images[key]) continue;
    const bytes = await readUpload(job.fileId!, input.ownerId).catch(() => null);
    if (bytes) images[key] = new Uint8Array(bytes);
  }
  const uploaded = new Set<string>();
  for (const f of figures.filter((f) => f.fileId && f.title)) {
    const key = normalizeFigureKey(f.title);
    if (uploaded.has(key)) continue;
    const bytes = await readUpload(f.fileId!, input.ownerId).catch(() => null);
    if (bytes) { images[key] = new Uint8Array(bytes); uploaded.add(key); }
  }
  // Rasterisasi berurutan: WASM single-thread, hindari lonjakan memori.
  const rasterized = new Set<string>();
  for (const diagram of diagrams) {
    const key = normalizeFigureKey(diagram.title);
    if (!diagram.svg || !key || diagram.status !== "approved" || rasterized.has(key)) continue;
    try {
      images[key] = await svgToPngServer(diagram.svg);
      rasterized.add(key);
    } catch (error) {
      console.warn("[laporan] rasterisasi diagram gagal:", diagram.title, error instanceof Error ? error.message : error);
    }
  }

  const assets: FigureAsset[] = [
    ...diagrams.map((diagram) => ({ ...diagram, caption: diagram.caption || diagram.purpose })),
    ...figures,
    ...imageJobs.filter((job) => job.title).map((job) => ({ title: job.title })),
  ].map((asset) => ({ ...asset, available: Boolean(images[normalizeFigureKey(asset.title)]) }));
  const figureTitles = assets.map((asset) => asset.title);
  const lines = input.draft.replace(/\r/g, "").split("\n");
  if (omitAssets) {
    for (const figure of figurePlaceholders(input.draft)) lines[figure.line] = figure.trailing;
  }
  const sourceDraft = omitAssets ? lines.join("\n") : input.draft;
  const { markdown: draft, insertedTitles } = reconcileFigurePlaceholders(sourceDraft, assets, input.outline);
  const pending = new Map(imageJobs.filter((job) => (job.status === "queued" || job.status === "running") && job.title && !images[normalizeFigureKey(job.title)])
    .map((job) => [normalizeFigureKey(job.title), job.title]));
  const missing = new Map(figurePlaceholders(draft, figureTitles)
    .filter((figure) => !images[figure.key] && !pending.has(figure.key))
    .map((figure) => [figure.key, figure.title]));
  // Also report failed/unreadable planned assets even when their marker was lost.
  for (const asset of assets) {
    const key = normalizeFigureKey(asset.title);
    if (key && !images[key] && !pending.has(key)) missing.set(key, asset.title);
  }
  const missingImageTitles = [...missing.values()];
  const pendingFigureTitles = [...pending.values()];
  const missingImages = missingImageTitles.length;
  const pendingFigures = pendingFigureTitles.length;
  if (insertedTitles.length) console.info("[laporan] penanda gambar dipulihkan saat ekspor:", insertedTitles);
  if (missingImages || pendingFigures) console.warn("[laporan] gambar belum disertakan:", { missingImageTitles, pendingFigureTitles });

  const subtitle = input.brief.documentType ? `${input.brief.documentType}${input.brief.course ? ` ${input.brief.course}` : ""}` : undefined;
  // Preset dari jenis dokumen, lalu ditimpa ketentuan format kampus yang ditulis user.
  const preset = DOCX_PRESETS[input.preset ?? (scoped ? "ringkas" : presetForDocumentType(input.brief.documentType))].profile;
  const rules = parseFormatRules(input.brief.formatRules);
  const doc = buildDocxDocument(draft, {
    profile: {
      ...preset,
      ...rules,
      margin: { ...preset.margin, ...rules.margin },
      ...(scoped ? { includeToc: false } : {}),
      cover: scoped ? null : {
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
    figureTitles,
    outputMode: intent.outputMode,
    numberChapters: !scoped,
  });
  const buffer = await Packer.toBuffer(doc);
  const name = docxFileName(input.title);
  const saved = await saveUpload({ ownerId: input.ownerId, buffer, originalName: name, mime: DOCX_MIME });
  return { url: `/api/files/${saved.id}`, name, size: buffer.length, pendingFigures, missingImages, missingImageTitles, pendingFigureTitles };
}

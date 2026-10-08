/**
 * src/lib/server/image-jobs.ts
 * -----------------------------------------------------------------------------
 * Job background untuk generate gambar AI.
 *
 * gpt-image-2 via z0ne butuh ~1.5-2.5 menit per gambar — jauh di atas batas
 * idle LiteSpeed (~120 s). Karena itu request HTTP hanya MEMBUAT job dan
 * langsung kembali; eksekusi dilakukan:
 *   1. in-process lewat `kickImageJobs()` (fire-and-forget setelah job dibuat),
 *   2. ulang dari cron tick (`tickImageJobs`) bila proses Passenger restart
 *      di tengah jalan (job `running` yang stale → diulang).
 *
 * Hasil PNG disimpan via saveUpload → FileUpload, dirujuk `fileUploadId`.
 * -----------------------------------------------------------------------------
 */

import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { generateImage } from "@/lib/ai/client";
import { saveUpload } from "@/lib/storage/upload";

export type ImageJobStatus = "queued" | "running" | "done" | "failed";

export interface ImageJobView {
  id: string;
  status: ImageJobStatus;
  title: string;
  prompt: string;
  sessionId: string | null;
  fileId: string | null;
  /** URL untuk <img src>; hanya ada saat status done. */
  url: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const MAX_ATTEMPTS = 2;
/** Job running tanpa update lebih lama dari ini dianggap mati (proses restart). */
export const IMAGE_STALE_MS = 6 * 60 * 1000;
const IMAGE_TIMEOUT_MS = Number(process.env.AI_IMAGE_TIMEOUT_MS || 240_000);
/** Maks job per user yang masih antre/berjalan. */
const MAX_ACTIVE_PER_USER = 3;

const running = new Set<string>();

type Row = {
  id: string;
  status: string;
  title: string;
  prompt: string;
  sessionId: string | null;
  fileUploadId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toView(row: Row): ImageJobView {
  return {
    id: row.id,
    status: row.status as ImageJobStatus,
    title: row.title,
    prompt: row.prompt,
    sessionId: row.sessionId,
    fileId: row.fileUploadId,
    url: row.status === "done" && row.fileUploadId ? `/api/files/${row.fileUploadId}` : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getImageJob(id: string, ownerId: string): Promise<ImageJobView | null> {
  const row = await prisma.imageJob.findFirst({ where: { id, ownerId } });
  return row ? toView(row) : null;
}

export async function listImageJobs(ownerId: string, opts: { sessionId?: string; limit?: number } = {}): Promise<ImageJobView[]> {
  const rows = await prisma.imageJob.findMany({
    where: { ownerId, ...(opts.sessionId ? { sessionId: opts.sessionId } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, opts.limit ?? 20),
  });
  return rows.map(toView);
}

/**
 * Buat job baru dan langsung jalankan di background. Melempar Error bila
 * user masih punya terlalu banyak job aktif.
 */
export async function startImageJob(input: { ownerId: string; prompt: string; title?: string; sessionId?: string }): Promise<ImageJobView> {
  const active = await prisma.imageJob.count({ where: { ownerId: input.ownerId, status: { in: ["queued", "running"] } } });
  if (active >= MAX_ACTIVE_PER_USER) {
    throw new Error(`Masih ada ${active} gambar yang sedang diproses. Tunggu selesai dulu.`);
  }
  const row = await prisma.imageJob.create({
    data: {
      id: `img_${crypto.randomUUID()}`,
      ownerId: input.ownerId,
      sessionId: input.sessionId ?? null,
      title: (input.title ?? "").slice(0, 160),
      prompt: input.prompt.slice(0, 4000),
      status: "queued",
    },
  });
  kickImageJobs();
  return toView(row);
}

/** Jalankan job yang antre di proses ini tanpa menunggu (fire-and-forget). */
export function kickImageJobs() {
  setImmediate(() => {
    void tickImageJobs(1).catch((err) => console.error("[image-jobs] kick failed:", err));
  });
}

/**
 * Ambil maks `limit` job (queued atau running-stale) dan eksekusi sampai
 * selesai. Aman dipanggil dari cron maupun in-process.
 */
export async function tickImageJobs(limit = 1): Promise<{ processed: string[] }> {
  const staleBefore = new Date(Date.now() - IMAGE_STALE_MS);
  const candidates = await prisma.imageJob.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "running", updatedAt: { lt: staleBefore } },
      ],
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: limit * 2,
  });

  const processed: string[] = [];
  for (const job of candidates) {
    if (processed.length >= limit) break;
    if (running.has(job.id)) continue;
    running.add(job.id);
    try {
      await runImageJob(job.id);
      processed.push(job.id);
    } finally {
      running.delete(job.id);
    }
  }
  return { processed };
}

async function runImageJob(id: string) {
  // Klaim atomik: hanya satu proses yang berhasil mengubah ke running.
  const staleBefore = new Date(Date.now() - IMAGE_STALE_MS);
  const claimed = await prisma.imageJob.updateMany({
    where: { id, OR: [{ status: "queued" }, { status: "running", updatedAt: { lt: staleBefore } }] },
    data: { status: "running", startedAt: new Date(), error: null, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return;

  const job = await prisma.imageJob.findUnique({ where: { id } });
  if (!job) return;

  try {
    const image = await generateImage(job.prompt, { timeoutMs: IMAGE_TIMEOUT_MS });
    const safeName = (job.title || "gambar").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "gambar";
    const upload = await saveUpload({
      ownerId: job.ownerId,
      buffer: image.png,
      originalName: `${safeName}.png`,
      mime: "image/png",
    });
    await prisma.imageJob.update({
      where: { id },
      data: { status: "done", fileUploadId: upload.id, finishedAt: new Date(), error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 400) : "Generate gambar gagal.";
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await prisma.imageJob.update({
      where: { id },
      data: { status: exhausted ? "failed" : "queued", error: message, finishedAt: exhausted ? new Date() : null },
    });
    console.error(`[image-jobs] ${id} attempt ${job.attempts} failed:`, message);
  }
}

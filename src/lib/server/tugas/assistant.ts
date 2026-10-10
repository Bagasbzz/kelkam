/**
 * Asisten Dosen AI Tugas — driver untuk engine agent run tahan lama.
 * -----------------------------------------------------------------------------
 * - Riwayat dipangkas (N pesan terakhir) + ringkasan sesi + "memory" rubric
 *   dari jawaban admin → hemat token tanpa kehilangan konteks.
 * - Loop tool dijalankan oleh `agent-runs/engine` (resumable, tanpa batas 120 s).
 * - askUser menghentikan run (status waiting_user) dan pertanyaan ke UI.
 * -----------------------------------------------------------------------------
 */

import type OpenAI from "openai";
import { prisma } from "@/lib/db/prisma";
import { aiClient, AI_MODEL, AI_MODEL_FAST, stripThinking } from "@/lib/ai/client";
import { TOOL_DEFS, TOOL_IMPL, type ToolContext } from "@/lib/server/tugas/assistant-tools";
import { readUpload } from "@/lib/storage/upload";
import {
  appendUserMessage, controlAgentRun, createAgentRun, findActiveAgentRun, isContinueKeyword,
  type AgentDriver, type AgentRunPublic, type AgentToolContext,
} from "@/lib/server/agent-runs/engine";

const MAX_STEPS = 80;
const HISTORY_LIMIT = 12;
const RUN_KIND = "tugas" as const;
/** Gambar lampiran dikirim inline ke model vision; di atas ini ditolak agar konteks tidak membengkak. */
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface AssistantTurnInput {
  courseId: string;
  adminId: string;
  sessionId?: string | null;
  message: string;
  /** Jawaban admin untuk pertanyaan askUser sebelumnya (opsional). */
  answerTo?: string | null;
  deep?: boolean;
  /** Lampiran admin (fileId dari /api/files/upload). */
  attachments?: Array<{ fileId: string; name?: string }>;
}

/** Lampiran yang sudah diverifikasi milik admin; disimpan di meta run. */
export interface UserAttachmentMeta {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  isImage: boolean;
}

export interface AssistantAttachment {
  fileId: string;
  name: string;
  url: string;
  size: number;
}

function systemPrompt(courseName: string, memory: Record<string, unknown> | null, summary: string | null, userFiles: UserAttachmentMeta[] = []) {
  const memBlock = memory && Object.keys(memory).length
    ? `\n\nKONTEKS/RUBRIK DARI ADMIN (wajib dipatuhi):\n${JSON.stringify(memory, null, 1).slice(0, 3000)}`
    : "";
  const sumBlock = summary ? `\n\nRINGKASAN PERCAKAPAN SEBELUMNYA:\n${summary.slice(0, 2000)}` : "";
  const fileBlock = userFiles.length
    ? `\n\nLAMPIRAN DARI ADMIN (patokan/contoh/materi tambahan — prioritaskan ini):\n${userFiles.map((f) => `- ${f.name} (${f.isImage ? "gambar, sudah terlihat di pesan" : `dokumen, baca dengan getAttachmentContent fileId=${f.fileId}`})`).join("\n")}`
    : "";
  return `Anda adalah Asisten Dosen AI untuk course "${courseName}" di keluhkampus. Pengguna adalah admin/asdos course ini. Waktu sekarang: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "full", timeStyle: "short" })} WIB.

Anda punya akses PENUH ke seluruh konteks course lewat tools: deskripsi course & tugas (getCourseContext, getTugasDetail), materi pertemuan termasuk isi PPTX/PDF (getMaterials, getMaterialContent), lampiran yang dikirim admin di chat (getAttachmentContent), semua mahasiswa & akun (listStudents), semua pengumpulan beserta waktu, keterlambatan, catatan mahasiswa dan feedback dosen (listSubmissions, getStudentHistory, analyzeLateness, listMissing), isi file pengumpulan termasuk ZIP & kode (getSubmissionContent, readSubmissionFile), analisis kemiripan & indikasi AI (compareSimilarity, detectAI), penilaian (setFeedback, rekapNilai), dan ekspor ke Word yang bisa diunduh admin (exportSubmissionDocx, exportReportDocx).

ATURAN:
1. Selalu ambil data lewat tools — jangan mengarang. Di awal percakapan atau saat belum tahu ID, panggil getCourseContext (1 panggilan = semua tugas + deskripsi + materi).
2. Sebelum menilai kesesuaian pengumpulan, BACA deskripsi tugas (getTugasDetail) dan, bila relevan, materi pertemuan terkait. Nilai berdasarkan instruksi tugas tersebut.
3. Untuk tugas kode dalam ZIP: lihat pohon file dari getSubmissionContent, lalu baca file penting secara utuh dengan readSubmissionFile (mis. main.py). Periksa kesesuaian dengan instruksi, kelengkapan, dan kualitas.
4. Hemat token: baca secukupnya, jangan ulangi isi file panjang ke jawaban. Boleh memanggil beberapa tool sekaligus dalam satu langkah bila independen.
5. Saat mengoreksi: ikuti rubrik dari admin. Jika rubrik/bobot belum jelas dan mempengaruhi nilai, panggil askUser SEKALI dengan pertanyaan yang digabung, lalu berhenti. Jika admin hanya minta analisis (bukan nilai), jangan bertanya — langsung analisis.
6. Sebelum setFeedback untuk banyak mahasiswa sekaligus, pastikan admin sudah memberi perintah eksplisit (mis. "nilai semua"). Untuk 1-3 mahasiswa, langsung lakukan sesuai perintah.
7. Nilai 0-100 bulat. Huruf otomatis: A>=85, B>=75, C>=65, D>=55, E<55. Feedback singkat, spesifik, sopan, Bahasa Indonesia, ditujukan ke mahasiswa.
8. Keterlambatan: gunakan kolom terlambatMenit/keterlambatan dari tools (zona Asia/Jakarta); sebutkan durasi konkret.
9. Indikasi AI dan kemiripan adalah INDIKASI, bukan bukti. Sampaikan hati-hati dan sarankan konfirmasi.
10. Bila admin minta file Word/dokumen yang bisa diunduh: pakai exportSubmissionDocx (isi pengumpulan/kode) atau exportReportDocx (hasil analisis Anda). Tautan unduh tampil otomatis; cukup sebutkan nama filenya.
11. Jawaban akhir: ringkas, terstruktur (markdown: heading kecil, bullet, tabel), Bahasa Indonesia, tanpa basa-basi. Sebutkan ID submission hanya jika admin membutuhkannya.
12. MODE KERJA PANJANG: Anda berjalan sebagai proses tahan lama — boleh memanggil tool berkali-kali sampai pekerjaan benar-benar tuntas (mis. membaca SEMUA pengumpulan satu per satu). Jangan berhenti di tengah untuk "melaporkan progres"; progres sudah tampil otomatis ke admin. Jika admin mengetik "lanjut", teruskan dari langkah terakhir tanpa mengulang tool yang hasilnya sudah ada di konteks.
13. SAAT MEMERIKSA BANYAK MAHASISWA: kerjakan satu mahasiswa sampai tuntas (baca file → nilai/analisis) sebelum pindah ke berikutnya. Setiap kali satu mahasiswa selesai, tulis catatan 1-2 kalimat hasilnya di pesan assistant (bersamaan dengan tool call berikutnya) agar hasil tidak hilang saat hasil tool lama dipangkas. Setelah semua selesai, SEGERA tulis jawaban akhir berupa tabel rekap — jangan terus memanggil tool.
14. Jawaban akhir tidak boleh kosong. Jika Anda sudah berhenti memanggil tool, Anda WAJIB menulis kesimpulan dari data yang ada.${fileBlock}${memBlock}${sumBlock}`;
}

/** Verifikasi kepemilikan lampiran; hasilnya disimpan di meta run. */
async function resolveAttachments(adminId: string, input: Array<{ fileId: string; name?: string }>): Promise<UserAttachmentMeta[]> {
  if (!input.length) return [];
  const ids = Array.from(new Set(input.map((a) => a.fileId))).slice(0, 5);
  const rows = await prisma.fileUpload.findMany({ where: { id: { in: ids }, ownerId: adminId }, select: { id: true, originalName: true, mime: true, size: true } });
  return rows.map((r) => ({ fileId: r.id, name: r.originalName, mime: r.mime, size: r.size, isImage: IMAGE_MIME.test(r.mime) }));
}

/** Pesan user terakhir: teks + gambar inline (base64) supaya model vision bisa melihatnya. */
async function buildUserMessage(adminId: string, text: string, files: UserAttachmentMeta[]): Promise<Msg> {
  const images = files.filter((f) => f.isImage && f.size <= MAX_INLINE_IMAGE_BYTES);
  const docs = files.filter((f) => !f.isImage);
  const note = files.length
    ? `\n\n[Lampiran: ${files.map((f) => f.name).join(", ")}${docs.length ? " — dokumen bisa dibaca dengan getAttachmentContent" : ""}]`
    : "";
  if (!images.length) return { role: "user", content: `${text}${note}` };
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: "text", text: `${text}${note}` }];
  for (const img of images) {
    const buf = await readUpload(img.fileId, adminId);
    if (!buf) continue;
    parts.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${buf.toString("base64")}`, detail: "auto" } });
  }
  return { role: "user", content: parts };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("AI timeout")), ms); });
  try { return await Promise.race([p, timeout]); } finally { if (t) clearTimeout(t); }
}

/** Ringkas riwayat lama menjadi 1 paragraf (pakai model cepat). */
async function summarizeOld(messages: { role: string; content: string }[], prev: string | null): Promise<string> {
  const text = messages.map((m) => `${m.role}: ${m.content.slice(0, 600)}`).join("\n");
  try {
    const r = await withTimeout(
      aiClient.chat.completions.create({
        model: AI_MODEL_FAST,
        messages: [
          { role: "system", content: "Ringkas percakapan admin dan asisten berikut dalam ≤120 kata, fokus pada keputusan, rubrik, dan tugas yang sudah dinilai. Bahasa Indonesia." },
          { role: "user", content: `${prev ? `Ringkasan sebelumnya:\n${prev}\n\n` : ""}Percakapan:\n${text}` },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }, { timeout: 15_000 }),
      16_000,
    );
    return stripThinking(r.choices[0]?.message?.content) || prev || "";
  } catch {
    return prev || "";
  }
}

export interface StartRunResult { runId: string; sessionId: string; resumed: boolean }

/**
 * Buat (atau lanjutkan) run agent untuk pesan admin. Pesan user disimpan ke
 * riwayat; loop tool dijalankan engine. Return id run untuk di-stream route.
 */
export async function startTugasAssistantRun(input: AssistantTurnInput): Promise<StartRunResult> {
  const course = await prisma.course.findUnique({ where: { id: input.courseId }, select: { name: true } });
  if (!course) throw new Error("Course tidak ditemukan.");

  // Sesi
  let session = input.sessionId
    ? await prisma.adminChatSession.findFirst({ where: { id: input.sessionId, courseId: input.courseId, userId: input.adminId } })
    : null;
  if (!session) {
    session = await prisma.adminChatSession.create({
      data: { courseId: input.courseId, userId: input.adminId, title: input.message.slice(0, 80) },
    });
  }

  const files = await resolveAttachments(input.adminId, input.attachments ?? []);
  const storedMessage = files.length ? `${input.message}\n\n[Lampiran: ${files.map((f) => f.name).join(", ")}]` : input.message;

  // Lanjutkan run yang dijeda/antre (mis. user ketik "lanjut" setelah sinyal putus).
  const active = await findActiveAgentRun(input.adminId, RUN_KIND, session.id);
  if (active) {
    if (active.status === "running") return { runId: active.id, sessionId: session.id, resumed: true };
    if (active.status === "paused") await controlAgentRun(active.id, input.adminId, "resume");
    if (!isContinueKeyword(input.message) || files.length) {
      await appendUserMessage(active.id, input.adminId, storedMessage);
      await prisma.adminChatMessage.create({ data: { sessionId: session.id, role: "user", content: storedMessage } });
    }
    return { runId: active.id, sessionId: session.id, resumed: true };
  }

  const memory = (session.memory as Record<string, unknown> | null) ?? {};

  // Jika ini jawaban atas askUser → simpan ke memory sebagai rubric.
  if (input.answerTo) {
    const key = `jawaban_${Object.keys(memory).filter((k) => k.startsWith("jawaban_")).length + 1}`;
    memory[key] = { pertanyaan: input.answerTo.slice(0, 400), jawaban: input.message.slice(0, 1200) };
  }
  // Lampiran diingat di sesi agar run berikutnya masih bisa membacanya.
  const prevFiles = Array.isArray(memory.lampiran) ? (memory.lampiran as UserAttachmentMeta[]) : [];
  const sessionFiles = [...prevFiles.filter((p) => !files.some((f) => f.fileId === p.fileId)), ...files].slice(-10);
  if (sessionFiles.length) memory.lampiran = sessionFiles;

  // Simpan pesan user
  await prisma.adminChatMessage.create({ data: { sessionId: session.id, role: "user", content: storedMessage } });

  // Riwayat: ambil terbaru, pangkas, ringkas yang lama kalau perlu.
  const all = await prisma.adminChatMessage.findMany({
    where: { sessionId: session.id, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true },
  });
  let summary = session.summary;
  let recent = all;
  if (all.length > HISTORY_LIMIT) {
    const old = all.slice(0, all.length - HISTORY_LIMIT);
    recent = all.slice(-HISTORY_LIMIT);
    summary = await summarizeOld(old, summary);
  }

  const messages: Msg[] = recent.map((m): Msg => ({ role: m.role as "user" | "assistant", content: m.content }));
  // Pesan terakhir diganti versi dengan gambar inline (bila ada).
  if (messages.length) messages[messages.length - 1] = await buildUserMessage(input.adminId, input.message, files);
  if (input.answerTo) {
    messages.splice(messages.length - 1, 0, {
      role: "assistant",
      content: `(Saya sebelumnya bertanya: ${input.answerTo.slice(0, 400)})`,
    });
  }

  // Simpan memory/summary sekarang agar system prompt tiap langkah memakai versi terbaru.
  await prisma.adminChatSession.update({
    where: { id: session.id },
    data: { memory: memory as object, summary: summary ?? undefined },
  });

  const run = await createAgentRun({
    ownerId: input.adminId,
    kind: RUN_KIND,
    sessionId: session.id,
    // Lampiran gambar butuh model yang mendukung vision; model cepat tidak bisa membaca gambar.
    model: input.deep || files.some((f) => f.isImage) ? AI_MODEL : AI_MODEL_FAST,
    messages,
    maxSteps: MAX_STEPS,
    meta: { courseId: input.courseId, courseName: course.name, userFiles: sessionFiles },
  });
  return { runId: run.id, sessionId: session.id, resumed: false };
}

/** Kalimat progres manusiawi per tool. */
function describeToolCall(name: string, args: Record<string, unknown>): string | null {
  const s = (v: unknown, n = 60) => (typeof v === "string" ? v.slice(0, n) : "");
  switch (name) {
    case "getCourseOverview":
    case "getCourseContext": return "Membaca konteks course: tugas, deskripsi, materi…";
    case "listTugas": return "Mengambil daftar tugas…";
    case "getTugasDetail": return "Membaca deskripsi & instruksi tugas…";
    case "listSubmissions": return "Mengambil daftar pengumpulan…";
    case "listMissing": return "Mencari mahasiswa yang belum mengumpulkan…";
    case "analyzeLateness": return "Menganalisis keterlambatan pengumpulan…";
    case "listStudents": return "Mengambil daftar mahasiswa…";
    case "getStudentHistory": return "Membaca riwayat mahasiswa…";
    case "getSubmissionContent": return "Membuka isi pengumpulan (file/ZIP)…";
    case "readSubmissionFile": return `Membaca file ${s(args.path ?? args.file ?? args.fileName) || "pengumpulan"}…`;
    case "setFeedback": return "Menyimpan nilai & feedback…";
    case "rekapNilai": return "Merekap nilai…";
    case "compareSimilarity": return "Membandingkan kemiripan antar pengumpulan…";
    case "detectAI": return "Memeriksa indikasi teks buatan AI…";
    case "getMaterials": return "Mengambil daftar materi pertemuan…";
    case "getMaterialContent": return "Membaca isi materi (PPTX/PDF)…";
    case "getAttachmentContent": return "Membaca lampiran dari admin…";
    case "exportSubmissionDocx":
    case "exportReportDocx": return "Menyusun dokumen Word…";
    case "askUser": return "Menyiapkan pertanyaan untuk admin…";
    default: return null;
  }
}

export const tugasAgentDriver: AgentDriver = {
  kind: RUN_KIND,
  tools: TOOL_DEFS,
  askUserTool: "askUser",
  temperature: 0.2,
  maxTokens: 1600,
  describeToolCall,
  async systemPrompt(run) {
    const session = await prisma.adminChatSession.findFirst({ where: { id: run.sessionId, userId: run.ownerId }, select: { memory: true, summary: true } });
    const courseName = String(run.meta.courseName ?? "");
    const userFiles = Array.isArray(run.meta.userFiles) ? (run.meta.userFiles as UserAttachmentMeta[]) : [];
    return systemPrompt(courseName, (session?.memory as Record<string, unknown> | null) ?? null, session?.summary ?? null, userFiles);
  },
  async runTool(name, args, ctx: AgentToolContext) {
    const impl = TOOL_IMPL[name];
    if (!impl) return { error: `Tool ${name} tidak dikenal.` };
    const userFiles = Array.isArray(ctx.run.meta.userFiles) ? (ctx.run.meta.userFiles as UserAttachmentMeta[]) : [];
    const toolCtx: ToolContext = { courseId: String(ctx.run.meta.courseId), adminId: ctx.run.ownerId, attachments: ctx.attachments, userFileIds: userFiles.map((f) => f.fileId) };
    return impl(toolCtx, args as never);
  },
  async onFinish(run: AgentRunPublic) {
    if (run.status === "cancelled" && !run.reply) return;
    const content = run.pendingQuestion
      ? `[Pertanyaan ke admin] ${run.pendingQuestion.question}`
      : run.reply || (run.status === "failed" ? `Maaf, proses gagal: ${run.error || "kesalahan tak dikenal"}. Ketik "lanjut" untuk mencoba meneruskan.` : "");
    if (!content) return;
    const tools = run.toolsUsed.map((name) => ({ name }));
    await prisma.adminChatMessage.create({
      data: {
        sessionId: run.sessionId,
        role: "assistant",
        content,
        toolCalls: tools.length || run.attachments.length ? ({ calls: tools, attachments: run.attachments, runId: run.id } as unknown as object) : undefined,
      },
    });
  },
};

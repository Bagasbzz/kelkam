/**
 * Agent loop Admin AI Tugas (tool-calling).
 * -----------------------------------------------------------------------------
 * - Riwayat dipangkas (N pesan terakhir) + ringkasan sesi + "memory" rubric
 *   dari jawaban admin → hemat token tanpa kehilangan konteks.
 * - Loop maksimal MAX_STEPS panggilan tool per giliran.
 * - askUser menghentikan loop dan mengembalikan pertanyaan ke UI.
 * -----------------------------------------------------------------------------
 */

import type OpenAI from "openai";
import { prisma } from "@/lib/db/prisma";
import { aiClient, AI_MODEL, AI_MODEL_FAST, stripThinking } from "@/lib/ai/client";
import { TOOL_DEFS, TOOL_IMPL, type ToolContext } from "@/lib/server/tugas/assistant-tools";

const MAX_STEPS = 14;
const HISTORY_LIMIT = 12;
const TOOL_RESULT_MAX_CHARS = 16_000;
const STEP_TIMEOUT_MS = 40_000;
// Total anggaran satu giliran; harus < maxDuration route (120 s) + timeout client.
const TURN_BUDGET_MS = 105_000;
// Sisa waktu minimum untuk memaksa jawaban akhir (tanpa tool) sebelum budget habis.
const FINAL_ANSWER_RESERVE_MS = 20_000;

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface AssistantTurnInput {
  courseId: string;
  adminId: string;
  sessionId?: string | null;
  message: string;
  /** Jawaban admin untuk pertanyaan askUser sebelumnya (opsional). */
  answerTo?: string | null;
  deep?: boolean;
}

export interface AssistantAttachment {
  fileId: string;
  name: string;
  url: string;
  size: number;
}

export interface AssistantTurnResult {
  sessionId: string;
  reply: string;
  pendingQuestion: { question: string; options?: string[] } | null;
  toolsUsed: string[];
  attachments: AssistantAttachment[];
  model: string;
}

function systemPrompt(courseName: string, memory: Record<string, unknown> | null, summary: string | null) {
  const memBlock = memory && Object.keys(memory).length
    ? `\n\nKONTEKS/RUBRIK DARI ADMIN (wajib dipatuhi):\n${JSON.stringify(memory, null, 1).slice(0, 3000)}`
    : "";
  const sumBlock = summary ? `\n\nRINGKASAN PERCAKAPAN SEBELUMNYA:\n${summary.slice(0, 2000)}` : "";
  return `Anda adalah Asisten Dosen AI untuk course "${courseName}" di keluhkampus. Pengguna adalah admin/asdos course ini. Waktu sekarang: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "full", timeStyle: "short" })} WIB.

Anda punya akses PENUH ke seluruh konteks course lewat tools: deskripsi course & tugas (getCourseContext, getTugasDetail), materi pertemuan termasuk isi PPTX/PDF (getMaterials, getMaterialContent), semua mahasiswa & akun (listStudents), semua pengumpulan beserta waktu, keterlambatan, catatan mahasiswa dan feedback dosen (listSubmissions, getStudentHistory, analyzeLateness, listMissing), isi file pengumpulan termasuk ZIP & kode (getSubmissionContent, readSubmissionFile), analisis kemiripan & indikasi AI (compareSimilarity, detectAI), penilaian (setFeedback, rekapNilai), dan ekspor ke Word yang bisa diunduh admin (exportSubmissionDocx, exportReportDocx).

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
11. Jawaban akhir: ringkas, terstruktur (markdown: heading kecil, bullet, tabel), Bahasa Indonesia, tanpa basa-basi. Sebutkan ID submission hanya jika admin membutuhkannya. Jika pekerjaan belum selesai karena batas langkah, laporkan apa yang SUDAH ditemukan dan apa yang tersisa — jangan menjawab kosong.${memBlock}${sumBlock}`;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("AI timeout")), ms); });
  try { return await Promise.race([p, timeout]); } finally { if (t) clearTimeout(t); }
}

function clipToolResult(obj: unknown): string {
  const s = JSON.stringify(obj);
  return s.length > TOOL_RESULT_MAX_CHARS ? `${s.slice(0, TOOL_RESULT_MAX_CHARS)}…[dipotong]` : s;
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

export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
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

  const memory = (session.memory as Record<string, unknown> | null) ?? {};

  // Jika ini jawaban atas askUser → simpan ke memory sebagai rubric.
  if (input.answerTo) {
    const key = `jawaban_${Object.keys(memory).filter((k) => k.startsWith("jawaban_")).length + 1}`;
    memory[key] = { pertanyaan: input.answerTo.slice(0, 400), jawaban: input.message.slice(0, 1200) };
  }

  // Simpan pesan user
  await prisma.adminChatMessage.create({ data: { sessionId: session.id, role: "user", content: input.message } });

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

  const messages: Msg[] = [
    { role: "system", content: systemPrompt(course.name, memory, summary) },
    ...recent.map((m): Msg => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
  if (input.answerTo) {
    messages.splice(messages.length - 1, 0, {
      role: "assistant",
      content: `(Saya sebelumnya bertanya: ${input.answerTo.slice(0, 400)})`,
    });
  }

  const attachments: AssistantAttachment[] = [];
  const ctx: ToolContext = { courseId: input.courseId, adminId: input.adminId, attachments };
  const model = input.deep ? AI_MODEL : AI_MODEL_FAST;
  const toolsUsed: string[] = [];
  const toolLog: Array<{ name: string; args: unknown }> = [];
  let pendingQuestion: AssistantTurnResult["pendingQuestion"] = null;
  let reply = "";
  const startedAt = Date.now();

  /** Paksa model menulis jawaban akhir dari data yang sudah terkumpul (tanpa tool). */
  const forceFinalAnswer = async (reason: string) => {
    const remaining = TURN_BUDGET_MS - (Date.now() - startedAt);
    const t = Math.max(Math.min(STEP_TIMEOUT_MS, remaining - 2_000), 8_000);
    try {
      const r = await withTimeout(
        aiClient.chat.completions.create({
          model,
          messages: [...messages, { role: "user", content: `[SISTEM] ${reason} Tulis jawaban akhir SEKARANG berdasarkan data yang sudah terkumpul: apa yang sudah ditemukan/dikerjakan, temuan utama, dan apa yang belum sempat (jika ada). Jangan memanggil tool.` }],
          temperature: 0.2,
          max_tokens: 1600,
        }, { timeout: t }),
        t + 2000,
      );
      return stripThinking(r.choices[0]?.message?.content);
    } catch {
      return "";
    }
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const remaining = TURN_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < FINAL_ANSWER_RESERVE_MS) {
      reply = await forceFinalAnswer("Batas waktu giliran hampir habis.");
      break;
    }
    const isLastStep = step === MAX_STEPS - 1;
    const stepTimeout = Math.min(STEP_TIMEOUT_MS, remaining - 3_000);
    const completion = await withTimeout(
      aiClient.chat.completions.create({
        model,
        messages,
        tools: TOOL_DEFS,
        tool_choice: isLastStep ? "none" : "auto",
        temperature: 0.2,
        max_tokens: 1600,
      }, { timeout: stepTimeout }),
      stepTimeout + 2000,
    );

    const choice = completion.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      reply = stripThinking(msg.content);
      break;
    }

    // Tambahkan assistant message dengan tool_calls
    messages.push({ role: "assistant", content: stripThinking(msg.content), tool_calls: calls });

    let stop = false;
    for (const call of calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = {}; }
      toolsUsed.push(name);
      toolLog.push({ name, args });

      if (name === "askUser") {
        pendingQuestion = {
          question: String(args.question ?? "Mohon konteks tambahan."),
          options: Array.isArray(args.options) ? args.options.map(String).slice(0, 6) : undefined,
        };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: true, note: "Pertanyaan diteruskan ke admin." }) });
        stop = true;
        continue;
      }

      const impl = TOOL_IMPL[name];
      let result: unknown;
      if (!impl) {
        result = { error: `Tool ${name} tidak dikenal.` };
      } else {
        try {
          result = await impl(ctx, args as never);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : "Tool gagal." };
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: clipToolResult(result) });
    }

    if (stop) {
      reply = stripThinking(msg.content) || pendingQuestion?.question || "";
      break;
    }
  }

  if (!reply && !pendingQuestion) {
    reply = (await forceFinalAnswer("Batas langkah tool tercapai.")) || `Saya sudah menjalankan ${toolsUsed.length} langkah (${Array.from(new Set(toolsUsed)).join(", ")}) tetapi belum sampai kesimpulan. Persempit permintaan (mis. sebutkan pertemuan atau nama mahasiswa) lalu kirim lagi.`;
  }
  if (attachments.length && !pendingQuestion) {
    reply += `\n\nFile siap diunduh: ${attachments.map((a) => `[${a.name}](${a.url})`).join(", ")}`;
  }

  // Persist assistant reply + memory/summary
  await prisma.$transaction([
    prisma.adminChatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: pendingQuestion ? `[Pertanyaan ke admin] ${pendingQuestion.question}` : reply,
        toolCalls: toolLog.length || attachments.length ? ({ calls: toolLog, attachments } as unknown as object) : undefined,
      },
    }),
    prisma.adminChatSession.update({
      where: { id: session.id },
      data: { memory: memory as object, summary: summary ?? undefined },
    }),
  ]);

  return { sessionId: session.id, reply, pendingQuestion, toolsUsed, attachments, model };
}

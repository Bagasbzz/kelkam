/**
 * GET /api/admin/ai-check
 * -----------------------------------------------------------------------------
 * Diagnostik layanan AI untuk admin: untuk tiap model terkonfigurasi (penulis, cepat, review)
 * kirim satu permintaan streaming kecil lalu laporkan waktu token pertama, total waktu,
 * jumlah karakter isi vs reasoning, dan pesan error provider. Tidak menampilkan kunci API.
 */
import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, AI_MODEL_FAST, AI_MODEL_REVIEW } from "@/lib/ai/client";
import { requireSuperAdmin } from "@/lib/server/auth";
import { runWithAiOwner } from "@/lib/server/ai-budget";
import { publicErrorResponse } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

async function probe(model: string, label = "standar", extra: Record<string, unknown> = {}, maxTokens = 1500) {
  const started = Date.now();
  let firstContent = 0;
  let content = 0;
  let reasoning = 0;
  let finish = "";
  try {
    const stream = await aiClient.chat.completions.create(
      { model, stream: true as const, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user" as const, content: "Tulis dua kalimat tentang manfaat membaca jurnal ilmiah." }], ...extra },
      { timeout: 75_000, maxRetries: 0 },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as { content?: string; reasoning_content?: string; reasoning?: string } | undefined;
      if (delta?.content) { if (!firstContent) firstContent = Date.now() - started; content += delta.content.length; }
      reasoning += (delta?.reasoning_content || delta?.reasoning || "").length;
      if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason;
    }
    return { model, varian: label, ok: content > 0, msFirstText: firstContent || null, msTotal: Date.now() - started, contentChars: content, reasoningChars: reasoning, finish };
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    return { model, varian: label, ok: false, msTotal: Date.now() - started, error: `${typeof status === "number" ? `HTTP ${status}: ` : ""}${error instanceof Error ? error.message.slice(0, 300) : "gagal"}` };
  }
}

export async function GET() {
  try {
    const admin = await requireSuperAdmin();
    const models = Array.from(new Set([AI_MODEL, AI_MODEL_FAST, AI_MODEL_REVIEW]));
    // Varian untuk model penulis: membuktikan apakah "thinking" tersembunyi memakan max_tokens.
    const results = await runWithAiOwner(admin.id, "admin:ai-check", () => Promise.all([
      ...models.map((model) => probe(model)),
      probe(AI_MODEL, "max_tokens 300", {}, 300),
      probe(AI_MODEL, "reasoning_effort low", { reasoning_effort: "low" }),
      probe(AI_MODEL, "reasoning_effort none", { reasoning_effort: "none" }),
      probe(AI_MODEL, "thinking disabled", { thinking: { type: "disabled" } }),
    ]));
    return NextResponse.json({ success: true, roles: { penulis: AI_MODEL, cepat: AI_MODEL_FAST, review: AI_MODEL_REVIEW }, results, checkedAt: new Date().toISOString() });
  } catch (error) {
    return publicErrorResponse(error, "Cek AI gagal.");
  }
}

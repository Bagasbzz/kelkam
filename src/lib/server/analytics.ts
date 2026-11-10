/**
 * src/lib/server/analytics.ts
 * -----------------------------------------------------------------------------
 * Pencatatan data Tahap 3 (keputusan K7: tabel milik sendiri). Prinsip:
 *  - Tidak pernah memblokir atau menggagalkan fitur: semua tulisan dibungkus try/catch,
 *    dan bila tabel belum dibuat (SQL hotfix belum dijalankan) pencatatan dilewati diam-diam.
 *  - Tidak menyimpan IP atau isi prompt. Pengunjung diwakili ID acak per browser.
 */
import { prisma } from "@/lib/db/prisma";

let warned = false;
function swallow(error: unknown) {
  if (warned) return;
  warned = true;
  console.warn("[analytics] pencatatan dilewati:", error instanceof Error ? error.message.slice(0, 200) : error);
}

/** Normalisasi path: tanpa query, ID panjang diganti ":id" agar bisa dijumlah per halaman. */
export function normalizePath(raw: unknown) {
  const value = typeof raw === "string" ? raw : "";
  const path = value.split(/[?#]/)[0].slice(0, 200);
  if (!path.startsWith("/")) return null;
  return path
    .split("/")
    .map((part) => (/^[0-9a-f-]{20,}$/i.test(part) || /^[a-z0-9_-]{20,}$/i.test(part) || /^\d{4,}$/.test(part) ? ":id" : part))
    .join("/") || "/";
}

/** Fitur dari path, mis. /dashboard → laporan. */
export function featureOf(path: string) {
  const first = path.split("/")[1] || "beranda";
  const map: Record<string, string> = { dashboard: "laporan", presentasi: "presentasi", studio: "studio", tugas: "tugas", "uml-builder": "diagram", "data-synthesizer": "olah-data", "template-generator": "editor", "ai-tools": "ai-tools", "fix-format": "rapikan-format", tools: "alat-pdf", tracker: "pantau", fitur: "halaman-fitur", login: "login" };
  return map[first] ?? (first === "beranda" ? "beranda" : first.slice(0, 40));
}

export async function recordPageView(input: { visitorId: string; userId: string | null; path: string }) {
  try {
    await prisma.activityEvent.create({ data: { visitorId: input.visitorId.slice(0, 64), userId: input.userId, kind: "page", path: input.path, feature: featureOf(input.path) } });
  } catch (error) { swallow(error); }
}

const PRESENCE_INTERVAL_MS = 5 * 60_000;
const presenceSeen = new Map<string, number>();

/** "Terakhir aktif" per akun, ditulis maks. sekali per 5 menit per proses. */
export function touchPresence(userId: string) {
  const now = Date.now();
  if ((presenceSeen.get(userId) ?? 0) > now - PRESENCE_INTERVAL_MS) return;
  presenceSeen.set(userId, now);
  if (presenceSeen.size > 5000) presenceSeen.clear();
  void prisma.userPresence.upsert({ where: { userId }, create: { userId, lastSeenAt: new Date(now) }, update: { lastSeenAt: new Date(now) } }).catch(swallow);
}

export async function recordLogin(userId: string, method: "password" | "register" | "google" = "password") {
  try {
    await prisma.loginEvent.create({ data: { userId, method } });
  } catch (error) { swallow(error); }
  touchPresence(userId);
}

export interface AiUsageRecord {
  ownerId: string;
  operation: string;
  model: string;
  kind: "chat" | "image";
  inputTokens: number;
  outputTokens: number;
  actual: boolean;
  ok: boolean;
}

export function recordAiUsage(input: AiUsageRecord) {
  const clamp = (value: number) => Math.max(0, Math.min(2_000_000_000, Math.round(Number(value) || 0)));
  void prisma.aiUsage.create({
    data: { ...input, ownerId: input.ownerId.slice(0, 100), operation: input.operation.slice(0, 80), model: input.model.slice(0, 80), inputTokens: clamp(input.inputTokens), outputTokens: clamp(input.outputTokens) },
  }).catch(swallow);
}

/**
 * Baca angka token dari respons provider tanpa mengganggu pemanggil:
 * JSON biasa → usage; SSE streaming → chunk terakhir yang memuat usage, atau perkiraan dari panjang teks.
 */
export async function usageFromResponse(response: Response, estimatedInput: number): Promise<{ input: number; output: number; actual: boolean }> {
  const text = await response.text();
  const type = response.headers.get("content-type") || "";
  if (!type.includes("event-stream")) {
    const usage = (JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    if (usage) return { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0, actual: true };
    return { input: estimatedInput, output: Math.ceil(text.length / 4), actual: false };
  }
  let contentChars = 0;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
    try {
      const chunk = JSON.parse(line.slice(5)) as { usage?: typeof usage; choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> };
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta;
      contentChars += (delta?.content?.length ?? 0) + (delta?.reasoning_content?.length ?? 0);
    } catch { /* potongan SSE tidak lengkap */ }
  }
  if (usage) return { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0, actual: true };
  return { input: estimatedInput, output: Math.ceil(contentChars / 3), actual: false };
}

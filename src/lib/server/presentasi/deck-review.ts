/**
 * src/lib/server/presentasi/deck-review.ts
 * -----------------------------------------------------------------------------
 * Audit AI untuk Presentasi (K20, tahap kedua). Dipanggil saat AI menekan finishDeck:
 * pemeriksaan otomatis + auditor AI terpisah (AI_MODEL_REVIEW) menilai draft terhadap
 * permintaan pengguna dan rencana. Bila ditolak, temuan dikembalikan ke AI penulis
 * (yang memegang konteks penuh) untuk diperbaiki dengan writeSlides, maks. 2 putaran;
 * setelah itu deck tetap diserahkan dengan catatan (K17).
 */
import { aiClient, AI_MODEL_REVIEW, stripThinking } from "@/lib/ai/client";
import { UNTRUSTED_DATA_NOTICE } from "@/lib/ai/guard";
import { inspectSlide, type PresentationSlide } from "@/lib/presentation/model";
import type { PresentationEnvelope } from "./state";

export const MAX_DECK_FIX_ROUNDS = 2;
const REVIEW_TIMEOUT_MS = 60_000;

export interface DeckIssue { slide: number | null; severity: "berat" | "sedang" | "ringan"; problem: string; fix: string }
export interface DeckVerdict { verdict: "lulus" | "perbaiki"; summary: string; issues: DeckIssue[]; aiUnavailable: boolean; tokensUsed: number }

const blocking = (issue: DeckIssue) => issue.severity !== "ringan";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function checkDeckLocally(slides: PresentationSlide[], plan: PresentationEnvelope["plan"]): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const titles = new Map<string, number>();
  slides.forEach((slide, i) => {
    const n = i + 1;
    for (const issue of inspectSlide(slide)) {
      if (issue.code === "missing-source") continue;
      issues.push({ slide: n, severity: issue.code === "empty-body" ? "berat" : "sedang", problem: issue.message, fix: issue.code === "dense-body" ? "Ringkas butir, pindahkan detail ke catatan pembicara." : "Lengkapi atau ringkas sesuai pesan." });
    }
    const key = slide.title.trim().toLowerCase();
    if (titles.has(key)) issues.push({ slide: n, severity: "sedang", problem: `Judul sama dengan slide ${titles.get(key)}.`, fix: "Beri judul yang menyatakan pesan khusus slide ini." });
    else titles.set(key, n);
    if (i >= 2 && slides[i - 1].layout === slide.layout && slides[i - 2].layout === slide.layout) {
      issues.push({ slide: n, severity: "ringan", problem: "Tiga slide berturut-turut memakai layout yang sama.", fix: "Variasikan layout." });
    }
  });
  if (plan?.slides.length && Math.abs(plan.slides.length - slides.length) > 2) {
    issues.push({ slide: null, severity: "sedang", problem: `Jumlah slide ${slides.length}, rencana ${plan.slides.length}.`, fix: "Sesuaikan dengan rencana yang disampaikan ke pengguna atau jelaskan alasannya." });
  }
  return issues;
}

export async function reviewDeck(input: {
  slides: PresentationSlide[];
  state: PresentationEnvelope;
  round: number;
  signal?: AbortSignal;
}): Promise<DeckVerdict> {
  const local = checkDeckLocally(input.slides, input.state.plan);
  const fallback = (aiUnavailable: boolean, summary: string): DeckVerdict => ({ verdict: local.some(blocking) ? "perbaiki" : "lulus", summary, issues: local, aiUnavailable, tokensUsed: 0 });
  const userMessages = (input.state.chat?.messages ?? []).filter((message) => message.role === "user").slice(-8).map((message) => message.content.slice(0, 600));
  const plan = input.state.plan;
  const payload = {
    permintaanPengguna: userMessages,
    rencana: plan ? { tujuan: plan.goal, audiens: plan.audience, menit: plan.minutes, kepadatan: plan.density, slide: plan.slides.map((slide) => `${slide.role}: ${slide.title} (${slide.point})`) } : null,
    pemeriksaanOtomatis: local.map((issue) => `${issue.slide ? `Slide ${issue.slide}` : "Umum"}: ${issue.problem}`),
    slide: input.slides.map((slide, i) => ({ nomor: i + 1, layout: slide.layout, eyebrow: slide.eyebrow, judul: slide.title, isi: slide.body, catatan: slide.notes.slice(0, 400) })),
  };
  const system = `Anda AUDITOR AKHIR presentasi kuliah berbahasa Indonesia, bukan penulisnya. Periksa deck UTUH sebelum diserahkan:
1. Sesuai permintaan pengguna dan rencana (tujuan, audiens, durasi, kepadatan teks).
2. Alur cerita runtut: pembuka, konteks, inti, bukti, penutup; satu gagasan per slide; tidak ada slide yang mengulang.
3. Teks layar singkat dan jelas, judul menyatakan pesan; detail panjang ada di catatan pembicara.
4. Tidak ada klaim, angka, atau nama yang tampak dikarang; tidak ada em dash atau en dash.
5. Bahasa Indonesia baku, konsisten istilah.
Tingkat: "berat" (melanggar permintaan, salah isi, alur rusak), "sedang" (slide terlalu padat, tidak jelas, berulang), "ringan" (gaya kecil).
Vonis "lulus" hanya bila tidak ada masalah berat atau sedang. Jangan mengada-adakan masalah.${input.round > 1 ? " Ini audit ulang setelah perbaikan; jangan menurunkan standar." : ""}
${UNTRUSTED_DATA_NOTICE}
Keluarkan HANYA JSON: {"vonis":"lulus"|"perbaiki","ringkasan":"1 kalimat","masalah":[{"slide":nomor atau null,"tingkat":"berat|sedang|ringan","masalah":"spesifik","perbaikan":"instruksi langsung"}]} maksimal 10 masalah.`;
  try {
    const response = await aiClient.chat.completions.create(
      { model: AI_MODEL_REVIEW, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }], temperature: 0, max_tokens: 2000 },
      { timeout: REVIEW_TIMEOUT_MS, maxRetries: 0, signal: input.signal },
    );
    const raw = stripThinking(response.choices[0]?.message.content).replace(/```(?:json)?/gi, "");
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    const parsed = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) as unknown : null;
    if (!isRecord(parsed)) throw new Error("Jawaban auditor bukan JSON.");
    const ai: DeckIssue[] = (Array.isArray(parsed.masalah) ? parsed.masalah : []).filter(isRecord).slice(0, 10).map((issue) => {
      const slide = Number(issue.slide);
      const severity = text(issue.tingkat, 10);
      return {
        slide: Number.isInteger(slide) && slide >= 1 && slide <= input.slides.length ? slide : null,
        severity: severity === "berat" || severity === "sedang" ? severity : "ringan",
        problem: text(issue.masalah, 400) || "Masalah tidak dijelaskan.",
        fix: text(issue.perbaikan, 400),
      };
    });
    const issues = [...local, ...ai];
    return { verdict: issues.some(blocking) ? "perbaiki" : "lulus", summary: text(parsed.ringkasan, 300), issues, aiUnavailable: false, tokensUsed: response.usage?.total_tokens ?? 0 };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return fallback(true, "Auditor AI tidak tersedia; hanya pemeriksaan otomatis yang dijalankan.");
  }
}

/** Instruksi untuk AI penulis: slide mana dan apa yang harus diperbaiki. */
export function deckFixMessage(verdict: DeckVerdict, slides: PresentationSlide[], round: number) {
  const lines = verdict.issues.filter(blocking).map((issue) => `- ${issue.slide ? `Slide ${issue.slide} (id ${slides[issue.slide - 1]?.id})` : "Umum"} [${issue.severity}]: ${issue.problem}${issue.fix ? ` Perbaikan: ${issue.fix}` : ""}`);
  return `Auditor AI menolak deck (putaran ${round}/${MAX_DECK_FIX_ROUNDS}). ${verdict.summary}\n${lines.join("\n")}\nPerbaiki slide terkait dengan writeSlides (pakai id slide yang sama untuk mengganti, keepSlideIds tidak perlu), lalu panggil finishDeck lagi. Jangan menulis ulang slide yang tidak bermasalah.`;
}

export function deckAuditNote(verdict: DeckVerdict) {
  if (verdict.verdict === "lulus" && !verdict.aiUnavailable) return "Deck lolos audit AI.";
  const remaining = verdict.issues.filter(blocking).slice(0, 6).map((issue) => `${issue.slide ? `slide ${issue.slide}` : "umum"}: ${issue.problem}`);
  return `Deck diserahkan dengan catatan audit${verdict.aiUnavailable ? " (auditor AI tidak tersedia)" : ""}${remaining.length ? `: ${remaining.join("; ")}` : "."}`;
}

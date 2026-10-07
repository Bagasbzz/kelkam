/**
 * Analisis teks pengumpulan tugas — murni lokal, 0 token AI.
 * -----------------------------------------------------------------------------
 *  - Kemiripan antar-submission: shingling k-gram kata + Jaccard, dan cosine TF.
 *  - Indikasi tulisan AI: heuristik statistik (burstiness, variasi kalimat,
 *    rasio kata unik, frasa khas AI, pola struktur). Hasil = INDIKASI 0-100,
 *    bukan vonis. Harus selalu dilabeli demikian di UI/prompt.
 * -----------------------------------------------------------------------------
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Normalisasi
// ---------------------------------------------------------------------------

export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[(file|dokumen|ekstrak otomatis)[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const n = normalizeForCompare(text);
  return n ? n.split(" ") : [];
}

export function textHash(text: string): string {
  return createHash("sha256").update(normalizeForCompare(text)).digest("hex");
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

export function shingles(tokens: string[], k = 5): Set<string> {
  const out = new Set<string>();
  if (tokens.length < k) {
    if (tokens.length) out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i + k <= tokens.length; i++) {
    out.add(tokens.slice(i, i + k).join(" "));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

export function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  if (!na || !nb) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) dot += v * w;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SimilarityDoc {
  id: string;
  text: string;
}

export interface SimilarityPair {
  aId: string;
  bId: string;
  /** 0-100 gabungan (0.6 jaccard shingles + 0.4 cosine). */
  score: number;
  jaccard: number;
  cosine: number;
  identical: boolean;
}

/**
 * Bandingkan semua pasangan dokumen. O(n²) tapi n = jumlah submission 1 tugas
 * (biasanya < 100), jadi aman.
 */
export function compareAll(docs: SimilarityDoc[], minScore = 30): SimilarityPair[] {
  const prepared = docs.map((d) => {
    const tokens = tokenize(d.text);
    return {
      id: d.id,
      hash: textHash(d.text),
      sh: shingles(tokens, 5),
      tf: termFreq(tokens),
      len: tokens.length,
    };
  });

  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.len < 20 || b.len < 20) continue;
      const identical = a.hash === b.hash;
      const jac = identical ? 1 : jaccard(a.sh, b.sh);
      const cos = identical ? 1 : cosine(a.tf, b.tf);
      const score = Math.round((0.6 * jac + 0.4 * cos) * 100);
      if (score >= minScore || identical) {
        pairs.push({ aId: a.id, bId: b.id, score, jaccard: jac, cosine: cos, identical });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

// ---------------------------------------------------------------------------
// Indikasi tulisan AI (heuristik)
// ---------------------------------------------------------------------------

const AI_PHRASES_ID = [
  "dalam era digital",
  "penting untuk dicatat",
  "perlu dicatat bahwa",
  "secara keseluruhan",
  "sebagai kesimpulan",
  "dapat disimpulkan bahwa",
  "dengan demikian",
  "di sisi lain",
  "selain itu",
  "lebih lanjut",
  "tidak dapat dipungkiri",
  "memainkan peran penting",
  "berbagai aspek",
  "secara signifikan",
  "dalam konteks ini",
  "hal ini menunjukkan bahwa",
  "patut diperhatikan",
  "sangat penting untuk",
  "merupakan salah satu",
  "memberikan wawasan",
];

const AI_PHRASES_EN = [
  "in today's digital",
  "it is important to note",
  "in conclusion",
  "furthermore",
  "moreover",
  "additionally",
  "plays a crucial role",
  "delve into",
  "a testament to",
  "it's worth noting",
  "comprehensive",
  "leverage",
  "robust",
  "seamless",
  "tapestry",
  "landscape",
  "navigate the",
  "in summary",
  "ultimately",
  "pivotal",
];

export interface AiSignals {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLen: number;
  /** Koefisien variasi panjang kalimat (rendah = seragam = sinyal AI). */
  sentenceLenCV: number;
  /** Rasio kata unik (type-token ratio) pada 500 kata pertama. */
  ttr: number;
  /** Frasa khas AI per 1000 kata. */
  aiPhrasePer1k: number;
  /** Proporsi kalimat yang diawali konektor/transisi formal. */
  transitionStartRatio: number;
  /** Proporsi paragraf dengan panjang mirip (sinyal struktur rapi berlebihan). */
  paragraphUniformity: number;
  /** Ada typo/slang/informal khas manusia (menurunkan skor). */
  informalHits: number;
  /** Kode sumber (bukan prosa) — skor tidak bisa diandalkan. */
  looksLikeCode: boolean;
}

export interface AiIndication {
  score: number;
  label: "rendah" | "sedang" | "tinggi" | "tidak-dapat-dinilai";
  signals: AiSignals;
  notes: string[];
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

const INFORMAL = /\b(gw|gue|lu|lo|bgt|banget|gak|ga|nggak|ngga|yg|dgn|utk|krn|sih|dong|deh|kok|aja|udah|udh|tdk|jd|jgn|klo|kalo|gimana|gmn)\b/gi;
const TRANSITION_START =
  /^(selain itu|dengan demikian|oleh karena itu|di sisi lain|lebih lanjut|namun|secara keseluruhan|sebagai kesimpulan|pertama|kedua|ketiga|furthermore|moreover|additionally|however|in conclusion|therefore|overall)\b/i;

export function detectAiIndication(rawText: string): AiIndication {
  const text = rawText.replace(/\[(file|dokumen)[^\]]*\]/gi, " ").trim();
  const codeHits = (text.match(/[{};<>]|=>|\bfunction\b|\bconst\b|\bimport\b|\bpublic\b|\bdef\b|\bclass\b/g) || []).length;
  const words = text.split(/\s+/).filter(Boolean);
  const looksLikeCode = words.length > 0 && codeHits / words.length > 0.08;

  const sentences = text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
  const sentLens = sentences.map((s) => s.split(/\s+/).length);
  const avg = sentLens.length ? sentLens.reduce((a, b) => a + b, 0) / sentLens.length : 0;
  const cv = avg ? stddev(sentLens) / avg : 0;

  const first500 = words.slice(0, 500).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const ttr = first500.length ? new Set(first500).size / first500.length : 0;

  const lower = text.toLowerCase();
  let phraseHits = 0;
  for (const p of [...AI_PHRASES_ID, ...AI_PHRASES_EN]) {
    let idx = lower.indexOf(p);
    while (idx !== -1) {
      phraseHits++;
      idx = lower.indexOf(p, idx + p.length);
    }
  }
  const aiPhrasePer1k = words.length ? (phraseHits / words.length) * 1000 : 0;

  const transitionStarts = sentences.filter((s) => TRANSITION_START.test(s)).length;
  const transitionStartRatio = sentences.length ? transitionStarts / sentences.length : 0;

  const paragraphs = text.split(/\n{2,}/).map((p) => p.split(/\s+/).length).filter((n) => n >= 15);
  const pAvg = paragraphs.length ? paragraphs.reduce((a, b) => a + b, 0) / paragraphs.length : 0;
  const pCV = pAvg ? stddev(paragraphs) / pAvg : 1;
  const paragraphUniformity = paragraphs.length >= 3 ? Math.max(0, 1 - pCV) : 0;

  const informalHits = (text.match(INFORMAL) || []).length;

  const signals: AiSignals = {
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgSentenceLen: Math.round(avg * 10) / 10,
    sentenceLenCV: Math.round(cv * 100) / 100,
    ttr: Math.round(ttr * 100) / 100,
    aiPhrasePer1k: Math.round(aiPhrasePer1k * 10) / 10,
    transitionStartRatio: Math.round(transitionStartRatio * 100) / 100,
    paragraphUniformity: Math.round(paragraphUniformity * 100) / 100,
    informalHits,
    looksLikeCode,
  };

  const notes: string[] = [];
  if (looksLikeCode || words.length < 120 || sentences.length < 5) {
    notes.push(
      looksLikeCode
        ? "Isi dominan kode sumber; indikasi AI tidak dapat dinilai dari gaya prosa."
        : "Teks terlalu pendek untuk dinilai (butuh ≥120 kata & ≥5 kalimat).",
    );
    return { score: 0, label: "tidak-dapat-dinilai", signals, notes };
  }

  // Skor 0-100: tiap sinyal menyumbang bobot.
  let score = 0;
  // Kalimat seragam (CV rendah). Manusia umumnya CV > 0.5.
  if (cv < 0.3) { score += 25; notes.push("Panjang kalimat sangat seragam."); }
  else if (cv < 0.45) { score += 12; notes.push("Panjang kalimat cukup seragam."); }
  // Frasa khas AI.
  if (aiPhrasePer1k > 12) { score += 25; notes.push("Banyak frasa transisi/template khas AI."); }
  else if (aiPhrasePer1k > 6) { score += 12; notes.push("Beberapa frasa khas AI muncul."); }
  // Kalimat diawali konektor formal.
  if (transitionStartRatio > 0.35) { score += 15; notes.push("Banyak kalimat diawali konektor formal."); }
  else if (transitionStartRatio > 0.2) { score += 7; }
  // Paragraf seragam.
  if (paragraphUniformity > 0.7) { score += 15; notes.push("Panjang paragraf hampir seragam."); }
  else if (paragraphUniformity > 0.5) { score += 7; }
  // TTR tinggi + kalimat panjang rata-rata 18-28 kata: pola model bahasa.
  if (ttr > 0.62 && avg >= 16 && avg <= 30) { score += 10; notes.push("Kosakata sangat beragam dengan kalimat panjang stabil."); }
  // Informal → turunkan.
  if (informalHits >= 3) { score -= 20; notes.push("Ada kata informal/slang (ciri tulisan manusia)."); }
  else if (informalHits >= 1) { score -= 8; }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 60 ? "tinggi" : score >= 35 ? "sedang" : "rendah";
  if (!notes.length) notes.push("Tidak ada pola mencolok.");
  notes.push("Skor ini indikasi statistik, bukan bukti. Konfirmasi lewat tanya-jawab/presentasi.");
  return { score, label, signals, notes };
}

import { NextResponse } from "next/server";
import { sendToAIForPurpose, assertAiConfigured } from "@/lib/ai/client";

/**
 * Helper to extract a JSON object from potentially fenced/verbose AI output.
 */
function extractJson(text: string) {
  let json = String(text || "").trim();
  if (json.startsWith("```json")) json = json.slice(7);
  if (json.startsWith("```")) json = json.slice(3);
  if (json.endsWith("```")) json = json.slice(0, -3);
  const firstBrace = json.indexOf("{");
  const firstBracket = json.indexOf("[");
  // prefer array if it appears first
  const start = (firstBracket >= 0 && firstBracket < firstBrace) ? firstBracket : firstBrace;
  const lastBrace = json.lastIndexOf("}");
  const lastBracket = json.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (start >= 0 && end > start) {
    const candidate = json.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // fall through to try full parse
    }
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

export const maxDuration = 20; // seconds

export async function POST(req: Request) {
  try {
    assertAiConfigured();
    const body = await req.json().catch(() => ({}));
    const { brief = {}, options = {} } = body;

    // basic validation
    if (!brief || (Object.keys(brief).length === 0)) {
      return NextResponse.json({ success: false, error: "Brief kosong. Kirim minimal title/topic atau problemStatement." }, { status: 400 });
    }

    const systemPrompt = `Anda adalah asisten yang membuat rencana pencarian literatur akademik (search plan) berbasis brief proyek.
Keluaran harus berupa JSON tunggal sesuai schema: 
[
  {
    "group": "theory|method|prior-work|novelty|other",
    "queries": ["boolean query 1", "boolean query 2", "..."],
    "targetCount":  number_of_articles_to_find_for_this_group,
    "yearFrom":  (nullable number),
    "yearTo":    (nullable number),
    "openAccessOnly": true|false,
    "language": "id"|"en"|"both"
  },
  ...
]
Aturan:
- Buat 3-6 group yang relevan (theory, method, prior-work, novelty adalah rekomendasi).
- Untuk setiap group kembalikan 2-6 boolean/keyword queries yang siap dipakai di Semantic Scholar / OpenAlex / Crossref.
- Gunakan kata-kata bahasa Inggris untuk query utama, tambahkan varian Indonesia jika relevan.
- Gunakan rentang tahun jika brief menyebutkan yearRange atau tahun preferensi.
- Jangan menambahkan penjelasan natural language — hanya kembalikan JSON yang valid.
- Pastikan queries singkat, menggunakan AND/OR/quotes untuk frase, mis: \"\"student complaint system\" AND (university OR campus)\".
- Jika brief mencantumkan preferredKeywords, gunakan itu untuk membuat query.
- Jika brief mencantumkan documentType or academicTarget, sesuaikan targetCount (misalnya jurnal target tinggi perlu lebih referensi).`;

    const userPrompt = `Brief:\n${JSON.stringify(brief, null, 2)}\n\nOptions:\n${JSON.stringify(options || {}, null, 2)}\n\nInstruksi: Kembalikan JSON sesuai schema di system prompt.`;

    // Attempt AI generation using fast model; if it fails or is rate-limited, fallback to a lightweight local template
    let aiText: string | null = null;
    try {
      aiText = await sendToAIForPurpose(userPrompt, systemPrompt, "fast");
    } catch (err: any) {
      console.warn("AI search-plan call failed, falling back to local template:", err?.message || err);
      aiText = null;
    }

    let parsed = null;
    if (aiText) {
      parsed = extractJson(aiText);
    }

    if (!parsed) {
      // Local fallback: build a conservative search plan from brief keywords to avoid AI calls
      const topic = String((brief as any).topic || (brief as any).title || "").trim();
      const preferred = Array.isArray((brief as any).preferredKeywords) && (brief as any).preferredKeywords.length
        ? (brief as any).preferredKeywords
        : topic ? [topic] : ["student complaint system"];
      const english = Array.isArray((brief as any).preferredKeywordsEnglish) && (brief as any).preferredKeywordsEnglish.length
        ? (brief as any).preferredKeywordsEnglish
        : preferred;

      const yearFrom = (brief as any)?.yearRange?.start || null;
      const yearTo = (brief as any)?.yearRange?.end || null;

      const makeQueries = (base: string) => [
        `"${base}" AND (system OR application OR software)`,
        `"${base}" AND (evaluation OR study OR "case study")`,
        `"${base}" AND ("student complaint" OR grievance OR "user complaint")`,
      ];

      const normalized = [
        {
          group: "theory",
          queries: english.slice(0, 2).flatMap((q: string) => makeQueries(q)),
          targetCount: 5,
          yearFrom,
          yearTo,
          openAccessOnly: false,
          language: "en",
        },
        {
          group: "prior-work",
          queries: english.slice(0, 2).flatMap((q: string) => makeQueries(q)),
          targetCount: 8,
          yearFrom,
          yearTo,
          openAccessOnly: false,
          language: "en",
        },
        {
          group: "novelty",
          queries: english.slice(0, 2).flatMap((q: string) => makeQueries(q)),
          targetCount: 5,
          yearFrom,
          yearTo,
          openAccessOnly: false,
          language: "en",
        },
      ];

      return NextResponse.json({ success: true, source: "fallback-local", data: normalized });
    }

    // Basic normalization: ensure array of groups
    const plan = Array.isArray(parsed) ? parsed : [parsed];

    // Normalize minimal fields and types
    const normalized = plan.map((g: any, idx: number) => ({
      group: g.group || `group-${idx + 1}`,
      queries: Array.isArray(g.queries) ? g.queries.slice(0, 8) : [],
      targetCount: Number(g.targetCount || 5),
      yearFrom: g.yearFrom == null ? null : Number(g.yearFrom),
      yearTo: g.yearTo == null ? null : Number(g.yearTo),
      openAccessOnly: Boolean(g.openAccessOnly),
      language: g.language || "en",
    }));

    return NextResponse.json({ success: true, source: "ai-structured", data: normalized });
  } catch (error: any) {
    console.error("API /api/research/search-plan Error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Gagal membuat search plan." }, { status: 500 });
  }
}
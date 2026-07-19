import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-client";
import { sendToAIForPurpose } from "@/lib/ai/client";

function fallbackNovelty(brief: any, evidence: any[]) {
  const topEvidence = evidence.slice(0, 5);
  const topic = brief?.topic || brief?.title || "topik riset";

  return topEvidence.map((item, index) => ({
    id: `fallback-${index + 1}`,
    title: `Kandidat novelty ${index + 1} untuk ${topic}`,
    gap: item.limitations || "Penelitian sebelumnya belum menunjukkan keterbatasan secara eksplisit.",
    novelty: item.methods
      ? `Mengembangkan pendekatan ${item.methods} pada konteks ${topic} dengan fokus perbaikan yang lebih relevan terhadap kebutuhan pengguna.`
      : `Mengembangkan pendekatan baru yang lebih terarah untuk ${topic} berdasarkan kekurangan studi terdahulu.`,
    rationale: item.results || item.summary || "Kandidat ini dibuat dari ringkasan evidence yang tersedia.",
    supportingReferenceIds: [item.reference_id].filter(Boolean),
  }));
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!token) {
      return NextResponse.json({ success: false, error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const userRes = await supabaseAdmin.auth.getUser(token);
    const user = userRes?.data?.user;
    if (!user) {
      return NextResponse.json({ success: false, error: "Invalid user token" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { projectId, brief = {} } = body as { projectId?: string; brief?: any };
    if (!projectId) {
      return NextResponse.json({ success: false, error: "projectId required" }, { status: 400 });
    }

    const { data: projectRow, error: projectErr } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();

    if (projectErr) {
      return NextResponse.json({ success: false, error: projectErr.message || "Project lookup failed" }, { status: 500 });
    }

    if (!projectRow) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    if (String(projectRow.owner_id) !== String(user.id)) {
      return NextResponse.json({ success: false, error: "You are not the owner of this project" }, { status: 403 });
    }

    const { data: evidenceRows, error: evidenceErr } = await supabaseAdmin
      .from("reference_evidence")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (evidenceErr) {
      return NextResponse.json({ success: false, error: evidenceErr.message || "Failed to fetch evidence" }, { status: 500 });
    }

    const evidence = Array.isArray(evidenceRows) ? evidenceRows : [];
    if (evidence.length === 0) {
      return NextResponse.json({ success: false, error: "Belum ada evidence. Ekstrak evidence dari referensi dulu." }, { status: 400 });
    }

    const compactEvidence = evidence.slice(0, 12).map((item: any) => ({
      referenceId: item.reference_id,
      summary: item.summary,
      methods: item.methods,
      results: item.results,
      limitations: item.limitations,
      citationSentence: item.citation_sentence,
    }));

    const prompt = [
      "Anda adalah analis kebaruan penelitian untuk mahasiswa Indonesia.",
      "Dari brief dan evidence jurnal berikut, buat 3 kandidat research gap dan novelty yang realistis.",
      "Balas hanya JSON array dengan schema:",
      `[{"id":"cand-1","title":"...","gap":"...","novelty":"...","rationale":"...","supportingReferenceIds":["ref-1","ref-2"]}]`,
      "Aturan:",
      "- Jangan mengarang referensi di luar evidence yang diberikan.",
      "- Gap harus merujuk pada keterbatasan/kelemahan penelitian terdahulu.",
      "- Novelty harus spesifik, bukan sekadar 'mengembangkan sistem'.",
      "- SupportingReferenceIds wajib mengambil dari referenceId yang diberikan.",
      "- Gunakan Bahasa Indonesia yang jelas dan akademik.",
      "",
      `Brief: ${JSON.stringify(brief)}`,
      `Evidence: ${JSON.stringify(compactEvidence)}`,
    ].join("\n");

    let candidates: any = null;
    try {
      const response = await sendToAIForPurpose(prompt, undefined, "review");
      const match = response.match(/\[[\s\S]*\]/);
      const jsonText = match ? match[0] : response;
      candidates = JSON.parse(jsonText);
    } catch {
      candidates = null;
    }

    const normalized = Array.isArray(candidates) && candidates.length
      ? candidates.slice(0, 5).map((item: any, index: number) => ({
          id: item.id || `cand-${index + 1}`,
          title: String(item.title || `Kandidat ${index + 1}`).slice(0, 160),
          gap: String(item.gap || "").slice(0, 600),
          novelty: String(item.novelty || "").slice(0, 600),
          rationale: String(item.rationale || "").slice(0, 700),
          supportingReferenceIds: Array.isArray(item.supportingReferenceIds) ? item.supportingReferenceIds.slice(0, 6) : [],
        }))
      : fallbackNovelty(brief, evidence);

    return NextResponse.json({ success: true, data: normalized, source: Array.isArray(candidates) && candidates.length ? "ai" : "fallback" });
  } catch (error: any) {
    console.error("API /api/research/novelty Error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Failed to generate novelty candidates" }, { status: 500 });
  }
}

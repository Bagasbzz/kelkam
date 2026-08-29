import { NextResponse } from "next/server";
import { sendToAIForPurpose } from "@/lib/ai/client";
import { authenticateRequest, ensureOwnedProject, isValidProjectId } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

function clamp(value: unknown, max: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

export async function POST(req: Request) {
  const authentication = await authenticateRequest(req);
  if (!authentication.ok) return authentication.response;
  const { supabase, user } = authentication.auth;

  const rateLimit = enforceRateLimit(`evidence-generate:${user.id}`, {
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const body = await readJsonBody<Record<string, unknown>>(req, 100_000);
    const projectId = body.projectId;
    const referenceId = clamp(body.referenceId, 300);

    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ success: false, error: "Project ID tidak valid." }, { status: 400 });
    }
    if (!referenceId) {
      return NextResponse.json({ success: false, error: "Reference ID wajib diisi." }, { status: 400 });
    }

    const project = await ensureOwnedProject(supabase, user.id, projectId);
    if (!project.ok) {
      const conflict = project.reason === "already_owned";
      return NextResponse.json(
        { success: false, error: conflict ? "Project ID sudah digunakan." : "Gagal menyiapkan proyek." },
        { status: conflict ? 409 : 500 },
      );
    }

    const title = clamp(body.title, 500);
    const authors = Array.isArray(body.authors)
      ? body.authors.slice(0, 30).map((item) => clamp(item, 150))
      : [];
    const abstract = clamp(body.abstract, 12_000);

    const prompt = [
      "Ringkas dan ekstrak informasi penting dari referensi akademik berikut:",
      `Title: ${title || "N/A"}`,
      `Authors: ${authors.join(", ") || "N/A"}`,
      `Year: ${clamp(body.year, 10) || "N/A"}`,
      `Venue: ${clamp(body.venue, 300) || "N/A"}`,
      `Abstract: ${abstract || "N/A"}`,
      `URL: ${clamp(body.url, 2_000) || "N/A"}`,
      "",
      "Keluarkan hasil sebagai JSON dengan field: summary, methods, results, limitations, keywords, citation_sentence.",
      "Jika informasi tidak tersedia, gunakan null. Balas hanya JSON tanpa teks tambahan.",
    ].join("\n");

    let aiResponseText = "";
    try {
      aiResponseText = await sendToAIForPurpose(prompt, undefined, "fast");
    } catch (error) {
      console.error("Evidence AI extraction failed:", error);
      return NextResponse.json({ success: false, error: "AI gagal mengekstrak evidence." }, { status: 502 });
    }

    let parsed: Record<string, unknown> = {};
    try {
      const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponseText);
    } catch {
      parsed = { summary: clamp(aiResponseText, 8_000) };
    }

    const evidenceRow = {
      project_id: projectId,
      reference_id: referenceId,
      summary: clamp(parsed.summary, 8_000) || null,
      methods: clamp(parsed.methods, 4_000) || null,
      results: clamp(parsed.results, 4_000) || null,
      limitations: clamp(parsed.limitations, 4_000) || null,
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.slice(0, 20).map((item) => clamp(item, 100))
        : null,
      citation_sentence: clamp(parsed.citation_sentence, 2_000) || null,
      model_used: "FAST",
    };

    const { data, error } = await supabase
      .from("reference_evidence")
      .insert(evidenceRow)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("Evidence insert failed:", error.code || "unknown");
      return NextResponse.json({ success: false, error: "Gagal menyimpan evidence." }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("API /api/references/evidence/generate failed:", error);
    return publicErrorResponse(error, "Gagal membuat evidence.");
  }
}

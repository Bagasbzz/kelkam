import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-client";
import { sendToAIForPurpose } from "@/lib/ai/client";

/**
 * POST /api/references/evidence/generate
 * Body: {
 *   projectId: string,
 *   referenceId: string,
 *   title?: string,
 *   authors?: string[],
 *   year?: number,
 *   venue?: string,
 *   abstract?: string,
 *   url?: string
 * }
 *
 * Server behavior:
 * - Requires Authorization: Bearer <access_token>
 * - Verifies user & project ownership (creates project mapping if missing)
 * - Calls AI (FAST model) to extract structured evidence fields:
 *   summary, methods, results, limitations, keywords, citation_sentence
 * - Persists evidence to public.reference_evidence
 * - Returns the saved evidence row
 */
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
      console.error("Invalid user token", userRes?.error);
      return NextResponse.json({ success: false, error: "Invalid user token" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { projectId, referenceId, title, authors, year, venue, abstract, url } = body as any;

    if (!projectId) return NextResponse.json({ success: false, error: "projectId required" }, { status: 400 });
    if (!referenceId) return NextResponse.json({ success: false, error: "referenceId required" }, { status: 400 });

    // verify or create project ownership mapping
    const { data: projectRow, error: projectErr } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();

    if (projectErr) {
      console.error("Supabase project lookup error:", projectErr);
      return NextResponse.json({ success: false, error: projectErr.message || "Project lookup failed" }, { status: 500 });
    }

    if (!projectRow) {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("projects")
        .insert({ project_id: projectId, owner_id: user.id })
        .select("*");
      if (insertErr) {
        console.error("Failed creating project mapping:", insertErr);
        return NextResponse.json({ success: false, error: insertErr.message || "Failed to create project mapping" }, { status: 500 });
      }
    } else {
      if (String(projectRow.owner_id) !== String(user.id)) {
        return NextResponse.json({ success: false, error: "You are not the owner of this project" }, { status: 403 });
      }
    }

    // Build prompt for AI (FAST purpose)
    const promptParts = [
      `Ringkas dan ekstrak informasi penting dari referensi akademik berikut:`,
      `Title: ${title || "N/A"}`,
      `Authors: ${Array.isArray(authors) ? authors.join(", ") : authors || "N/A"}`,
      `Year: ${year || "N/A"}`,
      `Venue: ${venue || "N/A"}`,
      `Abstract: ${abstract || "N/A"}`,
      `URL: ${url || "N/A"}`,
      "",
      "Keluarkan hasil sebagai JSON dengan field berikut:",
      "- summary: ringkasan singkat (3-6 kalimat) dalam Bahasa Indonesia",
      "- methods: deskripsikan metode yang digunakan (kalimat pendek)",
      "- results: temuan utama (kalimat pendek)",
      "- limitations: keterbatasan yang disebutkan (kalimat pendek)",
      "- keywords: array kata kunci (5-12 kata/phrase)",
      "- citation_sentence: satu kalimat yang bisa dipakai sebagai sitasi di teks (contoh: 'Menurut X et al. (2021), ...')",
      "",
      "Jika informasi tidak tersedia, masukkan nilai kosong atau null. Balas HANYA JSON tanpa teks tambahan."
    ];
    const prompt = promptParts.join("\n");

    // Call AI (FAST)
    let aiResponseText = "";
    try {
      aiResponseText = await sendToAIForPurpose(prompt, undefined, "fast");
    } catch (aiErr: any) {
      console.error("AI extraction error:", aiErr);
      return NextResponse.json({ success: false, error: "AI extraction failed: " + String(aiErr?.message || aiErr) }, { status: 500 });
    }

    // Attempt to parse AI JSON
    let parsed: any = {};
    try {
      // AI may return code block; try to extract first JSON object
      const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : aiResponseText;
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.warn("Failed to parse AI response as JSON. Returning raw AI text.", parseErr);
      // fallback: store raw in summary field
      parsed = {
        summary: aiResponseText,
        methods: null,
        results: null,
        limitations: null,
        keywords: null,
        citation_sentence: null,
      };
    }

    // Normalize parsed fields
    const evidenceRow = {
      project_id: projectId,
      reference_id: referenceId,
      summary: parsed.summary || null,
      methods: parsed.methods || null,
      results: parsed.results || null,
      limitations: parsed.limitations || null,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : parsed.keywords ? [parsed.keywords] : null,
      citation_sentence: parsed.citation_sentence || null,
      model_used: "FAST",
    };

    const { data: insertData, error: insertErr } = await supabaseAdmin
      .from("reference_evidence")
      .insert(evidenceRow)
      .select("*")
      .limit(1)
      .maybeSingle();

    if (insertErr) {
      console.error("Failed inserting evidence:", insertErr);
      return NextResponse.json({ success: false, error: insertErr.message || "Failed to save evidence" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: insertData });
  } catch (err: any) {
    console.error("API /api/references/evidence/generate Error:", err);
    return NextResponse.json({ success: false, error: err?.message || "Failed to generate evidence" }, { status: 500 });
  }
}
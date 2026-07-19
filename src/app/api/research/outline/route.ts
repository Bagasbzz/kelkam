import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-client";
import { sendToAIForPurpose } from "@/lib/ai/client";

function clampText(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function fallbackOutline(brief: any, evidence: any[], novelty: any) {
  const topic = brief?.title || brief?.topic || "topik riset";
  const focusRefs = evidence.slice(0, 6).map((item: any) => item.reference_id).filter(Boolean);
  const noveltyRefs = Array.isArray(novelty?.supportingReferenceIds) ? novelty.supportingReferenceIds.slice(0, 4) : [];

  const sections = [
    {
      id: "outline-1",
      title: "Pendahuluan",
      purpose: `Menjelaskan latar belakang ${topic}, masalah utama, urgensi pembahasan, dan tujuan laporan secara runtut.`,
      targetWords: 700,
      allowedReferenceIds: focusRefs.slice(0, 3),
      requiredClaimIds: [],
      status: "planned",
    },
    {
      id: "outline-2",
      title: "Tinjauan Pustaka",
      purpose: `Merangkum teori, penelitian terdahulu, dan gap yang mengarah pada novelty${novelty?.title ? ` ${novelty.title}` : " penelitian"}.`,
      targetWords: 900,
      allowedReferenceIds: [...new Set([...noveltyRefs, ...focusRefs.slice(0, 5)])],
      requiredClaimIds: [],
      status: "planned",
    },
    {
      id: "outline-3",
      title: "Metode atau Rancangan",
      purpose: `Menjelaskan pendekatan, alur kerja, kebutuhan data, dan langkah implementasi/analisis yang digunakan pada ${topic}.`,
      targetWords: 900,
      allowedReferenceIds: focusRefs.slice(0, 4),
      requiredClaimIds: [],
      status: "planned",
    },
    {
      id: "outline-4",
      title: "Pembahasan dan Analisis",
      purpose: `Membahas hasil utama, keunggulan usulan, serta alasan mengapa novelty yang dipilih relevan terhadap gap studi sebelumnya.`,
      targetWords: 1100,
      allowedReferenceIds: [...new Set([...noveltyRefs, ...focusRefs.slice(0, 6)])],
      requiredClaimIds: [],
      status: "planned",
    },
    {
      id: "outline-5",
      title: "Kesimpulan dan Saran",
      purpose: "Merangkum temuan penting, kontribusi laporan, keterbatasan, dan arah pengembangan berikutnya.",
      targetWords: 450,
      allowedReferenceIds: noveltyRefs,
      requiredClaimIds: [],
      status: "planned",
    },
  ];

  const citationMap = Object.fromEntries(
    sections.map((section) => [section.id, section.allowedReferenceIds || []]),
  );

  return { sections, citationMap };
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
    const { projectId, brief = {}, novelty = null } = body as { projectId?: string; brief?: any; novelty?: any };
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
      summary: clampText(item.summary, 280),
      methods: clampText(item.methods, 180),
      results: clampText(item.results, 220),
      limitations: clampText(item.limitations, 220),
    }));

    const prompt = [
      "Anda adalah arsitek outline laporan akademik untuk mahasiswa Indonesia.",
      "Berdasarkan brief, novelty terpilih, dan evidence jurnal, susun outline laporan yang realistis dan siap dikembangkan.",
      "Balas hanya JSON object dengan schema:",
      '{"sections":[{"id":"section-1","title":"...","purpose":"...","targetWords":700,"allowedReferenceIds":["ref-1"],"requiredClaimIds":[],"status":"planned"}],"citationMap":{"section-1":["ref-1","ref-2"]}}',
      "Aturan:",
      "- Buat 4 sampai 6 section utama.",
      "- Judul section harus spesifik dan cocok untuk laporan/proyek akademik umum.",
      "- Purpose tiap section wajib menjelaskan isi yang harus dibahas, bukan kalimat umum kosong.",
      "- allowedReferenceIds dan citationMap hanya boleh mengambil referenceId dari evidence yang diberikan.",
      "- targetWords harus realistis dan hemat total panjang.",
      "- Gunakan Bahasa Indonesia yang jelas, formal, dan langsung bisa dipakai user.",
      "",
      `Brief: ${JSON.stringify(brief)}`,
      `Novelty: ${JSON.stringify(novelty)}`,
      `Evidence: ${JSON.stringify(compactEvidence)}`,
    ].join("\n");

    let outline: any = null;
    try {
      const response = await sendToAIForPurpose(prompt, undefined, "review");
      const match = response.match(/\{[\s\S]*\}/);
      const jsonText = match ? match[0] : response;
      outline = JSON.parse(jsonText);
    } catch {
      outline = null;
    }

    const fallback = fallbackOutline(brief, evidence, novelty);
    const validReferenceIds = new Set(compactEvidence.map((item: any) => item.referenceId).filter(Boolean));

    const sections = Array.isArray(outline?.sections) && outline.sections.length
      ? outline.sections.slice(0, 6).map((item: any, index: number) => ({
          id: item.id || `section-${index + 1}`,
          title: clampText(item.title || `Bagian ${index + 1}`, 160),
          purpose: clampText(item.purpose || "", 700),
          targetWords: Number(item.targetWords) > 0 ? Number(item.targetWords) : 600,
          allowedReferenceIds: Array.isArray(item.allowedReferenceIds)
            ? item.allowedReferenceIds.filter((refId: string) => validReferenceIds.has(refId)).slice(0, 8)
            : [],
          requiredClaimIds: Array.isArray(item.requiredClaimIds) ? item.requiredClaimIds.slice(0, 8) : [],
          status: item.status === "approved" || item.status === "review" || item.status === "draft" ? item.status : "planned",
        }))
      : fallback.sections;

    const citationMap = outline?.citationMap && typeof outline.citationMap === "object"
      ? Object.fromEntries(
          Object.entries(outline.citationMap).map(([sectionId, refIds]) => [
            sectionId,
            Array.isArray(refIds) ? refIds.filter((refId: string) => validReferenceIds.has(refId)).slice(0, 10) : [],
          ]),
        )
      : fallback.citationMap;

    return NextResponse.json({
      success: true,
      data: { sections, citationMap },
      source: Array.isArray(outline?.sections) && outline.sections.length ? "ai" : "fallback",
    });
  } catch (error: any) {
    console.error("API /api/research/outline Error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Failed to generate outline" }, { status: 500 });
  }
}

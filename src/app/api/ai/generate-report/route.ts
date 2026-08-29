import { NextResponse } from "next/server";
import { generateReportDraft } from "@/lib/report/generate-report";
import { getErrorMessage } from "@/lib/errors";

export const maxDuration = 60;

function validateProject(project: unknown) {
  if (!project || typeof project !== "object" || Array.isArray(project)) return "Data proyek tidak valid.";
  const candidate = project as Record<string, unknown>;
  if (!candidate.title && !candidate.topic) return "Judul atau topik belum diisi.";
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) return "Sumber/konteks proyek belum diisi. Tambahkan brief, pedoman, contoh laporan, referensi, atau ringkasan codingan dulu.";
  if (!Array.isArray(candidate.outline) || candidate.outline.length === 0) return "Outline belum dibuat. Jalankan brainstorm rencana dulu sebelum generate laporan.";
  return "";
}

export async function POST(req: Request) {
  try {
    const { project } = await req.json();
    const validationError = validateProject(project);
    if (validationError) return NextResponse.json({ success: false, error: validationError }, { status: 400 });

    const draft = await generateReportDraft(project);
    return NextResponse.json({ success: true, data: draft.content, source: draft.source });
  } catch (error: unknown) {
    console.error("API /api/ai/generate-report Error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, "Gagal membuat laporan lengkap.") },
      { status: 500 }
    );
  }
}

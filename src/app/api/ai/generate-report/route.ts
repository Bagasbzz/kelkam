import { NextResponse } from "next/server";
import { generateReportDraft } from "@/lib/report/generate-report";

export const maxDuration = 60;

function validateProject(project: any) {
  if (!project?.title && !project?.topic) return "Judul atau topik belum diisi.";
  if (!Array.isArray(project.sources) || project.sources.length === 0) return "Sumber/konteks proyek belum diisi. Tambahkan brief, pedoman, contoh laporan, referensi, atau ringkasan codingan dulu.";
  if (!Array.isArray(project.outline) || project.outline.length === 0) return "Outline belum dibuat. Jalankan brainstorm rencana dulu sebelum generate laporan.";
  return "";
}

export async function POST(req: Request) {
  try {
    const { project } = await req.json();
    const validationError = validateProject(project);
    if (validationError) return NextResponse.json({ success: false, error: validationError }, { status: 400 });

    const draft = await generateReportDraft(project);
    return NextResponse.json({ success: true, data: draft.content, source: draft.source });
  } catch (error: any) {
    console.error("API /api/ai/generate-report Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal membuat laporan lengkap." },
      { status: 500 }
    );
  }
}

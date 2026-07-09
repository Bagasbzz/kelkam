import { NextResponse } from "next/server";
import { startReportJob } from "@/lib/report/report-jobs";

export const maxDuration = 10;

function validateProject(project: any) {
  if (!project?.title && !project?.topic) return "Judul atau topik belum diisi.";
  if (!Array.isArray(project.sources) || project.sources.length === 0) return "Sumber/konteks proyek belum diisi.";
  if (!Array.isArray(project.outline) || project.outline.length === 0) return "Outline belum dibuat. Jalankan brainstorm rencana dulu.";
  return "";
}

export async function POST(req: Request) {
  try {
    const { project } = await req.json();
    const validationError = validateProject(project);
    if (validationError) return NextResponse.json({ success: false, error: validationError }, { status: 400 });

    const job = startReportJob(project);
    return NextResponse.json({ success: true, job });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Gagal memulai job laporan." },
      { status: 500 }
    );
  }
}

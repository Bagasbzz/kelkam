import { NextResponse } from "next/server";
import { authenticateRequest, isValidProjectId, ownsProject } from "@/lib/server/auth";

export async function GET(req: Request) {
  const authentication = await authenticateRequest(req);
  if (!authentication.ok) return authentication.response;
  const { supabase, user } = authentication.auth;

  try {
    const projectId = new URL(req.url).searchParams.get("projectId");
    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ success: false, error: "Project ID tidak valid." }, { status: 400 });
    }

    const ownership = await ownsProject(supabase, user.id, projectId);
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.reason === "lookup_failed" ? "Gagal memeriksa proyek." : "Proyek tidak ditemukan." },
        { status: ownership.reason === "lookup_failed" ? 500 : 404 },
      );
    }

    const { data, error } = await supabase
      .from("reference_library")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Reference list query failed:", error.code || "unknown");
      return NextResponse.json({ success: false, error: "Gagal mengambil referensi." }, { status: 500 });
    }

    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("API /api/references/list failed:", error);
    return NextResponse.json({ success: false, error: "Gagal mengambil referensi." }, { status: 500 });
  }
}

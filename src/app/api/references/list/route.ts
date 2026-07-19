import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-client";

/**
 * GET /api/references/list?projectId=...
 * Requires Authorization: Bearer <access_token>
 * Only the project owner may read the saved references (unless you change policies).
 */
export async function GET(req: Request) {
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

    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ success: false, error: "projectId query param is required" }, { status: 400 });
    }

    // verify ownership
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
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    if (String(projectRow.owner_id) !== String(user.id)) {
      return NextResponse.json({ success: false, error: "You are not the owner of this project" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("reference_library")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Supabase select error:", error);
      return NextResponse.json({ success: false, error: error.message || "Failed to fetch references" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("API /api/references/list Error:", err);
    return NextResponse.json({ success: false, error: err?.message || "Failed to fetch references" }, { status: 500 });
  }
}
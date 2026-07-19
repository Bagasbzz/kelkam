import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-client";

/**
 * POST /api/references/persist
 * Body: { projectId: string, references: [ { id, title, authors, year, venue, abstract, url, pdfUrl, doi, citationCount, isOpenAccess, source, citationApa, raw } ] }
 *
 * Server enforces ownership: requires Authorization: Bearer <access_token> from Supabase client.
 * If project mapping does not exist, it will be created and assigned to the caller.
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!token) {
      return NextResponse.json({ success: false, error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    // validate token and get user
    const userRes = await supabaseAdmin.auth.getUser(token);
    const user = userRes?.data?.user;
    if (!user) {
      console.error("Invalid user token", userRes?.error);
      return NextResponse.json({ success: false, error: "Invalid user token" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { projectId, references } = body as { projectId?: string; references?: any[] };

    if (!projectId) return NextResponse.json({ success: false, error: "projectId required" }, { status: 400 });
    if (!Array.isArray(references) || references.length === 0) return NextResponse.json({ success: false, error: "references required" }, { status: 400 });

    // check project ownership mapping in projects table
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
      // create mapping and assign owner = current user
      const { data: inserted, error: insertErr } = await supabaseAdmin.from("projects").insert({ project_id: projectId, owner_id: user.id }).select("*");
      if (insertErr) {
        console.error("Failed creating project mapping:", insertErr);
        return NextResponse.json({ success: false, error: insertErr.message || "Failed to create project mapping" }, { status: 500 });
      }
    } else {
      if (String(projectRow.owner_id) !== String(user.id)) {
        return NextResponse.json({ success: false, error: "You are not the owner of this project" }, { status: 403 });
      }
    }

    const rows = references.map((r: any) => ({
      project_id: projectId,
      reference_id: r.doi || r.id || null,
      title: r.title || null,
      authors: r.authors || null,
      year: r.year || null,
      venue: r.venue || null,
      abstract: r.abstract || null,
      url: r.url || null,
      pdf_url: r.pdfUrl || null,
      doi: r.doi || null,
      citation_count: r.citationCount || null,
      is_open_access: r.isOpenAccess || false,
      source: r.source || null,
      citation_apa: r.citationApa || null,
      raw: r.raw || null,
    }));

    const { data, error } = await supabaseAdmin.from("reference_library").insert(rows).select("*");

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ success: false, error: error.message || "Supabase insert failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, inserted: data?.length || 0, data });
  } catch (err: any) {
    console.error("API /api/references/persist Error:", err);
    return NextResponse.json({ success: false, error: err?.message || "Failed to persist references" }, { status: 500 });
  }
}
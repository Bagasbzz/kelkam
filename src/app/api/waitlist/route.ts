import { NextResponse } from "next/server";
import { createAnonymousServerSupabase } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

function clientKey(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip") || "unknown").slice(0, 100);
}

export async function POST(req: Request) {
  const rateLimit = enforceRateLimit(`waitlist:${clientKey(req)}`, {
    limit: 5,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const body = await readJsonBody<{ email?: unknown }>(req, 4_096);
    const email = String(body.email || "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: "Email tidak valid." }, { status: 400 });
    }

    const supabase = createAnonymousServerSupabase();
    const { error } = await supabase.from("waitlist").insert({ email });
    if (error && error.code !== "23505") {
      console.error("Waitlist insert failed:", error.code || "unknown");
      return NextResponse.json({ success: false, error: "Pendaftaran waitlist gagal." }, { status: 500 });
    }

    return NextResponse.json(
      { success: true, alreadyJoined: error?.code === "23505" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("API /api/waitlist failed:", error);
    return publicErrorResponse(error, "Pendaftaran waitlist gagal.");
  }
}

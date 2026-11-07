export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const commit = process.env.APPLICATION_RELEASE || "unknown";
  return Response.json({ commit }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

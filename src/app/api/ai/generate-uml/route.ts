/**
 * /api/ai/generate-uml — wrapper HTTP untuk pipeline UML (lihat src/lib/uml/pipeline.ts).
 * Pipeline yang sama dipakai job laporan supaya diagram di laporan = diagram UML Builder.
 */
import { NextResponse } from "next/server";
import {
  ROUTE_BUDGET_MS,
  errorToResult,
  isRecord,
  runUmlPipeline,
  type GenerateUmlRequest,
  type UmlStreamEvent,
} from "@/lib/uml/pipeline";
import { readJsonBody } from "@/lib/server/request-guards";

export const maxDuration = 120;

export async function POST(req: Request) {
  // Body dibatasi 512 KB: deskripsi alur + konteks spec cukup, payload besar = indikasi penyalahgunaan.
  const rawBody: unknown = await readJsonBody<unknown>(req, 512 * 1024).catch(() => null);
  if (!isRecord(rawBody)) {
    return NextResponse.json({ success: false, error: "Payload JSON tidak valid atau terlalu besar." }, { status: 400 });
  }
  const body = rawBody as GenerateUmlRequest;
  const wantsStream = new URL(req.url).searchParams.get("stream") === "1";

  if (!wantsStream) {
    const result = await runUmlPipeline(body, () => {}, ROUTE_BUDGET_MS).catch(errorToResult);
    return NextResponse.json(result.payload, { status: result.status });
  }

  // NDJSON stream: tiap baris satu event. Koneksi tetap hidup (ada data mengalir) jadi proxy tidak memutus di tengah.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (event: UmlStreamEvent) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { closed = true; }
      };
      // Heartbeat agar LiteSpeed/Passenger tidak menganggap koneksi idle selama model masih "berpikir".
      const heartbeat = setInterval(() => write({ type: "status", phase: "heartbeat", text: "" }), 5000);
      try {
        const result = await runUmlPipeline(body, write, ROUTE_BUDGET_MS).catch(errorToResult);
        write({ type: "result", status: result.status, payload: result.payload });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

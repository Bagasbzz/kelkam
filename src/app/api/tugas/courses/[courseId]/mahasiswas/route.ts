/**
 * GET /api/tugas/courses/[courseId]/mahasiswas
 * POST /api/tugas/courses/[courseId]/mahasiswas
 * -----------------------------------------------------------------------------
 * Roster mahasiswa per course (NIM + nama + kelas).
 *
 * GET:
 *   - Auth: course admin.
 *   - Return list mahasiswa (id, nim, name, classId, email).
 *   - Query ?search= buat filter by NIM/name.
 *
 * POST (bulk):
 *   - Auth: course admin.
 *   - Body 1: { entries: Array<{ nim, name, className?, email? }> }
 *   - Body 2: { rawText: string } → AI-parse pakai AI (z0ne.ai default).
 *     Entries diekstrak ke format entries via sendToAIForPurpose("fast").
 *   - Result: { inserted, skipped, errors, aiParsed? }.
 *   - Duplicate NIM per course di-skip (gak overwrite).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { requireCourseAdmin } from "@/lib/server/auth";
import { sendToAIForPurpose } from "@/lib/ai/client";

const EntrySchema = z.object({
  nim: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  className: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
});

const BulkSchema = z.union([
  z.object({
    entries: z.array(EntrySchema).min(1).max(500),
  }),
  z.object({
    rawText: z.string().trim().min(3).max(20000),
  }),
]);

const AI_SYSTEM = `Anda adalah parser data mahasiswa. Output HARUS JSON array of objects dengan field:
- nim (string, wajib)
- name (string, wajib)
- className (string, opsional)
- email (string, opsional)
Jangan tambahkan field lain. Jangan ada markdown. Jangan ada penjelasan. Hanya JSON array. Contoh:
[{"nim":"23/1234","name":"Budi Santoso","className":"A"}]

Input user kemungkinan besar paste dari Excel/Word — setiap baris 1 mahasiswa. Format bisa:
- "NIM,Nama,Kelas" (CSV)
- "NIM - Nama (Kelas)" (dengan separator)
- Tab-separated
- Spasi-separated (NIM numeric, nama text)
Kalau format tidak jelas, best-effort parse dan skip baris yang tidak valid (jangan return error).`;

export async function GET(
  _req: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    await requireCourseAdmin(courseId);
    const url = new URL(_req.url);
    const search = url.searchParams.get("search")?.trim().toLowerCase() || "";
    const mahasiswas = await prisma.mahasiswa.findMany({
      where: {
        courseId,
        ...(search
          ? {
              OR: [
                { nim: { contains: search, mode: "insensitive" as const } },
                { name: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ classId: "asc" }, { nim: "asc" }],
      select: {
        id: true,
        nim: true,
        name: true,
        email: true,
        classId: true,
        class: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ success: true, mahasiswas });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/courses/[id]/mahasiswas GET failed:", error);
    return publicErrorResponse(error, "Gagal memuat daftar mahasiswa.");
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    await requireCourseAdmin(courseId);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: "Body harus JSON." }, { status: 400 });
    }

    const parsed = BulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." },
        { status: 400 },
      );
    }

    // Ambil kelas course sekali (buat resolve className → classId).
    const classes = await prisma.courseClass.findMany({
      where: { courseId },
      select: { id: true, name: true },
    });
    const classByName = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]));

    let entries: z.infer<typeof EntrySchema>[] = [];
    let aiParsed = false;

    if ("entries" in parsed.data) {
      entries = parsed.data.entries;
    } else {
      // Raw text mode → AI parse.
      let aiRaw: string;
      try {
        aiRaw = await sendToAIForPurpose(
          parsed.data.rawText.slice(0, 6000),
          AI_SYSTEM,
          "fast",
        );
      } catch (err) {
        console.warn("mahasiswa AI parse failed:", err);
        return NextResponse.json({ success: false, error: "AI gagal membaca daftar mahasiswa. Coba lagi atau rapikan formatnya." }, { status: 502 });
      }
      // Strip markdown fences kalau ada.
      aiRaw = aiRaw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const jsonStart = aiRaw.indexOf("[");
      const jsonEnd = aiRaw.lastIndexOf("]");
      if (jsonStart < 0 || jsonEnd < 0) {
        return NextResponse.json(
          { success: false, error: "Format tidak dikenali AI. Coba paste sebagai CSV (NIM,Nama,Kelas per baris)." },
          { status: 400 },
        );
      }
      try {
        const rawArr = JSON.parse(aiRaw.slice(jsonStart, jsonEnd + 1)) as unknown;
        if (!Array.isArray(rawArr)) throw new Error("AI output bukan array");
        const validated: z.infer<typeof EntrySchema>[] = [];
        for (const item of rawArr) {
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          const e = EntrySchema.safeParse({
            nim: obj.nim,
            name: obj.name,
            className: obj.className,
            email: obj.email,
          });
          if (e.success) validated.push(e.data);
        }
        if (validated.length === 0) {
          return NextResponse.json(
            { success: false, error: "AI tidak menemukan data mahasiswa di input." },
            { status: 400 },
          );
        }
        entries = validated;
        aiParsed = true;
      } catch {
        return NextResponse.json(
          { success: false, error: "Format output AI tidak valid. Coba paste manual sebagai CSV." },
          { status: 400 },
        );
      }
    }

    // Skip duplicate NIM dalam batch yang sama + yg udah ada di DB.
    const seenNim = new Set<string>();
    const unique: z.infer<typeof EntrySchema>[] = [];
    for (const e of entries) {
      if (seenNim.has(e.nim)) continue;
      seenNim.add(e.nim);
      unique.push(e);
    }
    const existingNims = await prisma.mahasiswa.findMany({
      where: {
        courseId,
        nim: { in: unique.map((e) => e.nim) },
      },
      select: { nim: true },
    });
    const existingSet = new Set(existingNims.map((e) => e.nim));
    const toInsert = unique.filter((e) => !existingSet.has(e.nim));

    let inserted = 0;
    if (toInsert.length > 0) {
      const result = await prisma.mahasiswa.createMany({
        data: toInsert.map((e) => ({
          courseId,
          nim: e.nim,
          name: e.name,
          email: e.email || null,
          classId: e.className ? classByName.get(e.className.toLowerCase()) ?? null : null,
        })),
        skipDuplicates: true,
      });
      inserted = result.count;
    }

    return NextResponse.json(
      {
        success: true,
        inserted,
        skipped: unique.length - inserted + (entries.length - unique.length),
        duplicateInDb: existingSet.size,
        totalSubmitted: entries.length,
        aiParsed,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/courses/[id]/mahasiswas POST failed:", error);
    return publicErrorResponse(error, "Gagal import mahasiswa.");
  }
}
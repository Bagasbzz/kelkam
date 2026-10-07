/**
 * Tools (function-calling) untuk Admin AI Tugas.
 * -----------------------------------------------------------------------------
 * Semua tool bersifat course-scoped: `ctx.courseId` sudah diverifikasi admin
 * oleh route sebelum tool dipanggil. Setiap tool memverifikasi ulang bahwa
 * tugas/submission yang diakses memang milik course itu (anti IDOR).
 *
 * Prinsip hemat token: tool mengembalikan ringkasan terstruktur & terpotong,
 * bukan dump mentah. Teks panjang dipotong dengan `maxChars`.
 * -----------------------------------------------------------------------------
 */

import type OpenAI from "openai";
import { prisma } from "@/lib/db/prisma";
import { nilaiToHuruf } from "@/lib/server/tugas/serialize";
import { normalizeNim } from "@/lib/server/tugas/pertemuan";
import { getSubmissionText, getTugasSubmissionTexts } from "@/lib/server/tugas/submission-text";
import { compareAll, detectAiIndication, textHash } from "@/lib/server/tugas/text-analysis";

export interface ToolContext {
  courseId: string;
  adminId: string;
}

export type ToolResult = Record<string, unknown>;

const fmtDate = (d: Date) =>
  d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[...dipotong, total ${s.length} karakter]` : s);

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

async function tugasInCourse(ctx: ToolContext, tugasId: string) {
  const t = await prisma.tugas.findFirst({
    where: { id: tugasId, courseId: ctx.courseId },
    include: { class: { select: { id: true, name: true } } },
  });
  if (!t) throw new Error("Tugas tidak ditemukan di course ini.");
  return t;
}

async function submissionInCourse(ctx: ToolContext, submissionId: string) {
  const s = await prisma.tugasSubmission.findFirst({
    where: { id: submissionId, tugas: { courseId: ctx.courseId } },
    include: {
      class: { select: { id: true, name: true } },
      fileUpload: { select: { id: true, originalName: true, mime: true, size: true } },
      tugas: { select: { id: true, title: true, pertemuan: true, deadline: true } },
    },
  });
  if (!s) throw new Error("Pengumpulan tidak ditemukan di course ini.");
  return s;
}

/** Resolve tugas dari tugasId ATAU pertemuan ATAU potongan judul. */
async function resolveTugas(ctx: ToolContext, args: { tugasId?: string; pertemuan?: number; title?: string }) {
  if (args.tugasId) return [await tugasInCourse(ctx, args.tugasId)];
  const where: Record<string, unknown> = { courseId: ctx.courseId };
  if (args.pertemuan) where.pertemuan = args.pertemuan;
  if (args.title) where.title = { contains: args.title, mode: "insensitive" };
  const list = await prisma.tugas.findMany({
    where,
    include: { class: { select: { id: true, name: true } } },
    orderBy: { deadline: "asc" },
  });
  if (!list.length) throw new Error("Tidak ada tugas yang cocok. Gunakan listTugas untuk melihat daftar.");
  return list;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function listTugas(ctx: ToolContext): Promise<ToolResult> {
  const tugases = await prisma.tugas.findMany({
    where: { courseId: ctx.courseId },
    orderBy: [{ pertemuan: "asc" }, { deadline: "asc" }],
    include: { class: { select: { name: true } }, _count: { select: { submissions: true } } },
  });
  return {
    count: tugases.length,
    tugases: tugases.map((t) => ({
      id: t.id,
      pertemuan: t.pertemuan,
      title: t.title,
      kelas: t.class?.name ?? "semua",
      deadline: fmtDate(t.deadline),
      lewat: t.deadline < new Date(),
      jumlahSubmit: t._count.submissions,
    })),
  };
}

async function getCourseOverview(ctx: ToolContext): Promise<ToolResult> {
  const [course, classes, roster, tugasCount, subCount] = await Promise.all([
    prisma.course.findUnique({ where: { id: ctx.courseId }, select: { name: true, code: true } }),
    prisma.courseClass.findMany({ where: { courseId: ctx.courseId }, select: { id: true, name: true, _count: { select: { mahasiswas: true } } } }),
    prisma.mahasiswa.count({ where: { courseId: ctx.courseId } }),
    prisma.tugas.count({ where: { courseId: ctx.courseId } }),
    prisma.tugasSubmission.count({ where: { tugas: { courseId: ctx.courseId } } }),
  ]);
  return {
    course,
    kelas: classes.map((c) => ({ id: c.id, nama: c.name, roster: c._count.mahasiswas })),
    totalRoster: roster,
    totalTugas: tugasCount,
    totalSubmission: subCount,
  };
}

async function listSubmissions(
  ctx: ToolContext,
  args: { tugasId?: string; pertemuan?: number; title?: string; classId?: string; onlyUngraded?: boolean; onlyLate?: boolean },
): Promise<ToolResult> {
  const tugases = await resolveTugas(ctx, args);
  const out = [];
  for (const t of tugases) {
    const subs = await prisma.tugasSubmission.findMany({
      where: {
        tugasId: t.id,
        ...(args.classId ? { classId: args.classId } : {}),
        ...(args.onlyUngraded ? { nilai: null } : {}),
        ...(args.onlyLate ? { status: "LATE" } : {}),
      },
      orderBy: { position: "asc" },
      include: {
        class: { select: { name: true } },
        fileUpload: { select: { originalName: true, size: true } },
        analysis: { select: { aiScore: true, simMaxScore: true } },
      },
    });
    out.push({
      tugasId: t.id,
      title: t.title,
      pertemuan: t.pertemuan,
      jumlah: subs.length,
      submissions: subs.map((s) => ({
        id: s.id,
        no: s.position,
        nim: s.nim,
        nama: s.name,
        kelas: s.class.name,
        status: s.status,
        waktu: fmtDate(s.submittedAt),
        file: s.fileUpload?.originalName ?? null,
        adaCatatanMhs: Boolean(s.note?.trim()),
        nilai: s.nilai,
        huruf: nilaiToHuruf(s.nilai),
        feedback: s.feedback ? clip(s.feedback, 160) : null,
        indikasiAI: s.analysis?.aiScore ?? null,
        kemiripanMaks: s.analysis?.simMaxScore ?? null,
      })),
    });
  }
  return { hasil: out };
}

async function listMissing(
  ctx: ToolContext,
  args: { tugasId?: string; pertemuan?: number; title?: string; classId?: string },
): Promise<ToolResult> {
  const tugases = await resolveTugas(ctx, args);
  const out = [];
  for (const t of tugases) {
    const classFilter = args.classId ?? t.classId ?? undefined;
    const [roster, subs] = await Promise.all([
      prisma.mahasiswa.findMany({
        where: { courseId: ctx.courseId, ...(classFilter ? { classId: classFilter } : {}) },
        select: { nim: true, name: true, class: { select: { name: true } } },
        orderBy: [{ classId: "asc" }, { name: "asc" }],
      }),
      prisma.tugasSubmission.findMany({ where: { tugasId: t.id }, select: { nim: true } }),
    ]);
    const submitted = new Set(subs.map((s) => normalizeNim(s.nim)));
    const missing = roster.filter((m) => !submitted.has(normalizeNim(m.nim)));
    out.push({
      tugasId: t.id,
      title: t.title,
      pertemuan: t.pertemuan,
      deadline: fmtDate(t.deadline),
      rosterTotal: roster.length,
      sudahKumpul: roster.length - missing.length,
      belumKumpul: missing.length,
      daftarBelumKumpul: missing.map((m) => ({ nim: m.nim, nama: m.name, kelas: m.class?.name ?? "-" })),
      catatan: roster.length === 0 ? "Roster kosong — impor roster mahasiswa dulu agar daftar ini akurat." : undefined,
    });
  }
  return { hasil: out };
}

async function getStudentHistory(ctx: ToolContext, args: { nim?: string; name?: string }): Promise<ToolResult> {
  if (!args.nim && !args.name) throw new Error("Berikan nim atau name.");
  const subs = await prisma.tugasSubmission.findMany({
    where: {
      tugas: { courseId: ctx.courseId },
      ...(args.nim ? { nim: { contains: args.nim.trim(), mode: "insensitive" } } : {}),
      ...(args.name ? { name: { contains: args.name.trim(), mode: "insensitive" } } : {}),
    },
    orderBy: { tugas: { deadline: "asc" } },
    include: { tugas: { select: { id: true, title: true, pertemuan: true } }, class: { select: { name: true } } },
    take: 60,
  });
  const roster = await prisma.mahasiswa.findFirst({
    where: {
      courseId: ctx.courseId,
      ...(args.nim ? { nim: { contains: args.nim.trim(), mode: "insensitive" } } : {}),
      ...(args.name ? { name: { contains: args.name.trim(), mode: "insensitive" } } : {}),
    },
    select: { nim: true, name: true, email: true, class: { select: { name: true } } },
  });
  const nilaiList = subs.map((s) => s.nilai).filter((n): n is number => typeof n === "number");
  return {
    roster,
    totalSubmit: subs.length,
    rataNilai: nilaiList.length ? Math.round((nilaiList.reduce((a, b) => a + b, 0) / nilaiList.length) * 10) / 10 : null,
    riwayat: subs.map((s) => ({
      submissionId: s.id,
      tugasId: s.tugas.id,
      pertemuan: s.tugas.pertemuan,
      tugas: s.tugas.title,
      kelas: s.class.name,
      status: s.status,
      nilai: s.nilai,
      huruf: nilaiToHuruf(s.nilai),
      catatanMhs: s.note ? clip(s.note, 300) : null,
      feedback: s.feedback ? clip(s.feedback, 300) : null,
    })),
  };
}

async function getSubmissionContent(
  ctx: ToolContext,
  args: { submissionId: string; maxChars?: number; offset?: number },
): Promise<ToolResult> {
  const s = await submissionInCourse(ctx, args.submissionId);
  const t = await getSubmissionText(s.id);
  const maxChars = Math.min(Math.max(args.maxChars ?? 6000, 500), 20_000);
  const offset = Math.max(args.offset ?? 0, 0);
  const text = t?.text ?? "";
  const slice = text.slice(offset, offset + maxChars);
  return {
    submissionId: s.id,
    nim: s.nim,
    nama: s.name,
    kelas: s.class.name,
    tugas: s.tugas.title,
    pertemuan: s.tugas.pertemuan,
    status: s.status,
    file: s.fileUpload ? { nama: s.fileUpload.originalName, ukuran: s.fileUpload.size, mime: s.fileUpload.mime } : null,
    zip: t?.zipManifest
      ? { totalFile: t.zipManifest.totalEntries, stack: t.zipManifest.frameworks, ekstensi: t.zipManifest.extCounts, pohon: t.zipManifest.tree.slice(0, 60) }
      : null,
    totalKarakter: text.length,
    offset,
    isi: slice,
    adaLanjutan: offset + maxChars < text.length,
    errorEkstraksi: t?.extractError ?? null,
    nilaiSekarang: s.nilai,
    feedbackSekarang: s.feedback,
  };
}

async function setFeedback(
  ctx: ToolContext,
  args: { submissionId: string; feedback?: string; nilai?: number | null },
): Promise<ToolResult> {
  const s = await submissionInCourse(ctx, args.submissionId);
  if (args.feedback === undefined && args.nilai === undefined) throw new Error("Berikan feedback dan/atau nilai.");
  if (args.nilai !== undefined && args.nilai !== null && (args.nilai < 0 || args.nilai > 100 || !Number.isInteger(args.nilai))) {
    throw new Error("Nilai harus bilangan bulat 0-100.");
  }
  const now = new Date();
  const data: Record<string, unknown> = {};
  if (args.feedback !== undefined) {
    data.feedback = args.feedback.trim().slice(0, 4000);
    data.feedbackAt = now;
    data.feedbackById = ctx.adminId;
  }
  if (args.nilai !== undefined) {
    data.nilai = args.nilai;
    data.nilaiAt = args.nilai === null ? null : now;
    data.nilaiById = args.nilai === null ? null : ctx.adminId;
  }
  const updated = await prisma.tugasSubmission.update({ where: { id: s.id }, data, select: { nilai: true, feedback: true } });
  return { ok: true, submissionId: s.id, nim: s.nim, nama: s.name, nilai: updated.nilai, huruf: nilaiToHuruf(updated.nilai), feedback: updated.feedback };
}

async function rekapNilai(ctx: ToolContext, args: { classId?: string; tugasId?: string; pertemuan?: number }): Promise<ToolResult> {
  const tugases = args.tugasId || args.pertemuan
    ? await resolveTugas(ctx, args)
    : await prisma.tugas.findMany({ where: { courseId: ctx.courseId }, include: { class: true }, orderBy: [{ pertemuan: "asc" }, { deadline: "asc" }] });
  const roster = await prisma.mahasiswa.findMany({
    where: { courseId: ctx.courseId, ...(args.classId ? { classId: args.classId } : {}) },
    select: { nim: true, name: true, class: { select: { name: true } } },
    orderBy: [{ classId: "asc" }, { name: "asc" }],
  });
  const subs = await prisma.tugasSubmission.findMany({
    where: { tugasId: { in: tugases.map((t) => t.id) }, ...(args.classId ? { classId: args.classId } : {}) },
    select: { tugasId: true, nim: true, name: true, nilai: true, status: true, feedback: true },
  });
  const byNim = new Map<string, typeof subs>();
  for (const s of subs) {
    const k = normalizeNim(s.nim);
    byNim.set(k, [...(byNim.get(k) || []), s]);
  }
  // Baris untuk roster + submitter yang tidak ada di roster.
  const names = new Map(roster.map((r) => [normalizeNim(r.nim), { nim: r.nim, nama: r.name, kelas: r.class?.name ?? "-" }]));
  for (const s of subs) {
    const k = normalizeNim(s.nim);
    if (!names.has(k)) names.set(k, { nim: s.nim, nama: s.name, kelas: "(tidak di roster)" });
  }
  const rows = [...names.entries()].map(([k, info]) => {
    const mine = byNim.get(k) || [];
    const perTugas = tugases.map((t) => {
      const s = mine.find((x) => x.tugasId === t.id);
      return { pertemuan: t.pertemuan, nilai: s ? s.nilai : null, status: s ? s.status : "BELUM" };
    });
    const nilaiList = perTugas.map((p) => p.nilai).filter((n): n is number => typeof n === "number");
    const rata = nilaiList.length ? Math.round((nilaiList.reduce((a, b) => a + b, 0) / nilaiList.length) * 10) / 10 : null;
    return { ...info, kumpul: mine.length, dariTugas: tugases.length, dinilai: nilaiList.length, rataRata: rata, huruf: nilaiToHuruf(rata === null ? null : Math.round(rata)), perTugas };
  });
  return {
    tugas: tugases.map((t) => ({ id: t.id, pertemuan: t.pertemuan, title: t.title })),
    jumlahMahasiswa: rows.length,
    rekap: rows,
  };
}

async function compareSimilarity(ctx: ToolContext, args: { tugasId?: string; pertemuan?: number; title?: string; minScore?: number }): Promise<ToolResult> {
  const [t] = await resolveTugas(ctx, args);
  const texts = await getTugasSubmissionTexts(t.id);
  const docs = texts.filter((x) => x.text.trim().length > 0).map((x) => ({ id: x.submissionId, text: x.text }));
  const pairs = compareAll(docs, args.minScore ?? 40);
  const info = new Map(texts.map((x) => [x.submissionId, `${x.name} (${x.nim})`]));

  // Simpan ke SubmissionAnalysis (sim fields)
  const maxBy = new Map<string, { score: number; with: string }>();
  for (const p of pairs) {
    for (const [me, other] of [[p.aId, p.bId], [p.bId, p.aId]] as const) {
      const cur = maxBy.get(me);
      if (!cur || p.score > cur.score) maxBy.set(me, { score: p.score, with: other });
    }
  }
  await Promise.all(
    docs.map((d) =>
      prisma.submissionAnalysis.upsert({
        where: { submissionId: d.id },
        create: {
          submissionId: d.id,
          textHash: textHash(d.text),
          wordCount: d.text.split(/\s+/).length,
          simMaxScore: maxBy.get(d.id)?.score ?? 0,
          simWithId: maxBy.get(d.id)?.with ?? null,
          simPairs: pairs.filter((p) => p.aId === d.id || p.bId === d.id).slice(0, 10) as unknown as object,
        },
        update: {
          textHash: textHash(d.text),
          wordCount: d.text.split(/\s+/).length,
          simMaxScore: maxBy.get(d.id)?.score ?? 0,
          simWithId: maxBy.get(d.id)?.with ?? null,
          simPairs: pairs.filter((p) => p.aId === d.id || p.bId === d.id).slice(0, 10) as unknown as object,
          analyzedAt: new Date(),
        },
      }),
    ),
  );

  return {
    tugas: t.title,
    dibandingkan: docs.length,
    dilewati: texts.length - docs.length,
    pasanganMencurigakan: pairs.slice(0, 30).map((p) => ({
      a: { id: p.aId, siapa: info.get(p.aId) },
      b: { id: p.bId, siapa: info.get(p.bId) },
      skor: p.score,
      identik: p.identical,
      keterangan: p.identical ? "SAMA PERSIS" : p.score >= 80 ? "hampir sama" : p.score >= 60 ? "sangat mirip" : "mirip sebagian",
    })),
    catatan: "Skor 0-100 gabungan Jaccard 5-gram + cosine TF. Kode template/soal yang sama bisa menaikkan skor; konfirmasi manual.",
  };
}

async function detectAI(ctx: ToolContext, args: { submissionId?: string; tugasId?: string; pertemuan?: number }): Promise<ToolResult> {
  let ids: string[] = [];
  if (args.submissionId) {
    ids = [(await submissionInCourse(ctx, args.submissionId)).id];
  } else {
    const [t] = await resolveTugas(ctx, args);
    ids = (await prisma.tugasSubmission.findMany({ where: { tugasId: t.id }, select: { id: true }, orderBy: { position: "asc" } })).map((x) => x.id);
  }
  const results = [];
  for (const id of ids) {
    const t = await getSubmissionText(id);
    if (!t) continue;
    const r = detectAiIndication(t.text);
    await prisma.submissionAnalysis.upsert({
      where: { submissionId: id },
      create: { submissionId: id, textHash: textHash(t.text), wordCount: r.signals.wordCount, aiScore: r.label === "tidak-dapat-dinilai" ? null : r.score, aiSignals: { ...r.signals, notes: r.notes } as object },
      update: { aiScore: r.label === "tidak-dapat-dinilai" ? null : r.score, aiSignals: { ...r.signals, notes: r.notes } as object, wordCount: r.signals.wordCount, analyzedAt: new Date() },
    });
    results.push({ submissionId: id, siapa: `${t.name} (${t.nim})`, skor: r.score, label: r.label, alasan: r.notes.slice(0, -1), kata: r.signals.wordCount });
  }
  return {
    hasil: results.sort((a, b) => b.skor - a.skor),
    catatan: "Indikasi statistik (gaya tulisan), bukan bukti penggunaan AI. Jangan menjatuhkan sanksi hanya dari skor ini.",
  };
}

async function getMaterials(ctx: ToolContext): Promise<ToolResult> {
  // Materi disimpan filesystem; cukup daftar nama (lihat course-materials.ts).
  try {
    const { listCourseMaterials } = await import("@/lib/storage/course-materials");
    const list = await listCourseMaterials(ctx.courseId);
    return { jumlah: list.length, materi: list.map((m) => ({ id: m.id, nama: m.originalName, ukuran: m.size })) };
  } catch {
    return { jumlah: 0, materi: [], catatan: "Daftar materi tidak tersedia." };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolFn = (ctx: ToolContext, args: any) => Promise<ToolResult>;

export const TOOL_IMPL: Record<string, ToolFn> = {
  getCourseOverview: (ctx) => getCourseOverview(ctx),
  listTugas: (ctx) => listTugas(ctx),
  listSubmissions,
  listMissing,
  getStudentHistory,
  getSubmissionContent,
  setFeedback,
  rekapNilai,
  compareSimilarity,
  detectAI,
  getMaterials: (ctx) => getMaterials(ctx),
};

const tugasSelector = {
  tugasId: { type: "string", description: "ID tugas (lebih akurat)." },
  pertemuan: { type: "integer", description: "Nomor pertemuan, alternatif tugasId." },
  title: { type: "string", description: "Potongan judul tugas, alternatif tugasId." },
} as const;

export const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "getCourseOverview", description: "Ringkasan course: kelas, jumlah roster, jumlah tugas & submission.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "listTugas", description: "Daftar semua tugas di course beserta pertemuan, deadline, jumlah submit.", parameters: { type: "object", properties: {} } } },
  {
    type: "function",
    function: {
      name: "listSubmissions",
      description: "Daftar pengumpulan untuk satu tugas (ringkas: nim, nama, status, nilai, indikasi). Pakai filter onlyUngraded untuk yang belum dinilai.",
      parameters: { type: "object", properties: { ...tugasSelector, classId: { type: "string" }, onlyUngraded: { type: "boolean" }, onlyLate: { type: "boolean" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "listMissing",
      description: "Mahasiswa di roster yang BELUM mengumpulkan untuk tugas/pertemuan tertentu. Tanpa selector → semua tugas.",
      parameters: { type: "object", properties: { ...tugasSelector, classId: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "getStudentHistory",
      description: "Riwayat satu mahasiswa: semua pengumpulan, catatan mahasiswa, feedback, nilai, rata-rata.",
      parameters: { type: "object", properties: { nim: { type: "string" }, name: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "getSubmissionContent",
      description: "Baca isi pengumpulan (catatan + isi file PDF/DOCX/ZIP yang sudah diekstrak). Gunakan offset untuk membaca lanjutan. Default 6000 karakter — minta lebih hanya jika perlu.",
      parameters: { type: "object", properties: { submissionId: { type: "string" }, maxChars: { type: "integer" }, offset: { type: "integer" } }, required: ["submissionId"] },
    },
  },
  {
    type: "function",
    function: {
      name: "setFeedback",
      description: "Simpan feedback (catatan admin, terlihat mahasiswa) dan/atau nilai 0-100 untuk satu pengumpulan. nilai=null menghapus nilai.",
      parameters: { type: "object", properties: { submissionId: { type: "string" }, feedback: { type: "string" }, nilai: { type: ["integer", "null"] } }, required: ["submissionId"] },
    },
  },
  {
    type: "function",
    function: {
      name: "rekapNilai",
      description: "Rekap nilai per mahasiswa (per tugas + rata-rata + huruf). Bisa difilter kelas/tugas.",
      parameters: { type: "object", properties: { ...tugasSelector, classId: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "compareSimilarity",
      description: "Deteksi pengumpulan yang mirip/sama persis antar mahasiswa dalam satu tugas (lokal, tanpa AI). Hasil tersimpan.",
      parameters: { type: "object", properties: { ...tugasSelector, minScore: { type: "integer", description: "Ambang skor 0-100, default 40." } } },
    },
  },
  {
    type: "function",
    function: {
      name: "detectAI",
      description: "Indikasi tulisan AI (heuristik gaya) untuk satu submission atau semua submission satu tugas. Hasil = indikasi, bukan bukti.",
      parameters: { type: "object", properties: { submissionId: { type: "string" }, ...tugasSelector } },
    },
  },
  { type: "function", function: { name: "getMaterials", description: "Daftar materi (PPT/PDF) yang diunggah admin untuk course.", parameters: { type: "object", properties: {} } } },
  {
    type: "function",
    function: {
      name: "askUser",
      description: "Tanyakan ke admin bila konteks untuk mengoreksi tidak cukup (mis. rubrik, bobot, kriteria lulus). Hentikan proses sampai admin menjawab. Gunakan hemat — gabungkan beberapa pertanyaan sekaligus.",
      parameters: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["question"] },
    },
  },
];

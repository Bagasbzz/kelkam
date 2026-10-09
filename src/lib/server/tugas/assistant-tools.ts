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
import fs from "node:fs/promises";
import { prisma } from "@/lib/db/prisma";
import { nilaiToHuruf } from "@/lib/server/tugas/serialize";
import { normalizeNim } from "@/lib/server/tugas/pertemuan";
import { getOrExtractFileText, getSubmissionText, getTugasSubmissionTexts } from "@/lib/server/tugas/submission-text";
import { compareAll, detectAiIndication, textHash } from "@/lib/server/tugas/text-analysis";
import { extractTextFromBuffer, readZipEntries, readZipEntry } from "@/lib/server/extract-text";
import { exportDocxForUser, type DocxSection } from "@/lib/server/tugas/export-docx";

export interface ToolContext {
  courseId: string;
  adminId: string;
  /** Lampiran (file hasil ekspor) yang dikumpulkan selama 1 giliran. */
  attachments?: Array<{ fileId: string; name: string; url: string; size: number }>;
}

export type ToolResult = Record<string, unknown>;

const fmtDate = (d: Date) =>
  d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[...dipotong, total ${s.length} karakter]` : s);

/** Selisih submittedAt - deadline dalam menit (>0 = terlambat) + label manusiawi. */
function lateness(submittedAt: Date, deadline: Date) {
  const menit = Math.round((submittedAt.getTime() - deadline.getTime()) / 60_000);
  const abs = Math.abs(menit);
  const label = abs >= 1440 ? `${Math.floor(abs / 1440)} hari ${Math.floor((abs % 1440) / 60)} jam` : abs >= 60 ? `${Math.floor(abs / 60)} jam ${abs % 60} menit` : `${abs} menit`;
  return { terlambatMenit: menit > 0 ? menit : 0, keterlambatan: menit > 0 ? `terlambat ${label}` : `lebih awal ${label}` };
}

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
      deskripsi: clip(t.description, 400),
      kelas: t.class?.name ?? "semua",
      deadline: fmtDate(t.deadline),
      lewat: t.deadline < new Date(),
      jumlahSubmit: t._count.submissions,
    })),
  };
}

async function getTugasDetail(ctx: ToolContext, args: { tugasId?: string; pertemuan?: number; title?: string }): Promise<ToolResult> {
  const tugases = await resolveTugas(ctx, args);
  const course = await prisma.course.findUnique({ where: { id: ctx.courseId }, select: { name: true, description: true } });
  const now = new Date();
  return {
    course: { nama: course?.name, deskripsi: course?.description ?? null },
    tugas: await Promise.all(tugases.map(async (t) => {
      const agg = await prisma.tugasSubmission.groupBy({ by: ["status"], where: { tugasId: t.id }, _count: { _all: true } });
      return {
        id: t.id,
        pertemuan: t.pertemuan,
        title: t.title,
        deskripsiLengkap: t.description,
        kelas: t.class?.name ?? "semua kelas",
        classId: t.classId,
        deadline: fmtDate(t.deadline),
        deadlineISO: t.deadline.toISOString(),
        sudahLewat: t.deadline < now,
        dibuat: fmtDate(t.createdAt),
        jumlahPerStatus: Object.fromEntries(agg.map((a) => [a.status, a._count._all])),
      };
    })),
  };
}

/** Bundel konteks course dalam 1 panggilan: deskripsi, kelas, semua tugas (dengan deskripsi), materi, statistik. */
async function getCourseContext(ctx: ToolContext): Promise<ToolResult> {
  const [course, classes, tugases, rosterCount, subCount, enrollCount] = await Promise.all([
    prisma.course.findUnique({ where: { id: ctx.courseId }, select: { name: true, code: true, description: true, createdAt: true } }),
    prisma.courseClass.findMany({ where: { courseId: ctx.courseId }, select: { id: true, name: true, _count: { select: { mahasiswas: true } } } }),
    prisma.tugas.findMany({ where: { courseId: ctx.courseId }, orderBy: [{ pertemuan: "asc" }, { deadline: "asc" }], include: { class: { select: { name: true } }, _count: { select: { submissions: true } } } }),
    prisma.mahasiswa.count({ where: { courseId: ctx.courseId } }),
    prisma.tugasSubmission.count({ where: { tugas: { courseId: ctx.courseId } } }),
    prisma.courseEnrollment.count({ where: { courseId: ctx.courseId } }),
  ]);
  let materi: Array<{ id: string; nama: string; ukuran: number }> = [];
  try {
    const { listCourseMaterials } = await import("@/lib/storage/course-materials");
    materi = (await listCourseMaterials(ctx.courseId)).map((m) => ({ id: m.id, nama: m.originalName, ukuran: m.size }));
  } catch { /* opsional */ }
  const now = new Date();
  return {
    course: course ? { nama: course.name, kode: course.code, deskripsi: course.description ?? null } : null,
    kelas: classes.map((c) => ({ id: c.id, nama: c.name, roster: c._count.mahasiswas })),
    statistik: { roster: rosterCount, akunTerdaftar: enrollCount, totalTugas: tugases.length, totalSubmission: subCount },
    tugas: tugases.map((t) => ({
      id: t.id, pertemuan: t.pertemuan, title: t.title, deskripsi: clip(t.description, 700), kelas: t.class?.name ?? "semua",
      deadline: fmtDate(t.deadline), sudahLewat: t.deadline < now, jumlahSubmit: t._count.submissions,
    })),
    materi,
    catatan: "Gunakan getTugasDetail untuk deskripsi lengkap tugas, getMaterialContent untuk isi materi (PPTX/PDF).",
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
  args: { tugasId?: string; pertemuan?: number; title?: string; classId?: string; onlyUngraded?: boolean; onlyLate?: boolean; includeNotes?: boolean },
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
        user: { select: { email: true } },
        fileUpload: { select: { originalName: true, size: true } },
        analysis: { select: { aiScore: true, simMaxScore: true } },
      },
    });
    const lateCount = subs.filter((s) => s.submittedAt > t.deadline).length;
    out.push({
      tugasId: t.id,
      title: t.title,
      pertemuan: t.pertemuan,
      deadline: fmtDate(t.deadline),
      jumlah: subs.length,
      terlambat: lateCount,
      tepatWaktu: subs.length - lateCount,
      submissions: subs.map((s) => ({
        id: s.id,
        no: s.position,
        nim: s.nim,
        nama: s.name,
        email: s.user?.email ?? null,
        kelas: s.class.name,
        status: s.status,
        waktu: fmtDate(s.submittedAt),
        ...lateness(s.submittedAt, t.deadline),
        diubah: s.updatedAt ? fmtDate(s.updatedAt) : null,
        file: s.fileUpload?.originalName ?? null,
        catatanMhs: s.note?.trim() ? (args.includeNotes ? clip(s.note.trim(), 600) : clip(s.note.trim(), 120)) : null,
        nilai: s.nilai,
        huruf: nilaiToHuruf(s.nilai),
        feedback: s.feedback ? clip(s.feedback, args.includeNotes ? 600 : 160) : null,
        feedbackAt: s.feedbackAt ? fmtDate(s.feedbackAt) : null,
        indikasiAI: s.analysis?.aiScore ?? null,
        kemiripanMaks: s.analysis?.simMaxScore ?? null,
      })),
    });
  }
  return { hasil: out };
}

/** Analisis keterlambatan: per tugas / per kelas / per mahasiswa. */
async function analyzeLateness(ctx: ToolContext, args: { tugasId?: string; pertemuan?: number; title?: string; classId?: string }): Promise<ToolResult> {
  const tugases = args.tugasId || args.pertemuan || args.title
    ? await resolveTugas(ctx, args)
    : await prisma.tugas.findMany({ where: { courseId: ctx.courseId }, include: { class: { select: { id: true, name: true } } }, orderBy: [{ pertemuan: "asc" }, { deadline: "asc" }] });
  const subs = await prisma.tugasSubmission.findMany({
    where: { tugasId: { in: tugases.map((t) => t.id) }, ...(args.classId ? { classId: args.classId } : {}) },
    select: { id: true, tugasId: true, nim: true, name: true, submittedAt: true, status: true, class: { select: { name: true } } },
  });
  const perMhs = new Map<string, { nim: string; nama: string; kelas: string; total: number; terlambat: number; totalMenitTerlambat: number }>();
  const perTugas = tugases.map((t) => {
    const mine = subs.filter((s) => s.tugasId === t.id);
    const late = mine.filter((s) => s.submittedAt > t.deadline).map((s) => ({ ...s, ...lateness(s.submittedAt, t.deadline) }));
    for (const s of mine) {
      const k = normalizeNim(s.nim);
      const cur = perMhs.get(k) ?? { nim: s.nim, nama: s.name, kelas: s.class.name, total: 0, terlambat: 0, totalMenitTerlambat: 0 };
      cur.total++;
      const l = lateness(s.submittedAt, t.deadline);
      if (l.terlambatMenit > 0) { cur.terlambat++; cur.totalMenitTerlambat += l.terlambatMenit; }
      perMhs.set(k, cur);
    }
    const menit = late.map((l) => l.terlambatMenit);
    return {
      tugasId: t.id, pertemuan: t.pertemuan, title: t.title, deadline: fmtDate(t.deadline),
      kumpul: mine.length, tepatWaktu: mine.length - late.length, terlambat: late.length,
      rataTerlambatMenit: menit.length ? Math.round(menit.reduce((a, b) => a + b, 0) / menit.length) : 0,
      paling: late.sort((a, b) => b.terlambatMenit - a.terlambatMenit).slice(0, 10).map((l) => ({ submissionId: l.id, nim: l.nim, nama: l.name, kelas: l.class.name, waktu: fmtDate(l.submittedAt), keterlambatan: l.keterlambatan })),
    };
  });
  const seringTerlambat = [...perMhs.values()].filter((m) => m.terlambat > 0).sort((a, b) => b.terlambat - a.terlambat || b.totalMenitTerlambat - a.totalMenitTerlambat).slice(0, 25);
  return { perTugas, seringTerlambat, catatan: "Waktu dalam zona Asia/Jakarta. Status LATE ditentukan saat submit; kolom terlambat dihitung ulang dari deadline saat ini." };
}

/** Daftar mahasiswa: roster + akun user yang terdaftar (enrollment) + pencocokan. */
async function listStudents(ctx: ToolContext, args: { classId?: string; query?: string }): Promise<ToolResult> {
  const q = args.query?.trim();
  const [roster, enrollments, subUsers] = await Promise.all([
    prisma.mahasiswa.findMany({
      where: {
        courseId: ctx.courseId,
        ...(args.classId ? { classId: args.classId } : {}),
        ...(q ? { OR: [{ nim: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
      },
      select: { nim: true, name: true, email: true, class: { select: { name: true } } },
      orderBy: [{ classId: "asc" }, { name: "asc" }],
    }),
    prisma.courseEnrollment.findMany({
      where: { courseId: ctx.courseId },
      select: { enrolledAt: true, user: { select: { id: true, email: true, name: true } } },
      orderBy: { enrolledAt: "asc" },
    }),
    prisma.tugasSubmission.findMany({
      where: { tugas: { courseId: ctx.courseId } },
      select: { userId: true, nim: true, name: true, class: { select: { name: true } }, submittedAt: true },
      orderBy: { submittedAt: "desc" },
    }),
  ]);
  // userId → identitas yang dipakai saat submit (nim/nama terakhir)
  const identByUser = new Map<string, { nim: string; nama: string; kelas: string; jumlahSubmit: number; terakhirSubmit: Date }>();
  for (const s of subUsers) {
    const cur = identByUser.get(s.userId);
    if (cur) cur.jumlahSubmit++;
    else identByUser.set(s.userId, { nim: s.nim, nama: s.name, kelas: s.class.name, jumlahSubmit: 1, terakhirSubmit: s.submittedAt });
  }
  const rosterNims = new Set(roster.map((r) => normalizeNim(r.nim)));
  const akun = enrollments
    .map((e) => {
      const ident = identByUser.get(e.user.id);
      return {
        userId: e.user.id, email: e.user.email, namaAkun: e.user.name, bergabung: fmtDate(e.enrolledAt),
        nim: ident?.nim ?? null, namaSubmit: ident?.nama ?? null, kelas: ident?.kelas ?? null,
        jumlahSubmit: ident?.jumlahSubmit ?? 0, terakhirSubmit: ident ? fmtDate(ident.terakhirSubmit) : null,
        adaDiRoster: ident ? rosterNims.has(normalizeNim(ident.nim)) : null,
      };
    })
    .filter((a) => !q || [a.email, a.namaAkun, a.nim, a.namaSubmit].some((v) => v?.toLowerCase().includes(q.toLowerCase())));
  const nimWithAccount = new Set([...identByUser.values()].map((i) => normalizeNim(i.nim)));
  return {
    roster: roster.map((r) => ({ nim: r.nim, nama: r.name, email: r.email, kelas: r.class?.name ?? "-", punyaAkunAktif: nimWithAccount.has(normalizeNim(r.nim)) })),
    akun: akun.slice(0, 300),
    ringkasan: { roster: roster.length, akunTerdaftar: enrollments.length, akunBelumPernahSubmit: akun.filter((a) => a.jumlahSubmit === 0).length, rosterTanpaAkun: roster.filter((r) => !nimWithAccount.has(normalizeNim(r.nim))).length },
  };
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
    include: { tugas: { select: { id: true, title: true, pertemuan: true, deadline: true } }, class: { select: { name: true } }, user: { select: { email: true } }, fileUpload: { select: { originalName: true } } },
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
    akunEmail: subs[0]?.user?.email ?? null,
    totalSubmit: subs.length,
    totalTerlambat: subs.filter((s) => s.submittedAt > s.tugas.deadline).length,
    rataNilai: nilaiList.length ? Math.round((nilaiList.reduce((a, b) => a + b, 0) / nilaiList.length) * 10) / 10 : null,
    riwayat: subs.map((s) => ({
      submissionId: s.id,
      tugasId: s.tugas.id,
      pertemuan: s.tugas.pertemuan,
      tugas: s.tugas.title,
      kelas: s.class.name,
      status: s.status,
      waktu: fmtDate(s.submittedAt),
      ...lateness(s.submittedAt, s.tugas.deadline),
      file: s.fileUpload?.originalName ?? null,
      nilai: s.nilai,
      huruf: nilaiToHuruf(s.nilai),
      catatanMhs: s.note ? clip(s.note, 500) : null,
      feedback: s.feedback ? clip(s.feedback, 500) : null,
      feedbackAt: s.feedbackAt ? fmtDate(s.feedbackAt) : null,
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

/** Baca buffer file pengumpulan dari disk (sudah diverifikasi course). */
async function submissionBuffer(ctx: ToolContext, submissionId: string) {
  const s = await submissionInCourse(ctx, submissionId);
  if (!s.fileUploadId) throw new Error("Pengumpulan ini tidak memiliki file.");
  const file = await prisma.fileUpload.findUnique({ where: { id: s.fileUploadId }, select: { filePath: true, originalName: true } });
  if (!file) throw new Error("File tidak ditemukan.");
  const buffer = await fs.readFile(file.filePath);
  return { s, buffer, originalName: file.originalName };
}

/** Baca satu file di dalam ZIP pengumpulan secara utuh (mis. main.py). */
async function readSubmissionFile(ctx: ToolContext, args: { submissionId: string; path: string; maxChars?: number }): Promise<ToolResult> {
  if (!args.path?.trim()) throw new Error("Berikan path file di dalam ZIP (lihat pohon di getSubmissionContent).");
  const { s, buffer, originalName } = await submissionBuffer(ctx, args.submissionId);
  if (!/\.zip$/i.test(originalName) && !(buffer[0] === 0x50 && buffer[1] === 0x4b && !/\.(docx|pptx|xlsx)$/i.test(originalName))) {
    throw new Error("File pengumpulan bukan ZIP. Gunakan getSubmissionContent.");
  }
  const r = await readZipEntry(buffer, args.path, Math.min(Math.max(args.maxChars ?? 20_000, 500), 60_000));
  return { submissionId: s.id, nim: s.nim, nama: s.name, file: r.path, ukuran: r.size, terpotong: r.truncated, isi: r.content };
}

/** Isi materi (PPTX/PDF/DOCX) yang diunggah admin. */
async function getMaterialContent(ctx: ToolContext, args: { materialId: string; maxChars?: number; offset?: number }): Promise<ToolResult> {
  const { readCourseMaterial } = await import("@/lib/storage/course-materials");
  const found = await readCourseMaterial(ctx.courseId, args.materialId);
  if (!found) throw new Error("Materi tidak ditemukan. Gunakan getMaterials untuk melihat daftar.");
  const { material, buffer } = found;
  const maxChars = Math.min(Math.max(args.maxChars ?? 8000, 500), 30_000);
  const offset = Math.max(args.offset ?? 0, 0);
  let text = "";
  let error: string | null = null;
  try {
    const r = await extractTextFromBuffer(buffer, material.originalName, { maxChars: 80_000 });
    text = r.content;
  } catch (err) {
    error = err instanceof Error && "publicMessage" in err ? String((err as { publicMessage: string }).publicMessage) : "Materi tidak bisa dibaca sebagai teks.";
  }
  return {
    materialId: material.id, nama: material.originalName, ukuran: material.size, diunggah: material.uploadedAt,
    totalKarakter: text.length, offset, isi: text.slice(offset, offset + maxChars), adaLanjutan: offset + maxChars < text.length, error,
  };
}

const MAX_EXPORT_SUBMISSIONS = 25;

/**
 * Ekspor isi pengumpulan ke DOCX yang bisa diunduh admin:
 * catatan mahasiswa + isi dokumen + seluruh file kode (dari ZIP).
 */
async function exportSubmissionDocx(
  ctx: ToolContext,
  args: { submissionId?: string; tugasId?: string; pertemuan?: number; title?: string; classId?: string; includeCode?: boolean; includeDocs?: boolean; onlyPaths?: string[]; fileName?: string },
): Promise<ToolResult> {
  const includeCode = args.includeCode ?? true;
  const includeDocs = args.includeDocs ?? true;
  let targets: string[] = [];
  let judul = "";
  if (args.submissionId) {
    const s = await submissionInCourse(ctx, args.submissionId);
    targets = [s.id];
    judul = `${s.tugas.title} — ${s.name} (${s.nim})`;
  } else {
    const [t] = await resolveTugas(ctx, args);
    const subs = await prisma.tugasSubmission.findMany({ where: { tugasId: t.id, ...(args.classId ? { classId: args.classId } : {}) }, select: { id: true }, orderBy: { position: "asc" } });
    if (subs.length > MAX_EXPORT_SUBMISSIONS) throw new Error(`Terlalu banyak pengumpulan (${subs.length}). Maksimal ${MAX_EXPORT_SUBMISSIONS} per ekspor; filter per kelas atau per mahasiswa.`);
    targets = subs.map((x) => x.id);
    judul = `${t.title}${t.pertemuan ? ` (Pertemuan ${t.pertemuan})` : ""} — Kumpulan Pengumpulan`;
  }
  if (!targets.length) throw new Error("Tidak ada pengumpulan untuk diekspor.");

  const sections: DocxSection[] = [];
  for (const id of targets) {
    const s = await submissionInCourse(ctx, id);
    const head = `${s.name} (${s.nim}) — ${s.class.name}`;
    const meta = `Dikumpulkan: ${fmtDate(s.submittedAt)} (${lateness(s.submittedAt, s.tugas.deadline).keterlambatan}) • Status: ${s.status} • Nilai: ${s.nilai ?? "-"}${s.feedback ? `\nFeedback: ${s.feedback}` : ""}`;
    sections.push({ title: head, content: meta });
    if (s.note?.trim()) sections.push({ title: `Catatan mahasiswa — ${s.name}`, content: s.note.trim() });
    if (!s.fileUploadId) continue;
    const file = await prisma.fileUpload.findUnique({ where: { id: s.fileUploadId }, select: { filePath: true, originalName: true } });
    if (!file) continue;
    const isZip = /\.zip$/i.test(file.originalName);
    if (isZip) {
      let buffer: Buffer;
      try { buffer = await fs.readFile(file.filePath); } catch { sections.push({ title: `File — ${file.originalName}`, content: "[file tidak ditemukan di penyimpanan]" }); continue; }
      const entries = await readZipEntries(buffer, { paths: args.onlyPaths, maxFiles: 40, maxCharsPerFile: 30_000 });
      for (const e of entries) {
        if (e.kind === "doc" && !includeDocs) continue;
        if (e.kind === "code" && !includeCode) continue;
        sections.push({ title: `${e.kind === "doc" ? "Dokumen" : "Kode"}: ${e.path}${e.truncated ? " (dipotong)" : ""}`, kind: e.kind === "doc" ? "text" : "code", content: e.content });
      }
    } else if (includeDocs) {
      try {
        const ex = await getOrExtractFileText(s.fileUploadId);
        if (ex) sections.push({ title: `Dokumen: ${file.originalName}`, kind: ex.kind === "code" ? "code" : "text", content: ex.text });
      } catch {
        sections.push({ title: `Dokumen: ${file.originalName}`, content: "[format tidak bisa dibaca sebagai teks]" });
      }
    }
  }
  const out = await exportDocxForUser(ctx.adminId, args.fileName ?? judul, { title: judul, subtitle: `Diekspor ${fmtDate(new Date())} oleh Asisten Dosen`, sections });
  ctx.attachments?.push(out);
  return { ok: true, ...out, jumlahPengumpulan: targets.length, jumlahBagian: sections.length, catatan: "Beritahu admin bahwa file siap diunduh (tautan sudah ditampilkan otomatis di chat)." };
}

/** Ekspor laporan/teks buatan asisten (markdown sederhana) ke DOCX. */
async function exportReportDocx(ctx: ToolContext, args: { title: string; markdown: string; fileName?: string }): Promise<ToolResult> {
  if (!args.title?.trim() || !args.markdown?.trim()) throw new Error("Berikan title dan markdown.");
  const sections: DocxSection[] = [];
  let current: DocxSection = { title: "Ringkasan", content: "" };
  for (const line of args.markdown.replace(/\r/g, "").split("\n")) {
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    if (h) {
      if (current.content.trim()) sections.push(current);
      current = { title: h[1].trim(), content: "" };
    } else {
      current.content += `${line.replace(/^\s*[-*]\s+/, "• ").replace(/\*\*/g, "")}\n`;
    }
  }
  if (current.content.trim()) sections.push(current);
  const out = await exportDocxForUser(ctx.adminId, args.fileName ?? args.title, { title: args.title.trim(), subtitle: `Dibuat ${fmtDate(new Date())} oleh Asisten Dosen`, sections });
  ctx.attachments?.push(out);
  return { ok: true, ...out };
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
  getCourseContext: (ctx) => getCourseContext(ctx),
  listTugas: (ctx) => listTugas(ctx),
  getTugasDetail,
  listSubmissions,
  listMissing,
  analyzeLateness,
  listStudents,
  getStudentHistory,
  getSubmissionContent,
  readSubmissionFile,
  setFeedback,
  rekapNilai,
  compareSimilarity,
  detectAI,
  getMaterials: (ctx) => getMaterials(ctx),
  getMaterialContent,
  exportSubmissionDocx,
  exportReportDocx,
};

const tugasSelector = {
  tugasId: { type: "string", description: "ID tugas (lebih akurat)." },
  pertemuan: { type: "integer", description: "Nomor pertemuan, alternatif tugasId." },
  title: { type: "string", description: "Potongan judul tugas, alternatif tugasId." },
} as const;

export const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "getCourseOverview", description: "Ringkasan singkat course: kelas, jumlah roster, jumlah tugas & submission.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "getCourseContext", description: "KONTEKS LENGKAP course dalam 1 panggilan: deskripsi course, kelas, SEMUA tugas beserta deskripsi & deadline, daftar materi, statistik. Panggil ini dulu di awal percakapan.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "listTugas", description: "Daftar semua tugas di course beserta pertemuan, deskripsi singkat, deadline, jumlah submit.", parameters: { type: "object", properties: {} } } },
  {
    type: "function",
    function: {
      name: "getTugasDetail",
      description: "Deskripsi LENGKAP sebuah tugas (instruksi/soal yang diberikan ke mahasiswa), deadline, kelas, jumlah per status. WAJIB dibaca sebelum menilai kesesuaian pengumpulan.",
      parameters: { type: "object", properties: { ...tugasSelector } },
    },
  },
  {
    type: "function",
    function: {
      name: "listSubmissions",
      description: "Daftar pengumpulan satu tugas: nim, nama, email akun, kelas, status, waktu kumpul, keterlambatan (menit & label), file, catatan mahasiswa, nilai, feedback, indikasi. includeNotes=true untuk catatan/feedback lebih panjang.",
      parameters: { type: "object", properties: { ...tugasSelector, classId: { type: "string" }, onlyUngraded: { type: "boolean" }, onlyLate: { type: "boolean" }, includeNotes: { type: "boolean" } } },
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
      name: "analyzeLateness",
      description: "Analisis keterlambatan: per tugas (tepat waktu vs terlambat, rata-rata, paling telat) dan mahasiswa yang sering terlambat. Tanpa selector → semua tugas.",
      parameters: { type: "object", properties: { ...tugasSelector, classId: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "listStudents",
      description: "Semua mahasiswa: roster (nim, nama, email, kelas) + akun user yang bergabung ke course (email, nama akun, nim yang dipakai, jumlah submit, ada di roster atau tidak). query untuk cari nama/nim/email.",
      parameters: { type: "object", properties: { classId: { type: "string" }, query: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "getStudentHistory",
      description: "Riwayat satu mahasiswa: semua pengumpulan, waktu & keterlambatan, catatan mahasiswa, feedback dosen, nilai, rata-rata.",
      parameters: { type: "object", properties: { nim: { type: "string" }, name: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "getSubmissionContent",
      description: "Baca isi pengumpulan (catatan + isi file PDF/DOCX/PPTX/ZIP yang sudah diekstrak; ZIP memberi pohon file + cuplikan tiap file kode). Gunakan offset untuk lanjutan. Untuk membaca satu file kode secara UTUH di dalam ZIP gunakan readSubmissionFile.",
      parameters: { type: "object", properties: { submissionId: { type: "string" }, maxChars: { type: "integer" }, offset: { type: "integer" } }, required: ["submissionId"] },
    },
  },
  {
    type: "function",
    function: {
      name: "readSubmissionFile",
      description: "Baca SATU file di dalam ZIP pengumpulan secara utuh (mis. path 'main.py' atau 'src/app.js'; DOCX/PDF/PPTX di dalam ZIP juga bisa). Pakai untuk review kode detail.",
      parameters: { type: "object", properties: { submissionId: { type: "string" }, path: { type: "string" }, maxChars: { type: "integer" } }, required: ["submissionId", "path"] },
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
  { type: "function", function: { name: "getMaterials", description: "Daftar materi pertemuan (PPTX/PDF) yang diunggah admin untuk course.", parameters: { type: "object", properties: {} } } },
  {
    type: "function",
    function: {
      name: "getMaterialContent",
      description: "Baca isi materi pertemuan (PPTX per slide / PDF / DOCX). Gunakan untuk memahami apa yang diajarkan sebelum menilai tugas terkait. offset untuk lanjutan.",
      parameters: { type: "object", properties: { materialId: { type: "string" }, maxChars: { type: "integer" }, offset: { type: "integer" } }, required: ["materialId"] },
    },
  },
  {
    type: "function",
    function: {
      name: "exportSubmissionDocx",
      description: "Buat file DOCX yang bisa diunduh admin berisi isi pengumpulan: catatan mahasiswa, isi dokumen (Word/PDF), dan SEMUA file kode dari ZIP (ekstrak otomatis). Satu submission (submissionId) atau semua pengumpulan satu tugas (maks 25). onlyPaths untuk memilih file tertentu di ZIP.",
      parameters: { type: "object", properties: { submissionId: { type: "string" }, ...tugasSelector, classId: { type: "string" }, includeCode: { type: "boolean" }, includeDocs: { type: "boolean" }, onlyPaths: { type: "array", items: { type: "string" } }, fileName: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "exportReportDocx",
      description: "Simpan laporan/analisis yang Anda tulis (markdown: heading #, bullet -, paragraf) menjadi DOCX yang bisa diunduh admin. Pakai saat admin minta hasil review/rekap dalam bentuk Word.",
      parameters: { type: "object", properties: { title: { type: "string" }, markdown: { type: "string" }, fileName: { type: "string" } }, required: ["title", "markdown"] },
    },
  },
  {
    type: "function",
    function: {
      name: "askUser",
      description: "Tanyakan ke admin bila konteks untuk mengoreksi tidak cukup (mis. rubrik, bobot, kriteria lulus). Hentikan proses sampai admin menjawab. Gunakan hemat — gabungkan beberapa pertanyaan sekaligus.",
      parameters: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["question"] },
    },
  },
];

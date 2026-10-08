/**
 * /api/admin/users — manajemen akun oleh ADMIN global.
 *   GET  ?q=&page=  → daftar user (cari email/nama), tanpa hash.
 *   POST { userId, action: "reset-password", newPassword }
 *        → ganti sandi (argon2id) + cabut semua sesi user tsb.
 *   POST { userId, action: "set-role", role: "USER"|"ADMIN" }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, requireAdmin } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

export const runtime = "nodejs";
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };
const PAGE_SIZE = 50;

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

    const where = q
      ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] }
      : {};

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true, email: true, name: true, role: true, createdAt: true,
          _count: { select: { submissions: true, sessions: true } },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      total,
      page,
      pageSize: PAGE_SIZE,
      users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, submissions: u._count.submissions, activeSessions: u._count.sessions })),
    }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal memuat daftar user.");
  }
}

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reset-password"),
    userId: z.string().min(1),
    newPassword: z.string().min(8, "Sandi minimal 8 karakter.").max(128),
  }),
  z.object({
    action: z.literal("set-role"),
    userId: z.string().min(1),
    role: z.enum(["USER", "ADMIN"]),
  }),
]);

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const rl = enforceRateLimit(`admin-users:${admin.id}`, { limit: 60, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const parsed = BodySchema.safeParse(await readJsonBody<unknown>(req, 8 * 1024));
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400 });
    const body = parsed.data;

    const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, email: true, role: true } });
    if (!target) return NextResponse.json({ success: false, error: "User tidak ditemukan." }, { status: 404 });

    if (body.action === "reset-password") {
      const passwordHash = await hashPassword(body.newPassword);
      await prisma.$transaction([
        prisma.user.update({ where: { id: target.id }, data: { passwordHash } }),
        // Cabut semua sesi lama agar perangkat lain harus login ulang dengan sandi baru.
        prisma.session.deleteMany({ where: { userId: target.id } }),
      ]);
      console.info(`[admin-users] ${admin.email} reset password untuk ${target.email}`);
      return NextResponse.json({ success: true, message: `Sandi ${target.email} diganti. Semua sesi lamanya dicabut.` }, NO_STORE);
    }

    if (target.id === admin.id && body.role !== "ADMIN") {
      return NextResponse.json({ success: false, error: "Tidak bisa mencabut role admin diri sendiri." }, { status: 400 });
    }
    await prisma.user.update({ where: { id: target.id }, data: { role: body.role } });
    console.info(`[admin-users] ${admin.email} set role ${target.email} → ${body.role}`);
    return NextResponse.json({ success: true, message: `Role ${target.email} sekarang ${body.role}.` }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal memproses aksi.");
  }
}

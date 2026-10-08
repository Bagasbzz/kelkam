/**
 * GET /api/admin/db-health
 * -----------------------------------------------------------------------------
 * Diagnostik skema DB untuk admin: cek apakah semua migrasi Prisma sudah
 * terapply dan kolom/tabel yang dibutuhkan kode saat ini ada.
 * Return { ok, applied: [...], missingColumns: [...], missingTables: [...] }.
 *
 * Auth: requireAdmin (role ADMIN global). Tidak pernah mengembalikan nilai
 * data, hanya nama kolom/tabel.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/server/auth";
import { publicErrorResponse } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const REQUIRED_COLUMNS: Array<[table: string, column: string]> = [
  ["tugases", "pertemuan"],
  ["tugas_submissions", "nilai"],
  ["report_jobs", "mode"],
  ["report_jobs", "log"],
  ["report_jobs", "heartbeat_at"],
  ["report_job_steps", "tokens_used"],
];
const REQUIRED_TABLES = ["extracted_texts", "submission_analyses", "admin_chat_sessions", "report_job_steps"];

export async function GET() {
  try {
    await requireAdmin();

    const [columns, tables, migrations] = await Promise.all([
      prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema()`,
      prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema()`,
      prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`.catch(() => []),
    ]);

    const colSet = new Set(columns.map((c) => `${c.table_name}.${c.column_name}`));
    const tableSet = new Set(tables.map((t) => t.table_name));
    const missingColumns = REQUIRED_COLUMNS.filter(([t, c]) => !colSet.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);
    const missingTables = REQUIRED_TABLES.filter((t) => !tableSet.has(t));

    return NextResponse.json({
      ok: missingColumns.length === 0 && missingTables.length === 0,
      missingColumns,
      missingTables,
      migrations: migrations.map((m) => ({
        name: m.migration_name,
        finished: Boolean(m.finished_at),
        rolledBack: Boolean(m.rolled_back_at),
      })),
    });
  } catch (error) {
    return publicErrorResponse(error, "Gagal memeriksa skema DB.");
  }
}

import { prisma } from "@/lib/db/prisma";
import { isCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError } from "@/lib/server/request-guards";

/** Bind execution to the stored session and course, then recheck current rights. */
export async function assertTugasAssistantBinding(
  run: { ownerId: string; sessionId: string; meta: unknown },
  expectedCourseId?: string,
) {
  const meta = run.meta && typeof run.meta === "object" && !Array.isArray(run.meta)
    ? run.meta as Record<string, unknown>
    : {};
  const courseId = typeof meta.courseId === "string" ? meta.courseId : "";
  if (!courseId || (expectedCourseId !== undefined && expectedCourseId !== courseId)) {
    throw new ApiRequestError(404, "Run tidak ditemukan.");
  }
  const session = await prisma.adminChatSession.findFirst({
    where: { id: run.sessionId, userId: run.ownerId, courseId },
    select: { id: true },
  });
  if (!session) throw new ApiRequestError(404, "Sesi tidak ditemukan.");
  if (!await isCourseAdmin(run.ownerId, courseId)) {
    throw new ApiRequestError(403, "Akses admin course sudah tidak tersedia.");
  }
  return courseId;
}

export async function assertTugasAssistantRunAccess(runId: string, ownerId: string, courseId: string) {
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, ownerId, kind: "tugas" },
    select: { ownerId: true, sessionId: true, meta: true },
  });
  if (!run) throw new ApiRequestError(404, "Run tidak ditemukan.");
  await assertTugasAssistantBinding(run, courseId);
}

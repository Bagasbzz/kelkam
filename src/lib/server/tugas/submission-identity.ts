import type { Prisma } from "@prisma/client";
import { ApiRequestError } from "@/lib/server/request-guards";

const nimKey = (value: string) => value.replace(/\s+/g, "").toUpperCase();
const nameKey = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");

/** Call inside the write transaction; the course lock makes first claims atomic. */
export async function resolveSubmissionIdentity(
  tx: Prisma.TransactionClient,
  courseId: string,
  userId: string,
  input: { nim: string; name: string; classId: string },
) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`course-identity:${courseId}`}))`;

  const identities = await tx.tugasSubmission.findMany({
    where: { tugas: { courseId } },
    select: { userId: true, nim: true, name: true },
    distinct: ["userId", "nim", "name"],
  });
  const key = nimKey(input.nim);
  if (identities.some((identity) => identity.userId !== userId && nimKey(identity.nim) === key)) {
    throw new ApiRequestError(409, "NIM ini sudah terikat ke akun mahasiswa lain di course ini. Hubungi admin bila tidak sesuai.");
  }
  const own = identities.filter((identity) => identity.userId === userId);
  if (own.some((identity) => nimKey(identity.nim) !== key)) {
    throw new ApiRequestError(409, "Akun ini sudah terikat ke NIM lain di course ini. Hubungi admin untuk koreksi identitas.");
  }

  // Roster is admin-maintained, but has no verified user linkage. Never treat
  // its optional email (or a self-created enrollment) as proof of identity.
  const roster = await tx.mahasiswa.findMany({
    where: { courseId },
    select: { nim: true, name: true, classId: true },
  });
  const matches = roster.filter((student) => nimKey(student.nim) === key);
  if (matches.length > 1) throw new ApiRequestError(409, "Identitas roster ambigu. Hubungi admin course.");
  const student = matches[0];
  if (student?.classId && student.classId !== input.classId) {
    throw new ApiRequestError(400, "NIM terdaftar pada kelas yang berbeda.");
  }
  const canonicalName = student?.name || own[0]?.name;
  if (canonicalName && nameKey(canonicalName) !== nameKey(input.name)) {
    throw new ApiRequestError(409, "Nama tidak sesuai identitas course. Gunakan nama terdaftar atau hubungi admin.");
  }
  return {
    nim: student?.nim || own[0]?.nim || input.nim.trim(),
    name: canonicalName || input.name.trim().replace(/\s+/g, " "),
  };
}

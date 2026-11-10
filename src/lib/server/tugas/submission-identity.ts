import type { Prisma } from "@prisma/client";
import { ApiRequestError } from "@/lib/server/request-guards";

const nimKey = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/** Variasi penulisan umum di roster kampus (M., Muh., Moh., Mhd., Muhamad, Mohammad, ...). */
const ALIASES: Record<string, string> = {
  m: "muhammad", mhd: "muhammad", muh: "muhammad", muhd: "muhammad", moh: "muhammad", mochammad: "muhammad", mochamad: "muhammad",
  muhamad: "muhammad", muhammad: "muhammad", mohammad: "muhammad", mohamad: "muhammad", mohamed: "muhammad", muhamed: "muhammad", muchammad: "muhammad", muchamad: "muhammad",
  abd: "abdul", ahmad: "ahmad", achmad: "ahmad", akhmad: "ahmad", st: "siti", sitti: "siti", nur: "nur", nurul: "nurul",
};
const GENERIC = new Set(["muhammad", "ahmad", "siti", "abdul", "nur", "binti", "bin"]);

function nameTokens(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("id-ID")
    .replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).map((token) => ALIASES[token] ?? token);
}

function editDistanceAtMostOne(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Nama dianggap sama bila setiap kata pada nama yang lebih pendek cocok dengan kata pada nama lain
 * (persis, inisial satu huruf, singkatan umum, atau salah ketik satu huruf untuk kata >= 4 huruf),
 * dan minimal satu kata khas (bukan "Muhammad", "Siti", dll.) cocok penuh.
 * Contoh cocok: "M. Aldi" ~ "Muhammad Aldi", "Suci" ~ "Suci Sania", "Suci Sanya" ~ "Suci Sania".
 */
export function namesMatch(a: string, b: string) {
  const [short, long] = [nameTokens(a), nameTokens(b)].sort((x, y) => x.length - y.length);
  if (!short.length) return false;
  let distinctive = false;
  for (const token of short) {
    const hit = long.find((other) => other === token || (token.length === 1 && other.startsWith(token)) || (other.length === 1 && token.startsWith(other)) || (token.length >= 4 && other.length >= 4 && editDistanceAtMostOne(token, other)));
    if (!hit) return false;
    if (token.length > 1 && hit.length > 1 && !GENERIC.has(token)) distinctive = true;
  }
  return distinctive;
}

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
  const own = identities.filter((identity) => identity.userId === userId);
  // Akun yang sudah pernah mengumpulkan dengan NIM ini tetap boleh memakainya, walau mahasiswa
  // yang sama dulu juga mengumpulkan dari akun lain (kasus beberapa akun sebelum aturan ini ada).
  const ownsNim = own.some((identity) => nimKey(identity.nim) === key);
  if (!ownsNim && identities.some((identity) => identity.userId !== userId && nimKey(identity.nim) === key)) {
    throw new ApiRequestError(409, "NIM ini sudah terikat ke akun mahasiswa lain di course ini. Hubungi admin bila tidak sesuai.");
  }
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
  if (canonicalName && !namesMatch(canonicalName, input.name)) {
    throw new ApiRequestError(409, `Nama tidak cocok dengan data NIM ini di course${student ? " (roster)" : ""}. Periksa kembali NIM yang diketik, atau hubungi admin bila NIM sudah benar.`);
  }
  return {
    nim: student?.nim || own[0]?.nim || input.nim.trim(),
    name: canonicalName || input.name.trim().replace(/\s+/g, " "),
  };
}

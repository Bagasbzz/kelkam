import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertSameOriginJsonRequest } from "../src/lib/server/csrf-origin.ts";
import { ApiRequestError } from "../src/lib/server/request-guards.ts";
import { prisma } from "../src/lib/db/prisma.ts";
import { assertCourseAccess } from "../src/lib/server/tugas/access.ts";
import { resolveSubmissionIdentity } from "../src/lib/server/tugas/submission-identity.ts";
import { assertTugasAssistantBinding, assertTugasAssistantRunAccess } from "../src/lib/server/tugas/assistant-access.ts";
import type { Prisma } from "@prisma/client";

function request(headers: Record<string, string>, url = "https://keluhkampus.my.id/api/auth/login") {
  return new Request(url, { method: "POST", headers, body: "{}" });
}

test("auth origin guard accepts configured same-origin JSON", () => {
  const previous = process.env.AUTH_ORIGIN;
  process.env.AUTH_ORIGIN = "https://keluhkampus.my.id";
  try {
    assert.doesNotThrow(() => assertSameOriginJsonRequest(request({
      origin: "https://keluhkampus.my.id",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    })));
  } finally {
    if (previous === undefined) delete process.env.AUTH_ORIGIN;
    else process.env.AUTH_ORIGIN = previous;
  }
});

test("auth origin guard rejects hostile origin, same-site form, and wrong content type", () => {
  const previous = process.env.AUTH_ORIGIN;
  process.env.AUTH_ORIGIN = "https://keluhkampus.my.id";
  try {
    for (const headers of [
      { origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "application/json" },
      { origin: "https://keluhkampus.my.id", "sec-fetch-site": "same-site", "content-type": "text/plain" },
      { origin: "https://keluhkampus.my.id", "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" },
    ]) {
      assert.throws(() => assertSameOriginJsonRequest(request(headers)), (error: unknown) => error instanceof ApiRequestError && error.status >= 403);
    }
  } finally {
    if (previous === undefined) delete process.env.AUTH_ORIGIN;
    else process.env.AUTH_ORIGIN = previous;
  }
});

test("canonical origin ignores hostile Host/proxy headers and internal proxy URL", () => {
  const previous = process.env.AUTH_ORIGIN;
  process.env.AUTH_ORIGIN = "https://campus.example:8443/app";
  try {
    const headers = {
      origin: "https://campus.example:8443", "sec-fetch-site": "same-origin",
      "content-type": "application/json; charset=utf-8", host: "evil.example",
      "x-forwarded-host": "evil.example", "x-forwarded-proto": "http",
    };
    assert.doesNotThrow(() => assertSameOriginJsonRequest(request(headers, "http://127.0.0.1:3000/api/auth/login")));
    for (const origin of ["https://evil.example", "null", "https://campus.example", "https://campus.example:8443.evil.example"]) {
      assert.throws(() => assertSameOriginJsonRequest(request({ ...headers, origin })), ApiRequestError);
    }
    const missingOrigin = { ...headers } as Record<string, string>;
    delete missingOrigin.origin;
    assert.throws(() => assertSameOriginJsonRequest(request(missingOrigin)), ApiRequestError);
    assert.throws(() => assertSameOriginJsonRequest(request({ ...headers, "content-type": "application/jsonp" })), ApiRequestError);
    assert.doesNotThrow(() => assertSameOriginJsonRequest(request({ origin: headers.origin, "content-type": headers["content-type"] })));
  } finally {
    if (previous === undefined) delete process.env.AUTH_ORIGIN;
    else process.env.AUTH_ORIGIN = previous;
  }
});

test("course access requires its own share token or legitimate admin, never enrollment", async (t) => {
  const courseLookup = prisma.course.findUnique;
  const adminLookup = prisma.courseAdmin.findUnique;
  const enrollmentLookup = prisma.courseEnrollment.findUnique;
  prisma.course.findUnique = (async ({ where }: { where: { id: string } }) => where.id === "course-a" ? { id: "course-a", token: "ABCDEFGH" } : null) as unknown as typeof courseLookup;
  prisma.courseAdmin.findUnique = (async ({ where }: { where: { courseId_userId: { userId: string } } }) => where.courseId_userId.userId === "co-admin" ? { id: "admin-1" } : null) as unknown as typeof adminLookup;
  prisma.courseEnrollment.findUnique = (() => { throw new Error("untrusted enrollment must not authorize"); }) as unknown as typeof enrollmentLookup;
  t.after(() => {
    prisma.course.findUnique = courseLookup;
    prisma.courseAdmin.findUnique = adminLookup;
    prisma.courseEnrollment.findUnique = enrollmentLookup;
  });
  const user = { id: "student", role: "USER" as const };
  await assert.rejects(assertCourseAccess("course-a", user), (error: unknown) => error instanceof ApiRequestError && error.status === 403);
  await assert.rejects(assertCourseAccess("course-a", user, "OTHER123"), ApiRequestError);
  assert.equal((await assertCourseAccess("course-a", user, " abcdefgh ")).id, "course-a");
  assert.equal((await assertCourseAccess("course-a", { id: "co-admin", role: "USER" })).id, "course-a");
  assert.equal((await assertCourseAccess("course-a", { id: "global-admin", role: "ADMIN" })).id, "course-a");
  await assert.rejects(assertCourseAccess("missing-course", user, "ABCDEFGH"), (error: unknown) => error instanceof ApiRequestError && error.status === 404);
});

function identityDb(
  identities: Array<{ userId: string; nim: string; name: string }> = [],
  roster: Array<{ nim: string; name: string; classId: string | null }> = [],
) {
  let locked = false;
  return {
    $queryRaw: async () => { locked = true; return []; },
    tugasSubmission: { findMany: async (query: { where: { tugas: { courseId: string } } }) => {
      assert.ok(locked, "identity lock precedes checks");
      assert.equal(query.where.tugas.courseId, "course-a");
      return identities;
    } },
    mahasiswa: { findMany: async () => roster },
  } as unknown as Prisma.TransactionClient;
}

test("identity rejects another account's NIM and changing a bound student's NIM/name", async () => {
  const input = { nim: " ab 123 ", name: "Alice", classId: "class-a" };
  await assert.rejects(resolveSubmissionIdentity(identityDb([{ userId: "other", nim: "AB123", name: "Alice" }]), "course-a", "student", input), ApiRequestError);
  await assert.rejects(resolveSubmissionIdentity(identityDb([{ userId: "student", nim: "DIFFERENT", name: "Alice" }]), "course-a", "student", input), ApiRequestError);
  await assert.rejects(resolveSubmissionIdentity(identityDb([{ userId: "student", nim: "AB123", name: "Bob" }]), "course-a", "student", input), ApiRequestError);
});

test("public token students remain valid; roster canonicalizes name/NIM and enforces class", async () => {
  const input = { nim: "ab123", name: " alice  student ", classId: "class-a" };
  assert.deepEqual(await resolveSubmissionIdentity(identityDb(), "course-a", "student", input), { nim: "ab123", name: "alice student" });
  const roster = [{ nim: "AB123", name: "Alice Student", classId: "class-a" }];
  assert.deepEqual(await resolveSubmissionIdentity(identityDb([], roster), "course-a", "student", input), { nim: "AB123", name: "Alice Student" });
  await assert.rejects(resolveSubmissionIdentity(identityDb([], roster), "course-a", "student", { ...input, classId: "class-b" }), ApiRequestError);
  await assert.rejects(resolveSubmissionIdentity(identityDb([], roster), "course-a", "student", { ...input, name: "Other Student" }), ApiRequestError);
});

test("assistant binding rejects another course, mismatched session, and revoked membership", async (t) => {
  const userLookup = prisma.user.findUnique;
  const adminLookup = prisma.courseAdmin.findUnique;
  const sessionLookup = prisma.adminChatSession.findFirst;
  const runLookup = prisma.agentRun.findFirst;
  let membership = true;
  let sessionExists = true;
  prisma.user.findUnique = (async () => ({ role: "USER" })) as unknown as typeof userLookup;
  prisma.courseAdmin.findUnique = (async () => membership ? { id: "membership" } : null) as unknown as typeof adminLookup;
  prisma.adminChatSession.findFirst = (async ({ where }: { where: { courseId: string; userId: string; id: string } }) => {
    assert.deepEqual(where, { id: "session-a", userId: "admin", courseId: "course-a" });
    return sessionExists ? { id: "session-a" } : null;
  }) as unknown as typeof sessionLookup;
  const run = { ownerId: "admin", sessionId: "session-a", meta: { courseId: "course-a" } };
  prisma.agentRun.findFirst = (async ({ where }: { where: { ownerId: string; kind: string } }) => {
    assert.equal(where.ownerId, "admin"); assert.equal(where.kind, "tugas"); return run;
  }) as unknown as typeof runLookup;
  t.after(() => {
    prisma.user.findUnique = userLookup; prisma.courseAdmin.findUnique = adminLookup;
    prisma.adminChatSession.findFirst = sessionLookup; prisma.agentRun.findFirst = runLookup;
  });
  assert.equal(await assertTugasAssistantBinding(run, "course-a"), "course-a");
  await assertTugasAssistantRunAccess("run-a", "admin", "course-a");
  await assert.rejects(assertTugasAssistantRunAccess("run-a", "admin", "course-b"), ApiRequestError);
  await assert.rejects(assertTugasAssistantBinding({ ...run, meta: {} }), ApiRequestError);
  sessionExists = false;
  await assert.rejects(assertTugasAssistantBinding(run), ApiRequestError);
  sessionExists = true; membership = false;
  await assert.rejects(assertTugasAssistantBinding(run), (error: unknown) => error instanceof ApiRequestError && error.status === 403);
});

test("course routes require token and assistant routes bind run course", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/app/api/tugas/courses/[courseId]/enroll/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/tugas/me/submissions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/tugas/tugas/[id]/submit/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/tugas/courses/[courseId]/assistant/run/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(files[0], /BodySchema/);
  assert.match(files[0], /assertCourseAccess/);
  assert.match(files[1], /assertCourseAccess/);
  assert.match(files[2], /assertCourseAccess/);
  assert.match(files[2], /resolveSubmissionIdentity/);
  assert.match(files[3], /assertTugasAssistantRunAccess/);
  for (const route of ["login", "register"]) {
    const source = await readFile(new URL(`../src/app/api/auth/${route}/route.ts`, import.meta.url), "utf8");
    assert.ok(source.indexOf("assertSameOriginJsonRequest(req)") < source.indexOf("await readJsonBody(req,"), "origin check must precede bounded credential parsing");
  }
});

test("roster names match common spellings but not other students", async () => {
  const { namesMatch } = await import("../src/lib/server/tugas/submission-identity.ts");
  for (const [a, b] of [["M. Aldi", "Muhammad Aldi"], ["Muhamad Rizky Pratama", "M Rizky Pratama"], ["Suci", "Suci Sania"], ["suci sanya", "Suci Sania"], ["MUH. FAJAR", "Mohammad Fajar"]]) {
    assert.equal(namesMatch(a, b), true, `${a} ~ ${b}`);
  }
  for (const [a, b] of [["Alice Student", "Other Student"], ["Muhammad Aldi", "Muhammad Rizky"], ["M", "Muhammad Aldi"], ["Bob", "Alice"]]) {
    assert.equal(namesMatch(a, b), false, `${a} !~ ${b}`);
  }
});

test("a student who already submitted with a NIM from two accounts can keep submitting from either", async () => {
  const input = { nim: "162024001", name: "Suci", classId: "class-a" };
  const legacy = [{ userId: "first", nim: "162024001", name: "Suci Sania" }, { userId: "student", nim: "162024001", name: "Suci Sania" }];
  const result = await resolveSubmissionIdentity(identityDb(legacy), "course-a", "student", input);
  assert.equal(result.nim, "162024001");
  await assert.rejects(resolveSubmissionIdentity(identityDb(legacy), "course-a", "newcomer", input), ApiRequestError);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { FileUpload, Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma.ts";
import { IncompleteUploadError, InvalidSignatureError, readUpload, saveUpload, saveUploadFromStream } from "../src/lib/storage/upload.ts";

const buffer = Buffer.from("identical image bytes for owner-safe upload regression");
const sha256 = createHash("sha256").update(buffer).digest("hex");
const uploadInput = { buffer, originalName: "image.png", mime: "image/png" };

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Duplicate owner/hash", {
    code: "P2002",
    clientVersion: Prisma.prismaVersion.client,
    meta: { target: ["owner_id", "sha256"] },
  });
}

async function storage(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "upload-dedup-"));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = root;
  t.after(async () => {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(root, { recursive: true, force: true });
  });

  const rows: FileUpload[] = [];
  const candidates: string[] = [];
  const originalLookup = prisma.fileUpload.findUnique;
  const originalCreate = prisma.fileUpload.create;
  const lookup = t.mock.fn(async ({ where }: { where: Prisma.FileUploadWhereUniqueInput }) => {
    if (where.id) return rows.find((row) => row.id === where.id) ?? null;
    const scope = where.ownerId_sha256;
    assert.ok(scope, "hash dedup lookups must include the owner");
    return rows.find((row) => row.ownerId === scope.ownerId && row.sha256 === scope.sha256) ?? null;
  });
  const create = t.mock.fn(async ({ data }: { data: Prisma.FileUploadUncheckedCreateInput }) => {
    candidates.push(data.filePath);
    if (rows.some((row) => row.ownerId === data.ownerId && row.sha256 === data.sha256)) throw uniqueViolation();
    const row: FileUpload = { ...data, id: `upload-${rows.length + 1}`, createdAt: new Date() };
    rows.push(row);
    return row;
  });
  // Prisma delegates are proxies, so mock.method cannot inspect their descriptors.
  prisma.fileUpload.findUnique = lookup as unknown as typeof originalLookup;
  prisma.fileUpload.create = create as unknown as typeof originalCreate;
  t.after(() => {
    prisma.fileUpload.findUnique = originalLookup;
    prisma.fileUpload.create = originalCreate;
  });
  return { root, rows, candidates, lookup, create };
}

function streamInput(ownerId: string) {
  return {
    ownerId,
    originalName: "image.png",
    mime: "image/png",
    expectedSize: buffer.length,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buffer.subarray(0, 7));
        controller.enqueue(buffer.subarray(7));
        controller.close();
      },
    }),
  };
}

test("identical bytes have independent owner records and reads remain owner-only", async (t) => {
  const { rows, candidates } = await storage(t);
  const first = await saveUpload({ ...uploadInput, ownerId: "owner-a" });
  const second = await saveUpload({ ...uploadInput, ownerId: "owner-b" });

  assert.equal(first.sha256, sha256);
  assert.equal(second.sha256, sha256);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, false);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.filePath, second.filePath);
  assert.equal(rows.length, 2);
  assert.equal(candidates.length, 2);
  assert.deepEqual(await readUpload(first.id, "owner-a"), buffer);
  assert.deepEqual(await readUpload(second.id, "owner-b"), buffer);
  assert.equal(await readUpload(first.id, "owner-b"), null);
  assert.equal(await readUpload(second.id, "owner-a"), null);
});

test("same-owner buffer and stream dedup reuse the row without extra candidate files", async (t) => {
  const { root, candidates } = await storage(t);
  const first = await saveUpload({ ...uploadInput, ownerId: "owner-a" });
  const second = await saveUpload({ ...uploadInput, originalName: "renamed.jpg", ownerId: "owner-a" });
  const streamed = await saveUploadFromStream(streamInput("owner-a"));

  assert.deepEqual(second, { ...first, deduplicated: true });
  assert.deepEqual(streamed, { ...first, deduplicated: true, size: buffer.length });
  assert.equal(candidates.length, 1);
  assert.deepEqual(await readdir(path.join(root, "owner-a")), [path.basename(first.filePath)]);
  assert.deepEqual(await readFile(first.filePath), buffer);
});

for (const mode of ["buffer", "stream", "mixed"] as const) {
  test(`concurrent same-owner ${mode} uploads remove only the losing unique candidate`, async (t) => {
    const { root, rows, candidates, lookup } = await storage(t);
    // Force both initial lookups to miss before either writer can create a row.
    let initialReads = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    lookup.mock.mockImplementationOnce(async () => { initialReads++; if (initialReads === 2) release(); await ready; return null; }, 0);
    lookup.mock.mockImplementationOnce(async () => { initialReads++; if (initialReads === 2) release(); await ready; return null; }, 1);
    const save = (stream: boolean) => stream
      ? saveUploadFromStream(streamInput("owner-a"))
      : saveUpload({ ...uploadInput, ownerId: "owner-a" });

    const results = await Promise.all([save(mode !== "buffer"), save(mode === "stream")]);
    assert.equal(rows.length, 1);
    assert.equal(candidates.length, 2);
    assert.notEqual(candidates[0], candidates[1]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(results[0].filePath, results[1].filePath);
    assert.deepEqual(results.map((result) => result.deduplicated).sort(), [false, true]);
    assert.equal(results[0].sha256, sha256);
    assert.deepEqual(await readFile(results[0].filePath), buffer);
    assert.deepEqual(await readdir(path.join(root, "owner-a")), [path.basename(results[0].filePath)]);
  });
}

test("race recovery never unlinks a winner that already points at the candidate", async (t) => {
  const { create, rows } = await storage(t);
  create.mock.mockImplementation(async ({ data }: { data: Prisma.FileUploadUncheckedCreateInput }) => {
    rows.push({ ...data, id: "already-recorded", createdAt: new Date() });
    throw uniqueViolation();
  });
  const saved = await saveUpload({ ...uploadInput, ownerId: "owner-a" });
  assert.equal(saved.id, "already-recorded");
  assert.equal(saved.deduplicated, true);
  assert.deepEqual(await readFile(saved.filePath), buffer);
});

test("a unique violation without an owner-scoped winner is not treated as shared dedup", async (t) => {
  const { create } = await storage(t);
  await saveUpload({ ...uploadInput, ownerId: "owner-a" });
  const error = uniqueViolation();
  create.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(saveUpload({ ...uploadInput, ownerId: "owner-b" }), (caught) => caught === error);
});

test("stream validation still rejects incomplete or invalid input and removes temporary bytes", async (t) => {
  const { root, candidates } = await storage(t);
  await assert.rejects(saveUploadFromStream({ ...streamInput("owner-a"), expectedSize: buffer.length + 1 }), IncompleteUploadError);
  await assert.rejects(saveUploadFromStream({ ...streamInput("owner-a"), validateHead: () => false }), InvalidSignatureError);
  assert.equal(candidates.length, 0);
  assert.deepEqual(await readdir(path.join(root, "owner-a")), []);
});

test("schema and migration replace global hash uniqueness with the mapped owner/hash index", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const model = schema.match(/model FileUpload \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(model);
  assert.match(model, /@@unique\(\[ownerId, sha256\]\)/);
  assert.doesNotMatch(model, /sha256\s+String\s+@unique/);
  const migration = await readFile(new URL("../prisma/migrations/20261029000000_scope_upload_dedup_owner/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /DROP INDEX "file_uploads_sha256_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX "file_uploads_owner_id_sha256_key" ON "file_uploads"\("owner_id", "sha256"\)/);
});

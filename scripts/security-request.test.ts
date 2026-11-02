import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiRequestError, publicErrorResponse, readJsonBody } from "../src/lib/server/request-guards";
import { AiBudgetError } from "../src/lib/server/ai-budget";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server";
import { z } from "zod";

test("JSON body handles UTF-8 split across chunks within its byte budget", async () => {
  const encoded = new TextEncoder().encode('{"text":"caf\u00e9"}');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const request = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.deepEqual(await readJsonBody(request, encoded.byteLength), { text: "caf\u00e9" });
});

test("JSON body cancels an oversized stream even without Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(9)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readJsonBody(request, 8), (error: unknown) => error instanceof ApiRequestError && error.status === 413);
  assert.equal(cancelled, true);
});

test("JSON body rejects declared oversized and malformed payloads", async () => {
  await assert.rejects(readJsonBody(new Request("https://example.test", { method: "POST", headers: { "Content-Length": "100" }, body: "{}" }), 10), (error: unknown) => error instanceof ApiRequestError && error.status === 413);
  await assert.rejects(readJsonBody(new Request("https://example.test", { method: "POST", body: "[" }), 10), (error: unknown) => error instanceof ApiRequestError && error.status === 400);
  await assert.rejects(readJsonBody(new Request("https://example.test"), Number.NaN), /Invalid JSON body limit/);
});

test("public errors retain budget denials without disclosing provider failures", async () => {
  const denied = publicErrorResponse(new AiBudgetError(), "Gagal memproses.");
  assert.equal(denied.status, 429);
  assert.deepEqual(await denied.json(), { success: false, error: "Batas pemakaian AI tercapai. Coba lagi besok." });
  const failed = publicErrorResponse(new Error("secret-provider-details"), "Gagal memproses.");
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { success: false, error: "Gagal memproses." });
});

test("auth, enrollment and both submission handlers reject oversized JSON before storage", async () => {
  for (const [file, limit, methods] of [
    ["auth/login", 4096, ["POST"]],
    ["auth/register", 4096, ["POST"]],
    ["tugas/courses/[courseId]/enroll", 1024, ["POST"]],
    ["tugas/tugas/[id]/submit", 64 * 1024, ["POST", "PATCH"]],
  ] as const) {
    const source = await readFile(new URL(`../src/app/api/${file}/route.ts`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, (req: Request, context: unknown) => Promise<Response>> = {};
    vm.runInNewContext(compiled, {
      exports,
      console: { error() {} },
      require: (id: string) => {
        if (id === "next/server") return { NextResponse };
        if (id === "zod") return { z };
        if (id === "@/lib/server/request-guards") return { ApiRequestError, publicErrorResponse, readJsonBody, enforceRateLimit: () => null };
        if (id === "@/lib/server/auth") return { authenticateRequestFromCookie: async () => ({ ok: true, user: { id: "student" } }) };
        if (id === "@/lib/server/csrf-origin") return { assertSameOriginJsonRequest() {} };
        if (["@/lib/db/prisma", "@/lib/server/tugas/access", "@/lib/server/tugas/submission-identity", "@/lib/server/tugas/position", "@/lib/server/tugas/serialize"].includes(id)) {
          return new Proxy({}, { get() { throw new Error("Storage must not be reached"); } });
        }
        throw new Error(`Unexpected dependency: ${id}`);
      },
    });
    for (const method of methods) {
      for (const headers of [new Headers({ "Content-Length": String(limit + 1) }), new Headers()]) {
        const response = await exports[method](new Request("https://example.test", {
          method, headers, body: JSON.stringify({ ignored: "x".repeat(limit) }),
        }), { params: Promise.resolve({ courseId: "course", id: "task" }) });
        assert.equal(response.status, 413, `${file} ${method}`);
        assert.deepEqual(await response.json(), { success: false, error: "Payload terlalu besar." });
      }
      const malformed = await exports[method](new Request("https://example.test", { method, body: "[" }), { params: Promise.resolve({}) });
      assert.equal(malformed.status, 400, `${file} ${method} malformed JSON`);
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { collectReferencePdfs, referencePdfName } from "../src/lib/references/download-pdfs";
import type { VerifiedSource } from "../src/lib/references/find-sources";

const source = (id: string, patch: Partial<VerifiedSource> = {}): VerifiedSource => ({
  id, title: `Jurnal ${id}`, year: 2025, pdfStatus: "verified", pdfUrl: `https://example.org/${id}.pdf`, ...patch,
} as VerifiedSource);
const pdf = Buffer.from("%PDF-1.7\nfile-test");

test("only verified stored sources are downloaded, HTML is rejected", async () => {
  const calls: string[] = [];
  const result = await collectReferencePdfs([source("a"), source("b", { pdfStatus: "closed" }), source("c")], async (url) => {
    calls.push(url);
    return url.endsWith("c.pdf") ? Buffer.from("<html>login</html>") : pdf;
  });
  assert.equal(calls.length, 2);
  assert.equal(result.files.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.files[0].bytes, pdf);
});

test("partial failures and size limits preserve successful PDFs", async () => {
  const result = await collectReferencePdfs([source("a"), source("b"), source("c")], async (url) => {
    if (url.endsWith("b.pdf")) throw new Error("network error");
    return pdf;
  }, { maxBytes: pdf.length });
  assert.equal(result.files.length, 1);
  assert.equal(result.skipped.length, 2);
});

test("batch count and deadline bound work", async () => {
  await assert.rejects(() => collectReferencePdfs(Array.from({ length: 11 }, (_, i) => source(String(i))), async () => pdf), /Maksimal 10/);
  const result = await collectReferencePdfs([source("a")], async () => { throw new Error("must not run"); }, { deadlineMs: -1 });
  assert.equal(result.files.length, 0);
  assert.match(result.skipped[0].reason, /waktu/);
});

test("PDF filenames cannot contain directories or header control characters", () => {
  const name = referencePdfName(source("a", { title: "../abc\\x\r\n\"evil:yes" }), 0);
  assert.doesNotMatch(name, /[\/\\\r\n":]/);
  assert.match(name, /^01-2025-.*\.pdf$/);
});

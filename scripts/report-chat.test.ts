import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getErrorMessage, sanitizePublicErrorText, toPublicAssistantMessage, toPublicErrorMessage } from "../src/lib/errors.ts";
import { attachmentError, clipboardFiles, MAX_CHAT_ATTACHMENTS } from "../src/lib/client/report-attachments.ts";

test("provider billing and credentials never appear in public errors", () => {
  const errors = [
    "402 No active Plan or credit available - please purchase a Plan or top up your credit at https://console.example.ai/billing to continue using the service.",
    "No active plan or credit available",
    "Payment required",
    "insufficient credits",
    "401 Incorrect API key provided: sk-private-secret",
    "authentication_error: invalid credential",
    "Provider error: https://private.example.com/request/123",
    "Unexpected response from private-provider.ai",
    "Bearer private-access-token",
    "z0ne backend error",
    "openrouter backend error",
  ];
  for (const error of errors) {
    const message = getErrorMessage(new Error(error));
    assert.doesNotMatch(message, /402|401|plan|credit|payment|billing|purchase|https?:|example|private|sk-|bearer|credential|z0ne|openrouter/i);
    assert.equal(toPublicErrorMessage({ message: error }), message);
  }
});

test("public errors preserve actionable validation and login messages", () => {
  for (const message of ["Sesi tidak ditemukan.", "Pilih berkas gambar.", "Maksimal 10 lampiran per pesan."]) {
    assert.equal(getErrorMessage(message), message);
  }
  assert.match(getErrorMessage("401 Unauthorized"), /masuk kembali/);
  assert.match(getErrorMessage("429 Too Many Requests"), /Tunggu/);
  assert.match(getErrorMessage("timeout"), /terlalu lama/);
  assert.equal(getErrorMessage(null), "Terjadi kesalahan. Coba lagi.");
  assert.match(getErrorMessage({ status: 402, message: "Unknown error" }), /tidak tersedia/);
  assert.match(getErrorMessage({ code: "payment_required", message: "Unknown error" }), /tidak tersedia/);
  assert.match(getErrorMessage({ code: "payment_required" }), /tidak tersedia/);
});

test("mixed public logs redact provider details but preserve long content and references", () => {
  const normal = `${"Laporan akademik dengan pembahasan lengkap. ".repeat(30)} Referensi https://journal.example.com/article`;
  assert.equal(sanitizePublicErrorText(normal), normal);
  assert.equal(toPublicAssistantMessage(normal), normal);
  assert.equal(toPublicAssistantMessage("Gunakan API key di server, bukan browser."), "Gunakan API key di server, bukan browser.");
  for (const message of [
    "Langkah dilewati: 402 No active plan or credit available at https://console.example.ai/billing",
    "Gambar gagal: insufficient credits",
    "Gagal membuat file: authentication_error",
    "z0ne backend error",
  ]) {
    const safe = sanitizePublicErrorText(message);
    assert.doesNotMatch(safe, /402|plan|credit|billing|example|authentication_error/i);
    assert.equal(sanitizePublicErrorText(safe), safe);
  }
});

test("clipboard screenshots are collected locally while normal text paste is untouched", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
  const text = { kind: "string", getAsFile: () => { throw new Error("Must not read text clipboard item as file"); } };
  const image = { kind: "file", getAsFile: () => file };
  const missing = { kind: "file", getAsFile: () => null };
  const clipboard = { items: [text, image, missing] as unknown as DataTransferItemList };
  assert.deepEqual(clipboardFiles(clipboard), [file]);
  assert.deepEqual(clipboardFiles({ items: [text] as unknown as DataTransferItemList }), []);
});

test("staged attachment validation enforces image formats and size before network use", () => {
  const file = (size: number, name = "image.png", type = "image/png") => ({ size, name, type }) as File;
  assert.equal(attachmentError(file(8 * 1024 * 1024)), null);
  assert.match(attachmentError(file(8 * 1024 * 1024 + 1))!, /8 MB/);
  assert.match(attachmentError(file(8 * 1024 * 1024 + 1), true)!, /8 MB/);
  assert.match(attachmentError(file(0))!, /kosong/);
  assert.match(attachmentError(file(10, "payload.svg", "image/svg+xml"))!, /PNG/);
  assert.equal(attachmentError(file(12 * 1024 * 1024, "notes.pdf", "application/pdf")), null);
  assert.match(attachmentError(file(12 * 1024 * 1024 + 1, "notes.pdf", "application/pdf"))!, /12 MB/);
  assert.equal(attachmentError(file(50 * 1024 * 1024, "project.zip", "application/zip"), true), null);
  assert.equal(MAX_CHAT_ATTACHMENTS, 10);
});

test("composer stages clipboard and picker files, only send invokes upload", async () => {
  const source = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
  const stage = source.slice(source.indexOf("const stageAttachments ="), source.indexOf("useEffect(() => () =>", source.indexOf("const stageAttachments =")));
  assert.match(stage, /URL\.createObjectURL/);
  assert.doesNotMatch(stage, /authenticatedFetch|uploadMaterial\(|\bapi\(/);
  assert.match(source, /onPaste=\{[\s\S]*?clipboardFiles\(e\.clipboardData\)[\s\S]*?stageAttachments\(files\)/);
  assert.match(source, /onChange=\{\(e\) => \{ stageAttachments\(Array\.from\(e\.target\.files/);
  assert.match(source, /for \(const attachment of attachments\) \{\s*await uploadMaterial/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /aria-label=\{`Hapus lampiran/);
  const send = source.slice(source.indexOf("const send ="), source.indexOf("const pauseRun ="));
  assert.doesNotMatch(send, /await loadDetail/);
  assert.match(send, /if \(uploadAbortRef\.current === controller\) \{\s*sendLockRef\.current = false/);
  assert.match(source, /uploadAbortRef\.current\?\.abort\(\);\s*uploadAbortRef\.current = null;\s*sendLockRef\.current = false/);
});

test("old persisted provider failures are redacted without rewriting regular chat", () => {
  const old = 'Maaf, proses gagal: 402 No active Plan or credit available at https://console.example.ai/billing. Ketik "lanjut" untuk mencoba meneruskan.';
  assert.doesNotMatch(toPublicAssistantMessage(old), /402|billing|example|credit|https?:/i);
  for (const content of ["Halo, saya bisa membantu.", "Referensi: https://journal.example.com/article", "Kode 402 pada aplikasi Anda perlu diperiksa."]) {
    assert.equal(toPublicAssistantMessage(content), content);
  }
});

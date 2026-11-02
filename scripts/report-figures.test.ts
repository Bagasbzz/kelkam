import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import JSZip from "jszip";
import { Packer } from "docx";
import { figurePlaceholders, normalizeFigureKey, parseFigurePlaceholder, reconcileFigurePlaceholders } from "../src/lib/report/figure-placeholders";
import { buildDocxDocument, DOCX_PRESETS, parseMarkdownToBlocks } from "../src/utils/markdown-docx-exporter";
import * as figureHelpers from "../src/lib/report/figure-placeholders";
import * as intentHelpers from "../src/lib/report/report-intent";
import type { SessionDocxInput, SessionDocxResult } from "../src/lib/server/laporan/export-docx";

const title = "Arsitektur - Layanan - Mahasiswa";
const caption = "Alur masuk - pemeriksaan - hasil";
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64"));

test("normalizes dash variants, whitespace, case and manual figure numbering", () => {
  assert.equal(normalizeFigureKey("  Gambar 2.3: ARSITEKTUR\u00a0\u2014 Layanan  \u2013  Mahasiswa "), normalizeFigureKey(title));
  assert.equal(normalizeFigureKey("Figure 12.1. Arsitektur - Layanan - Mahasiswa"), normalizeFigureKey(title));
  assert.equal(normalizeFigureKey("Login-Logout"), normalizeFigureKey(" Login \u2013 Logout "));
});

test("resolves the longest known title, not the first/last dash in caption", () => {
  const parsed = parseFigurePlaceholder(`[Gambar: ${title} - ${caption}]`, ["Arsitektur", "Arsitektur - Layanan", title]);
  assert.equal(parsed?.title, title);
  assert.equal(parsed?.caption, caption);
  assert.equal(parseFigurePlaceholder(`[Gambar: ${title}]`, [title])?.title, title);
  assert.equal(parseFigurePlaceholder(`[Gambar: Gambar 2.3 ${title} - ${caption}]`, [title])?.title, title);
  assert.equal(parseFigurePlaceholder("Bukan placeholder", [title]), null);
});

test("isolates placeholders beside narrative, lists, and trailing text without swallowing content", () => {
  const blocks = parseMarkdownToBlocks(`Narasi sebelum.\n1. [Gambar: ${title} - ${caption}] Teks setelah penanda.\nNarasi sesudah.\n[Gambar: Kedua] Caption: Keterangan kedua\nParagraf akhir.`, [title, "Kedua"]);
  assert.deepEqual(blocks, [
    { type: "paragraph", text: "Narasi sebelum." },
    { type: "figure", title, caption },
    { type: "paragraph", text: "Teks setelah penanda." },
    { type: "paragraph", text: "Narasi sesudah." },
    { type: "figure", title: "Kedua", caption: "Keterangan kedua" },
    { type: "paragraph", text: "Paragraf akhir." },
  ]);
});

test("restores deleted and AI-omitted assets in target section and before bibliography", () => {
  const draft = "# Laporan\n## BAB I Pendahuluan\nAwal.\n## BAB II: Pembahasan\nIsi.\n### 2.1 Rincian\nDetail.\n## Penutup\nAkhir.\n# Daftar Pustaka\nSumber.";
  const assets = [
    { title, caption, sectionId: "body", available: true },
    { title: "Foto Tanpa Bagian", caption: "Foto kegiatan", available: true },
    { title: "Belum Jadi", available: false },
  ];
  const restored = reconcileFigurePlaceholders(draft, assets, [{ id: "body", title: "Pembahasan" }]);
  assert.deepEqual(restored.insertedTitles, [title, "Foto Tanpa Bagian"]);
  assert.ok(restored.markdown.indexOf("Detail.") < restored.markdown.indexOf(`[Gambar: ${title}`));
  assert.ok(restored.markdown.indexOf(`[Gambar: ${title}`) < restored.markdown.indexOf("## Penutup"));
  assert.ok(restored.markdown.indexOf("Foto Tanpa Bagian") < restored.markdown.indexOf("# Daftar Pustaka"));
  assert.ok(!restored.markdown.includes("Belum Jadi"));
  assert.equal(reconcileFigurePlaceholders(restored.markdown, assets, [{ id: "body", title: "Pembahasan" }]).markdown, restored.markdown);
});

test("deduplicates known numbered markers, preserves unavailable/unknown markers and fenced examples", () => {
  const draft = `[Gambar: ${title} - ${caption}]\n[Gambar: Gambar 2.1 ${title} - ${caption}] Narasi duplikat.\n[Gambar: Tertunda - Tunggu]\n[Gambar: Tidak Dikenal - Tidak dibuat]\n\`\`\`md\n[Gambar: Hanya Contoh]\n\`\`\``;
  const restored = reconcileFigurePlaceholders(draft, [{ title, available: true }, { title: "Tertunda", available: false }, { title: "Hanya Contoh", available: true }]);
  assert.equal(figurePlaceholders(restored.markdown, [title]).filter((figure) => figure.key === normalizeFigureKey(title)).length, 1);
  assert.ok(restored.markdown.includes("Narasi duplikat."));
  assert.ok(restored.markdown.includes("[Gambar: Tertunda - Tunggu]"));
  assert.ok(restored.markdown.includes("[Gambar: Tidak Dikenal - Tidak dibuat]"));
  assert.ok(restored.markdown.includes("```md\n[Gambar: Hanya Contoh]\n```"));
  assert.deepEqual(restored.insertedTitles, ["Hanya Contoh"]);
});

async function docxContents(markdown: string, images: Record<string, Uint8Array>, figureTitles: string[] = []) {
  const doc = buildDocxDocument(markdown, { profile: { ...DOCX_PRESETS.ringkas.profile, cover: null }, images, figureTitles });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const xml = await zip.file("word/document.xml")!.async("string");
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((paragraph) => [...paragraph[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join(""));
  return { xml, paragraphs, media: Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir) };
}

test("actual DOCX ZIP embeds dash-rich/numbered keys and preserves all adjacent paragraph text", async () => {
  const draft = `Narasi sebelum.\n[Gambar: Gambar 2.3 ${title} - ${caption}] Teks di baris gambar.\nNarasi sesudah.\n[Gambar: Kedua \u2014 Foto - Caption kedua - rinci]\nParagraf akhir.`;
  const { xml, paragraphs, media } = await docxContents(draft, { [title.toUpperCase()]: png, "Gambar 9.1 Kedua - Foto": png });
  assert.ok(media.some((name) => name.endsWith(".png")), "PNG must exist in word/media");
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 2);
  for (const text of ["Narasi sebelum.", "Teks di baris gambar.", "Narasi sesudah.", "Paragraf akhir."]) assert.ok(paragraphs.includes(text), text);
  assert.ok(paragraphs.some((text) => text.includes(caption)));
  assert.ok(paragraphs.some((text) => text.includes("Caption kedua - rinci")));
  assert.ok(!xml.includes("Tempatkan gambar"));
  assert.ok(xml.includes('w:ascii="Arial"'), "selected format preset must survive");
});

test("actual DOCX ZIP recovers omitted media exactly once and retains missing placeholders and content", async () => {
  const draft = "## Pembahasan\nIsi asli.\n[Gambar: Belum Tersedia - Caption belum ada - lengkap]\nNarasi tetap ada.\n# Daftar Pustaka\nSumber tetap ada.";
  const restored = reconcileFigurePlaceholders(draft, [{ title, caption, sectionId: "body", available: true }, { title: "Belum Tersedia", available: false }], [{ id: "body", title: "Pembahasan" }]);
  const { xml, paragraphs, media } = await docxContents(restored.markdown, { [title]: png }, [title, "Belum Tersedia"]);
  assert.equal(media.length, 1);
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 1);
  for (const text of ["Isi asli.", "Narasi tetap ada.", "Sumber tetap ada."]) assert.ok(paragraphs.includes(text), text);
  assert.ok(paragraphs.some((text) => text.includes("Caption belum ada - lengkap")));
  assert.ok(paragraphs.some((text) => text.includes("[Tempatkan gambar: Belum Tersedia]")));
  assert.ok(paragraphs.findIndex((text) => text.includes(caption)) < paragraphs.indexOf("DAFTAR PUSTAKA"));
});

test("unknown image keys cannot resolve inherited object properties as image bytes", async () => {
  const { xml, media } = await docxContents("[Gambar: constructor]\n[Gambar: __proto__]\nTeks utuh.", {});
  assert.equal(media.length, 0);
  assert.ok(xml.includes("[Tempatkan gambar: constructor]"));
  assert.ok(xml.includes("[Tempatkan gambar: __proto__]"));
  assert.ok(xml.includes("Teks utuh."));
});

test("Word XML contains native black headings, multilevel numbering and an updateable TOC", async () => {
  const draft = "# Laporan Uji\n## Abstrak\nRingkasan.\n## Daftar Isi\nDAFTAR LAMA HARUS HILANG\n## BAB I Pendahuluan\nIsi.\n### 1.1 Latar Belakang\nDetail.\n#### 1.1.1 Masalah\nRincian.\n## BAB II Pembahasan\nIsi kedua.\n### 2.1 Analisis\nAnalisis.\n## Lampiran\n### Detail Lampiran\nIsi lampiran.\n## Daftar Pustaka\n[1] Sumber uji (2025). Judul.";
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocxDocument(draft)));
  const xml = await zip.file("word/document.xml")!.async("string");
  const numbering = await zip.file("word/numbering.xml")!.async("string");
  const styles = await zip.file("word/styles.xml")!.async("string");
  const settings = await zip.file("word/settings.xml")!.async("string");
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  assert.match(xml, /TOC[^<]*1-3/);
  assert.match(settings, /<w:updateFields/);
  assert.ok(!xml.includes("DAFTAR LAMA HARUS HILANG"));
  assert.ok(!xml.includes(">BAB I Pendahuluan<"));
  assert.ok(!xml.includes(">1.1 Latar Belakang<"));
  for (const [text, level] of [["PENDAHULUAN", 0], ["Latar Belakang", 1], ["Masalah", 2], ["PEMBAHASAN", 0]] as const) {
    const paragraph = paragraphs.find((value) => value.includes(`>${text}<`) && value.includes('w:pStyle w:val="Heading'));
    assert.ok(paragraph, text);
    assert.match(paragraph, new RegExp(`w:pStyle w:val="Heading${level + 1}"`));
    assert.match(paragraph, new RegExp(`w:ilvl w:val="${level}"`));
    assert.match(paragraph, /w:numPr/);
  }
  for (const text of ["ABSTRAK", "LAMPIRAN", "Detail Lampiran", "DAFTAR PUSTAKA"]) {
    const paragraph = paragraphs.find((value) => value.includes(`>${text}<`) && value.includes('w:pStyle w:val="Heading'));
    assert.ok(paragraph, text);
    assert.ok(!paragraph.includes("<w:numPr>"), text);
  }
  assert.match(numbering, /w:numFmt w:val="upperRoman"/);
  assert.match(numbering, /w:lvlText w:val="BAB %1"/);
  assert.match(numbering, /w:lvlText w:val="%1.%2.%3"/);
  assert.equal((numbering.match(/<w:isLgl/g) || []).length, 2);
  for (const id of ["Heading1", "Heading2", "Heading3", "Heading4", "TOC1", "TOC2", "TOC3"]) {
    const style = [...styles.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)].find((match) => match[0].includes(`w:styleId="${id}"`))?.[0];
    assert.ok(style, id);
    assert.match(style, /w:color w:val="000000"/);
  }
  assert.ok((xml.match(/<w:sectPr/g) || []).length >= 4, "chapters have native section boundaries");
  assert.match(paragraphs.find((value) => value.includes("Sumber uji"))!, /w:hanging="720"/);
});

test("scoped outputs retain heading hierarchy without promoting sections to chapters", async () => {
  for (const outputMode of ["literature_review", "answer", "citations_only"] as const) {
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocxDocument("# Kajian\n## Temuan\nJawaban.\n### Rincian\nDetail.", {
      outputMode, profile: { ...DOCX_PRESETS.ringkas.profile, cover: null },
    })));
    const xml = await zip.file("word/document.xml")!.async("string");
    assert.ok(!xml.includes("<w:numPr>"));
    assert.ok(!xml.includes("TOC "));
    assert.match(xml, /w:pStyle w:val="Heading2"/);
    assert.match(xml, /w:pStyle w:val="Heading3"/);
    assert.equal((xml.match(/<w:sectPr/g) || []).length, 1);
  }
});

test("a higher-level manual TOC cannot swallow lower-level chapter content", async () => {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocxDocument("# Laporan\n# Daftar Isi\nDaftar lama.\n## BAB I Pendahuluan\nNarasi penting.\n### 1.1 Konteks\nDetail penting.")));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.ok(!xml.includes("Daftar lama."));
  assert.ok(xml.includes("Narasi penting."));
  assert.ok(xml.includes("Detail penting."));
  assert.match(xml, /w:pStyle w:val="Heading1"/);
});

async function mockedSessionExport() {
  const source = await readFile(new URL("../src/lib/server/laporan/export-docx.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: { exportSessionDocx?: (input: SessionDocxInput) => Promise<SessionDocxResult> } = {};
  const reads: string[] = [];
  const rasters: string[] = [];
  const renders: Array<{ draft: string; options: Parameters<typeof buildDocxDocument>[1] }> = [];
  let jobsRead = 0;
  const modules: Record<string, unknown> = {
    docx: { Packer: { toBuffer: async () => Buffer.from("docx") } },
    "@/lib/report/figure-placeholders": figureHelpers,
    "@/lib/report/report-intent": intentHelpers,
    "@/lib/db/prisma": { prisma: { user: { findUnique: async () => ({ name: "Owner" }) } } },
    "@/lib/server/image-jobs": { listImageJobs: async () => {
      jobsRead += 1;
      return [{ status: "done", fileId: "generated", title: "Shared" }, { status: "running", title: "Pending" }];
    } },
    "@/lib/storage/upload": {
      readUpload: async (id: string, owner: string) => { assert.equal(owner, "owner"); reads.push(id); return Buffer.from(id); },
      saveUpload: async () => ({ id: "saved" }),
    },
    "@/utils/markdown-docx-exporter": {
      DOCX_PRESETS, parseFormatRules: () => ({}), presetForDocumentType: () => "skripsi", docxFileName: () => "report.docx",
      buildDocxDocument: (draft: string, options: Parameters<typeof buildDocxDocument>[1]) => { renders.push({ draft, options }); return {}; },
    },
    "./svg-raster": { svgToPngServer: async (svg: string) => { rasters.push(svg); return Buffer.from(svg); } },
  };
  runInNewContext(compiled.outputText, { exports, Uint8Array, console: { warn() {}, info() {} }, require(name: string) {
    assert.ok(Object.hasOwn(modules, name), `Unexpected export dependency ${name}`);
    return modules[name];
  } });
  assert.ok(exports.exportSessionDocx);
  return { run: exports.exportSessionDocx, reads, rasters, renders, jobsRead: () => jobsRead };
}

test("session export embeds only approved SVGs, deduplicates keys, and prefers diagram over upload over job", async () => {
  const state = await mockedSessionExport();
  const result = await state.run({ sessionId: "session", ownerId: "owner", title: "Report", draft: "Isi.\n[Gambar: Pending]\n[Gambar: Failed]", brief: {},
    diagrams: [{ title: "Shared", status: "approved", svg: "approved" }, { title: "SHARED", status: "approved", svg: "duplicate" }, { title: "Failed", status: "failed", svg: "never-render" }],
    figures: [{ title: "Shared", fileId: "uploaded" }, { title: "SHARED", fileId: "duplicate-upload" }],
  });
  assert.deepEqual(state.rasters, ["approved"]);
  assert.deepEqual(state.reads, ["generated", "uploaded"]);
  assert.equal(Buffer.from(state.renders[0].options!.images!.shared as Uint8Array).toString(), "approved");
  assert.equal(result.pendingFigures, 1);
  assert.equal(result.missingImages, 1);
  assert.ok(state.renders[0].draft.includes("[Gambar: Shared"));
  assert.ok(state.renders[0].draft.includes("[Gambar: Failed]"));
});

test("explicit omit avoids asset reads and preserves adjacent narrative and fenced examples", async () => {
  const state = await mockedSessionExport();
  const result = await state.run({ sessionId: "session", ownerId: "owner", title: "Jawaban", draft: "[Gambar: Shared] Teks tetap.\n```md\n[Gambar: Contoh]\n```", brief: { intent: intentHelpers.normalizeReportIntent({ outputMode: "answer", diagrams: "omit" }) },
    diagrams: [{ title: "Shared", status: "approved", svg: "never" }], figures: [{ title: "Shared", fileId: "never" }],
  });
  assert.equal(state.jobsRead(), 0);
  assert.equal(state.reads.length, 0);
  assert.equal(state.rasters.length, 0);
  assert.equal(result.missingImages, 0);
  assert.equal(state.renders[0].options!.profile!.cover, null);
  assert.equal(state.renders[0].options!.profile!.includeToc, false);
  assert.equal(state.renders[0].options!.outputMode, "answer");
  assert.ok(state.renders[0].draft.startsWith("Teks tetap."));
  assert.ok(state.renders[0].draft.includes("```md\n[Gambar: Contoh]\n```"));
});

test("a single requested report section exports without a whole-report cover or chapter numbering", async () => {
  const state = await mockedSessionExport();
  await state.run({ sessionId: "session", ownerId: "owner", title: "Hasil", draft: "## Hasil\nData pengujian.", brief: { intent: intentHelpers.classifyReportIntent("Hanya bagian Hasil, maksimal 100 kata, tanpa diagram") }, diagrams: [] });
  assert.equal(state.renders[0].options!.outputMode, "full_report");
  assert.equal(state.renders[0].options!.numberChapters, false);
  assert.equal(state.renders[0].options!.profile!.cover, null);
  assert.equal(state.renders[0].options!.profile!.includeToc, false);
});

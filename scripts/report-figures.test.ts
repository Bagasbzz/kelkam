import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { Packer } from "docx";
import { figurePlaceholders, normalizeFigureKey, parseFigurePlaceholder, reconcileFigurePlaceholders } from "../src/lib/report/figure-placeholders";
import { buildDocxDocument, DOCX_PRESETS, parseMarkdownToBlocks } from "../src/utils/markdown-docx-exporter";

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

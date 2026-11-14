import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { CATALOG_FONTS, CATALOG_PAIR_IDS, FONT_PAIRS } from "../src/lib/presentation/fonts.ts";
import { FONT_METRICS } from "../src/lib/presentation/font-metrics.ts";
import { parseTtf, toEot } from "../src/lib/presentation/ttf.ts";
import { textWidth } from "../src/lib/presentation/layout.ts";
import { exportDeckPptx } from "../src/lib/presentation/export-pptx.ts";
import { createStarterDeck } from "../src/lib/presentation/model.ts";
import { STYLE_EXAMPLES } from "../src/lib/presentation/design.ts";

const fontDir = path.join(process.cwd(), "public", "fonts", "presentasi");

test("every catalog font file exists, is embeddable and has metrics", async () => {
  for (const font of CATALOG_FONTS) for (const weight of font.weights) {
    const file = `${font.slug}-${weight}.ttf`;
    const info = parseTtf(await readFile(path.join(fontDir, file)));
    assert.equal(info.family, font.family, file);
    assert.equal(info.fsType & 0x2, 0, `${file} must allow embedding`);
    assert.ok(FONT_METRICS[`${font.family}${weight >= 600 ? "|b" : ""}`], `${file} has metrics`);
  }
  for (const id of CATALOG_PAIR_IDS) {
    for (const face of [FONT_PAIRS[id].heading, FONT_PAIRS[id].body]) assert.ok(CATALOG_FONTS.some((font) => font.family === face), `${id}: ${face}`);
  }
});

test("catalog metrics measure real widths: condensed is narrower than wide display faces", () => {
  const sample = "Pengelolaan Keuangan Mahasiswa";
  assert.ok(textWidth(sample, 40, "Bebas Neue") < textWidth(sample, 40, "Unbounded", true));
  assert.ok(textWidth(sample, 20, "Nunito", true) > textWidth(sample, 20, "Nunito"));
});

test("EOT wrapper matches the PowerPoint .fntdata layout and carries the untouched font", async () => {
  const font = await readFile(path.join(fontDir, "outfit-400.ttf"));
  const info = parseTtf(font);
  const eot = toEot(font, info);
  assert.equal(eot.readUInt32LE(0), eot.length);
  assert.equal(eot.readUInt32LE(4), font.length);
  assert.equal(eot.readUInt32LE(8), 0x00020002);
  assert.equal(eot.readUInt32LE(12), 0, "uncompressed");
  assert.equal(eot.readUInt16LE(34), 0x504c, "magic");
  assert.ok(eot.subarray(eot.length - font.length).equals(font));
  assert.ok(eot.includes(Buffer.from("Outfit", "utf16le")));
});

test("PPTX export embeds the catalog fonts a designed deck uses", async () => {
  const deck = createStarterDeck("editorial");
  const style = STYLE_EXAMPLES.find((item) => item.design.fonts === "vintage")!;
  const buffer = await exportDeckPptx({ ...deck, design: { ...style.design, seed: 7 } });
  const zip = await JSZip.loadAsync(buffer);
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  assert.match(presentation, /embedTrueTypeFonts="1"/);
  assert.match(presentation, /<p:notesSz[^>]*\/><p:embeddedFontLst>/);
  assert.match(presentation, /<p:font typeface="Fraunces"[^>]*\/><p:bold r:id="rIdFont\d+"\/>/);
  assert.match(presentation, /<p:font typeface="Outfit"[^>]*\/><p:regular r:id="rIdFont\d+"\/>/);
  const fonts = Object.keys(zip.files).filter((name) => name.startsWith("ppt/fonts/") && name.endsWith(".fntdata"));
  assert.ok(fonts.length >= 2);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /Extension="fntdata" ContentType="application\/x-fontdata"/);
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  for (const name of fonts) assert.ok(rels.includes(`Target="${name.replace("ppt/", "")}"`));
  // Spasi baris tepat (poin) untuk font katalog.
  assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /<a:lnSpc><a:spcPts val="\d+"\/><\/a:lnSpc>/);
});

test("decks with system fonts export without embedded font parts", async () => {
  const buffer = await exportDeckPptx(createStarterDeck("playful"));
  const zip = await JSZip.loadAsync(buffer);
  assert.equal(Object.keys(zip.files).some((name) => name.startsWith("ppt/fonts/")), false);
  assert.doesNotMatch(await zip.file("ppt/presentation.xml")!.async("string"), /embeddedFontLst/);
});

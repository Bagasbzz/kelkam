import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import { KIT_IDS, DESIGN_LAYOUT_IDS, type PresentationDeck, type PresentationSlide } from "../src/lib/presentation/model.ts";
import { KIT_TEMPLATES } from "../src/lib/presentation/kits.ts";
import { sceneFor, STYLE_EXAMPLES } from "../src/lib/presentation/design.ts";
import { renderSlideSvg } from "../src/lib/presentation/layout.ts";
import { exportDeckPptx } from "../src/lib/presentation/export-pptx.ts";

const slide = (layout: PresentationSlide["layout"], body: string[]): PresentationSlide => ({ id: randomUUID(), layout, title: "Analisis Laporan Keuangan Mahasiswa", eyebrow: layout === "cover" || layout === "section" ? "Presentasi" : "", body, notes: "", source: "", locked: false });
const body = ["Sederhana: tiga ketukan untuk mencatat transaksi.", "Luring: data tersimpan tanpa internet.", "Aman: PIN untuk membuka aplikasi."];

function deckFor(templateId: string): PresentationDeck {
  const template = KIT_TEMPLATES.find((item) => item.id === templateId)!;
  return { id: randomUUID(), title: "SakuRapi", theme: "editorial", design: { ...template.design, seed: 7, institution: "Universitas Contoh" }, slides: DESIGN_LAYOUT_IDS.map((layout) => slide(layout, layout === "cover" ? ["Subjudul", "Disusun oleh: Nama", "NIM: 123"] : body)) };
}

test("every kit has a template, and the offered style examples are the kit templates", () => {
  assert.deepEqual([...new Set(KIT_TEMPLATES.map((item) => item.kit))].sort(), [...KIT_IDS].sort());
  assert.equal(STYLE_EXAMPLES.length, KIT_TEMPLATES.length);
  for (const style of STYLE_EXAMPLES) assert.ok(style.design.kit, style.id);
});

test("every kit renders every layout with editable title and body and stays mostly on the slide", () => {
  for (const template of KIT_TEMPLATES) {
    const deck = deckFor(template.id);
    deck.slides.forEach((item, index) => {
      const scene = sceneFor(deck, index);
      const keys = scene.elements.map((element) => element.editKey).filter(Boolean);
      assert.ok(keys.includes("title"), `${template.id}/${item.layout} title`);
      if (!["quote", "closing", "section", "figure"].includes(item.layout)) assert.ok(keys.includes("body-0"), `${template.id}/${item.layout} body`);
      for (const element of scene.elements) {
        if (element.type !== "text") continue;
        // Teks isi tidak boleh keluar dari slide.
        assert.ok(element.x >= -0.05 && element.x + element.w <= 13.333 + 0.05 && element.y >= -0.05 && element.y <= 7.5, `${template.id}/${item.layout} text in slide`);
      }
      assert.match(renderSlideSvg(scene), /<svg /);
    });
  }
});

test("textures are tinted by the deck colors in the preview and in the PPTX, and stored once", async () => {
  const deck = deckFor("scrapbook-denim");
  const svg = renderSlideSvg(sceneFor(deck, 0));
  assert.match(svg, /href="\/aset-presentasi\/denim\.png"/);
  assert.match(svg, /<feColorMatrix type="matrix"/);
  const zip = await JSZip.loadAsync(await exportDeckPptx(deck));
  const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(slideXml, /<a:duotone><a:srgbClr val="[0-9A-F]{6}"\/><a:srgbClr val="[0-9A-F]{6}"\/><\/a:duotone>/);
  const media = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/") && !zip.files[name].dir);
  // Tekstur yang sama di banyak slide disimpan sekali.
  assert.ok(media.length <= 8, `media ${media.length}`);
});

test("open strokes export without fill and two-tone titles export as colored runs", async () => {
  const zip = await JSZip.loadAsync(await exportDeckPptx(deckFor("korporat-navy")));
  const cover = await zip.file("ppt/slides/slide1.xml")!.async("string");
  // Judul dua warna: kata-kata akhir memakai warna aksen sebagai run tersendiri.
  assert.match(cover, /<a:rPr[^>]*>(?:(?!<\/a:rPr>)[\s\S])*<a:srgbClr val="F7A41D"\/>(?:(?!<\/a:rPr>)[\s\S])*<\/a:rPr><a:t>KEUANGAN/);
  const process = await zip.file(`ppt/slides/slide${DESIGN_LAYOUT_IDS.indexOf("process") + 1}.xml`)!.async("string");
  assert.match(process, /prstDash val="dash"|<a:prstDash val="dash"\/>/);
});

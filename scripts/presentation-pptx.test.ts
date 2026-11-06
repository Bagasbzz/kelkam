import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createStarterDeck, PALETTE_IDS, THEME_IDS, THEMES, type PresentationSlide } from "../src/lib/presentation/model";
import { exportDeckPptx } from "../src/lib/presentation/export-pptx";
import { adjustSlideElement, layoutSlide, renderSlideSvg } from "../src/lib/presentation/layout";
import { DESIGN_PRESETS } from "../src/lib/presentation/presets";

test("PPTX exporter validates input before generating a file", async () => {
  await assert.rejects(exportDeckPptx({ slides: [] }));
  const deck = createStarterDeck("product");
  await assert.rejects(exportDeckPptx({ ...deck, injected: true }));
});

test("every demo exports native editable texts, shapes, exact geometry and source-bearing notes offline", async () => {
  for (const theme of THEME_IDS) {
    const deck = createStarterDeck(theme);
    const buffer = await exportDeckPptx(deck);
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 2).toString(), "PK");
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);
    assert.equal(names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, deck.slides.length);
    assert.equal(names.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length, deck.slides.length);
    assert.equal(names.filter((name) => name.startsWith("ppt/media/") && !zip.files[name].dir).length, 0);
    const presentation = await zip.file("ppt/presentation.xml")!.async("string");
    assert.ok(presentation.includes(`cx="${Math.round(13.333 * 914400)}"`));
    assert.ok(presentation.includes(`cy="${Math.round(7.5 * 914400)}"`));
    const core = await zip.file("docProps/core.xml")!.async("string");
    assert.ok(core.includes("KeluhKampus Presentation Studio"));
    const themeXml = await zip.file("ppt/theme/theme1.xml")!.async("string");
    assert.ok(themeXml.includes(THEMES[theme].headingFont));
    assert.ok(themeXml.includes("Arial"));
    for (const [index, slide] of deck.slides.entries()) {
      const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`)!.async("string");
      const notes = await zip.file(`ppt/notesSlides/notesSlide${index + 1}.xml`)!.async("string");
      const scene = layoutSlide(slide, theme, index, deck.slides.length, deck.artDirection);
      assert.equal((xml.match(/<p:sp>/g) ?? []).length, scene.elements.length);
      assert.ok(xml.includes("<a:t>"));
      assert.ok(xml.includes("<a:prstGeom"));
      if (scene.elements.some((element) => element.type === "shape" && element.shape === "polygon")) assert.match(xml, /<a:custGeom>/);
      assert.doesNotMatch(xml, /<p:pic>|<a:blip/);
      for (const element of scene.elements) {
        assert.ok(xml.includes(`x="${Math.round(element.x * 914400)}"`));
        assert.ok(xml.includes(`y="${Math.round(element.y * 914400)}"`));
        if (element.type === "text") {
          for (const value of element.lines) assert.ok(xml.includes(value), `${theme}/${slide.layout}: ${value}`);
        }
      }
      assert.ok(notes.includes(slide.notes));
      assert.ok(notes.includes(slide.source));
      assert.ok(notes.includes("Sumber:"));
    }
    for (const name of names.filter((name) => name.endsWith(".rels"))) {
      const xml = await zip.file(name)!.async("string");
      assert.doesNotMatch(xml, /TargetMode="External"/);
    }
  }
});

test("native transitions and real reveal entrances target editable heading IDs without Morph", async () => {
  const deck = createStarterDeck("product");
  deck.slides = (["none", "fade", "push", "reveal"] as const).map((motion, index) => ({
    ...deck.slides[index], visual: { ...deck.slides[index].visual!, motion },
  }));
  const zip = await JSZip.loadAsync(await exportDeckPptx(deck));
  const xmls = await Promise.all(deck.slides.map((_, i) => zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string")));
  assert.doesNotMatch(xmls[0], /<p:transition|<p:timing/);
  assert.match(xmls[1], /<p:transition spd="med" advClick="1"><p:fade\/>/);
  assert.match(xmls[2], /<p:push dir="l"\/>/);
  assert.doesNotMatch(xmls[2], /<p:timing/);
  assert.match(xmls[3], /presetClass="entr"/);
  assert.match(xmls[3], /<p:animEffect transition="in" filter="fade">/);
  assert.match(xmls[3], /dur="550"/);
  assert.match(xmls[3], /<p:cond evt="onBegin" delay="0"><p:tn val="2"\/><\/p:cond>/);
  assert.match(xmls[3], /<p:prevCondLst>/);
  assert.match(xmls[3], /<p:bldLst><p:bldP spid="\d+" grpId="0" animBg="1"\/><\/p:bldLst>/);
  const target = /<p:spTgt spid="(\d+)"/.exec(xmls[3])![1];
  assert.ok(xmls[3].includes(`<p:cNvPr id="${target}" name="studio-`));
  assert.ok(xmls[3].indexOf("</p:clrMapOvr>") < xmls[3].indexOf("<p:transition"));
  assert.ok(xmls[3].indexOf("</p:transition>") < xmls[3].indexOf("<p:timing>"));
  assert.doesNotMatch(xmls.join(""), /morph|TargetMode="External"/i);
});

test("supplied raster bytes alone are embedded with centered crop, transparent cutouts and native type", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const deck = createStarterDeck("playful");
  deck.slides = (["hero", "background", "cutout"] as const).map((role, i) => ({ ...deck.slides[i], art: { fileId: "owned-image", role, alt: "Kegiatan kampus & kolase" } }));
  await assert.rejects(exportDeckPptx(deck), /Aset gambar slide tidak tersedia: owned-image/);
  await assert.rejects(exportDeckPptx(deck, { assets: Object.create({ "owned-image": { data: png, mime: "image/png" } }) }), /tidak tersedia/);
  const zip = await JSZip.loadAsync(await exportDeckPptx(deck, { assets: { "owned-image": { data: png, mime: "image/png" } } }));
  const media = Object.values(zip.files).filter((file) => file.name.startsWith("ppt/media/") && !file.dir);
  assert.ok(media.length > 0);
  for (const file of media) assert.deepEqual(await file.async("nodebuffer"), png);
  for (const [i, slide] of deck.slides.entries()) {
    const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string");
    assert.match(xml, /<p:pic>/);
    assert.match(xml, /descr="Kegiatan kampus &amp; kolase"/);
    assert.match(xml, /<a:t>/);
    if (slide.art!.role !== "cutout") assert.match(xml, /<a:srcRect l="\d+" r="\d+" t="\d+" b="\d+"\/>/);
    else assert.doesNotMatch(xml, /<a:srcRect/);
  }
  for (const file of Object.values(zip.files).filter((file) => file.name.endsWith(".rels"))) assert.doesNotMatch(await file.async("string"), /TargetMode="External"/);
  await assert.rejects(exportDeckPptx(deck, { assets: { "owned-image": { data: Buffer.from("<svg>not a PNG</svg> padded"), mime: "image/png" } } }), /tidak valid/);
  const oversized = Buffer.from(png); oversized.writeUInt32BE(100000, 16);
  await assert.rejects(exportDeckPptx(deck, { assets: { "owned-image": { data: oversized, mime: "image/png" } } }), /dimensinya/);
});

test("PPTX safely encodes special characters and preserves private notes as editable notes", async () => {
  const deck = createStarterDeck("editorial");
  deck.slides = [{ ...deck.slides[0], title: "Riset <A> & B", notes: "Catatan <aman> & bukan markup", source: "Sumber A & B" }];
  const zip = await JSZip.loadAsync(await exportDeckPptx(deck));
  const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
  assert.match(slide, /Riset &lt;A&gt; &amp; B/);
  assert.match(notes, /Catatan &lt;aman&gt; &amp; bukan markup/);
  assert.match(notes, /Sumber A &amp; B/);
  assert.doesNotMatch(slide, /Catatan/);
});

test("adjusted title, duplicate body slots and images share exact native PPTX and SVG geometry", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  for (const role of ["hero", "background", "cutout"] as const) {
    const deck = createStarterDeck("editorial");
    deck.palette = "rose";
    let slide: PresentationSlide = { ...deck.slides[1], title: "Judul yang bisa dipindahkan", body: ["Isi sama", "Isi sama"], visual: { ...deck.slides[1].visual!, motion: "reveal" }, art: { fileId: "owned", role, alt: "Gambar aman" } };
    const titleBounds = { x: 1.1, y: 0.6, w: 8.1, h: 0.9 };
    const bodyBounds = { x: 2.1, y: 3.4, w: 3.1, h: 0.5 };
    const artBounds = { x: 9.1, y: 3.2, w: 2, h: 2 };
    slide = adjustSlideElement(slide, "title", titleBounds);
    slide = adjustSlideElement(slide, "body-1", bodyBounds);
    slide = adjustSlideElement(slide, "art", artBounds);
    deck.slides = [slide];
    const scene = layoutSlide(slide, deck.theme, 0, 1, deck.artDirection, deck.palette);
    const svg = renderSlideSvg(scene);
    const zip = await JSZip.loadAsync(await exportDeckPptx(deck, { assets: { owned: { data: png, mime: "image/png" } } }));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    assert.ok(xml.includes(`<a:srgbClr val="${scene.background}"`));
    for (const [index, element] of scene.elements.entries()) {
      if (!["title", "body-0", "body-1", "art"].includes(element.editKey ?? "")) continue;
      const tag = element.type === "image" ? "pic" : "sp";
      const nodes = xml.match(new RegExp(`<p:${tag}>[\\s\\S]*?<\\/p:${tag}>`, "g")) ?? [];
      const node = nodes.find((value) => value.includes(`name="studio-${index}"`));
      assert.ok(node, `${role}/${element.editKey} remains native`);
      assert.ok(node.includes(`<a:off x="${Math.round(element.x * 914400)}" y="${Math.round(element.y * 914400)}"/>`));
      assert.ok(node.includes(`<a:ext cx="${Math.round(element.w * 914400)}" cy="${Math.round(element.h * 914400)}"/>`));
      if (element.type === "text") {
        for (const line of element.lines) assert.ok(node.includes(`<a:t>${line}</a:t>`));
        assert.ok(node.includes(`sz="${Math.round(element.fontSize * 100)}"`));
        assert.match(node, /lIns="0" tIns="0" rIns="0" bIns="0"/);
        const textNode = (svg.match(/<text[\s\S]*?<\/text>/g) ?? []).find((value) => value.includes(`data-edit-key="${element.editKey}"`));
        assert.ok(textNode?.includes(`x="${element.x * 96}" y="${element.y * 96 + element.fontSize * 96 / 72}"`));
      } else assert.ok(svg.includes(`<svg data-edit-key="art" x="${element.x * 96}" y="${element.y * 96}" width="${element.w * 96}" height="${element.h * 96}"`));
    }
    const titleIndex = scene.elements.findIndex((element) => element.editKey === "title");
    const titleId = new RegExp(`<p:cNvPr id="(\\d+)" name="studio-${titleIndex}"`).exec(xml)![1];
    assert.ok(xml.includes(`<p:spTgt spid="${titleId}"`));
    assert.match(xml, /<p:timing>/);
    assert.match(xml, /<p:bldLst>/);
    assert.equal(scene.elements.find((element) => element.editKey === "body-0")!.x, 1.5);
    assert.equal(scene.elements.find((element) => element.editKey === "body-1")!.x, bodyBounds.x);
  }
});

test("PPTX rejects unsafe persisted geometry before resolving assets", async () => {
  const deck = createStarterDeck("product");
  const slide = { ...deck.slides[0], art: { fileId: "missing", role: "hero", alt: "Art" } };
  const bounds = { target: "title", x: 0, y: 0, w: 1, h: 1 };
  for (const adjustments of [
    [{ ...bounds, x: NaN }], [{ ...bounds, h: Infinity }], [{ ...bounds, w: -1 }],
    [{ ...bounds, x: 13 }], [{ ...bounds, y: 7 }], [bounds, bounds], [{ ...bounds, target: "remote" }],
  ]) await assert.rejects(exportDeckPptx({ ...deck, slides: [{ ...slide, adjustments }] }), (error: Error) => !error.message.includes("Aset gambar"));
});

test("every palette and authored preset exports native distinct colors and system fonts offline", async () => {
  const signatures = new Set<string>();
  for (const preset of DESIGN_PRESETS) {
    const deck = createStarterDeck(preset.theme);
    deck.artDirection = preset.artDirection;
    deck.palette = preset.palette;
    deck.slides = [{ ...deck.slides[0], title: "Pratinjau desain", body: ["Gagasan utama"], visual: undefined }];
    const scene = layoutSlide(deck.slides[0], deck.theme, 0, 1, deck.artDirection, deck.palette);
    const zip = await JSZip.loadAsync(await exportDeckPptx(deck));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    assert.ok(xml.includes(`<a:srgbClr val="${scene.background}"`));
    assert.match(xml, /<a:t>Pratinjau/);
    assert.doesNotMatch(xml, /<p:pic>|<a:blip/);
    signatures.add(xml);
  }
  assert.equal(signatures.size, 10);
  const deck = createStarterDeck("playful");
  deck.slides = PALETTE_IDS.map((palette) => ({ ...deck.slides[0], id: crypto.randomUUID(), title: palette }));
  for (const palette of PALETTE_IDS) {
    const single = { ...deck, palette, slides: [deck.slides[0]] };
    const zip = await JSZip.loadAsync(await exportDeckPptx(single));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const scene = layoutSlide(single.slides[0], single.theme, 0, 1, single.artDirection, palette);
    assert.ok(xml.includes(`<a:srgbClr val="${scene.background}"`));
  }
});

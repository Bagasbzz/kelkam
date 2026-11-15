import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { deckSchema, slideAnimation, ANIMATION_PRESETS, type PresentationDeck, type PresentationSlide } from "../src/lib/presentation/model";
import { buildPlan, elementBuildGroup } from "../src/lib/presentation/motion";
import { renderSlideSvg } from "../src/lib/presentation/layout";
import { sceneFor, STYLE_EXAMPLES } from "../src/lib/presentation/design";
import { exportDeckPptx } from "../src/lib/presentation/export-pptx";

const slide = (layout: PresentationSlide["layout"], title: string, body: string[], extra: Partial<PresentationSlide> = {}): PresentationSlide =>
  ({ id: randomUUID(), layout, title, eyebrow: "", body, notes: "", source: "", locked: false, ...extra });

function kitDeck(animation?: PresentationDeck["animation"], kit = 0): PresentationDeck {
  const deck: PresentationDeck = {
    id: randomUUID(), title: "Uji animasi", theme: "editorial",
    design: { ...STYLE_EXAMPLES[kit].design, seed: 77 },
    slides: [
      slide("cover", "Aplikasi Keuangan Mahasiswa", ["Subjudul", "Disusun oleh: Nama"]),
      slide("bullets", "Masalah utama yang dihadapi", ["Poin satu.", "Poin dua.", "Poin tiga."]),
      slide("cards", "Empat landasan rancangan", ["Sederhana: tiga ketukan.", "Luring: SQLite.", "Aman: PIN.", "Jelas: grafik."]),
      slide("process", "Alur kerja", ["Daftar", "Catat", "Tinjau"]),
    ],
  };
  if (animation) deck.animation = animation;
  return deck;
}

test("animation model accepts old data and maps legacy motion values to presets", () => {
  const deck = kitDeck();
  assert.ok(deckSchema.safeParse(deck).success, "deck lama tanpa animation tetap valid");
  assert.equal(slideAnimation(deck, deck.slides[0]), "none", "tanpa pilihan apa pun berarti tanpa animasi (K23)");
  const withVisual = (motion?: NonNullable<PresentationSlide["visual"]>["motion"]) => ({ visual: { motif: "none" as const, background: "solid" as const, ...(motion ? { motion } : {}) } });
  assert.equal(slideAnimation(deck, withVisual("fade")), "halus");
  assert.equal(slideAnimation(deck, withVisual("reveal")), "halus");
  assert.equal(slideAnimation(deck, withVisual("push")), "dinamis");
  assert.equal(slideAnimation({ animation: "ceria" }, withVisual()), "ceria", "slide tanpa motion ikut preset deck");
  assert.equal(slideAnimation({ animation: "ceria" }, withVisual("none")), "none", "pilihan per slide menimpa deck");
  for (const preset of ANIMATION_PRESETS) assert.ok(deckSchema.safeParse({ ...deck, animation: preset }).success);
  assert.ok(!deckSchema.safeParse({ ...deck, animation: "meledak" }).success);
});

test("buildPlan orders title, art, each point, then decorations, and keeps backgrounds still", () => {
  for (const [kit] of STYLE_EXAMPLES.entries()) {
    const deck = kitDeck("halus", kit);
    for (const [index] of deck.slides.entries()) {
      const scene = sceneFor(deck, index);
      const plan = buildPlan(scene, "halus");
      assert.equal(plan.transition, "fade");
      const order = ["title", "art", "body-0", "body-1", "body-2", "body-3", "deco"];
      const groups = plan.steps.map((step) => step.group);
      assert.deepEqual(groups, [...groups].sort((a, b) => order.indexOf(a) - order.indexOf(b)), `urutan grup ${STYLE_EXAMPLES[kit].id} slide ${index + 1}`);
      for (let k = 1; k < plan.steps.length; k++) assert.ok(plan.steps[k].delayMs > plan.steps[k - 1].delayMs, "jeda bertahap");
      const moving = new Set(plan.steps.flatMap((step) => step.elements));
      scene.elements.forEach((element, i) => {
        const fullBleed = element.w >= scene.width * 0.9 && element.h >= scene.height * 0.9;
        if (element.type === "image" && (element.role === "background" || fullBleed)) assert.ok(!moving.has(i), "latar tidak boleh ikut hilang-muncul");
        if (element.type === "text" && element.editKey === "title") assert.ok(moving.has(i), "judul selalu beranimasi");
      });
      if (deck.slides[index].layout === "bullets") assert.equal(plan.steps.filter((step) => step.group.startsWith("body-")).length, 3, "poin muncul satu per satu");
    }
  }
  const scene = sceneFor(kitDeck("halus"), 1);
  assert.deepEqual(buildPlan(scene, "none"), { transition: "none", steps: [] });
  assert.equal(buildPlan(scene, "dinamis").transition, "push");
  assert.equal(buildPlan(scene, "ketik").steps[0].effect, "word");
  assert.equal(buildPlan(scene, "ceria").steps[0].effect, "pop");
  assert.ok(scene.elements.some((element) => elementBuildGroup(element) === "deco"), "kit menandai dekorasi kecil");
});

test("web renderer adds animation wrappers only when a plan is given; Ketik splits the title per word", () => {
  const deck = kitDeck("ketik");
  const scene = sceneFor(deck, 1);
  const still = renderSlideSvg(scene);
  assert.doesNotMatch(still, /data-build|data-word/, "editor dan thumbnail tidak berubah");
  const typed = renderSlideSvg(scene, buildPlan(scene, "ketik"));
  const words = deck.slides[1].title.split(" ").length;
  assert.ok((typed.match(/data-word=""/g) ?? []).length >= words, "tiap kata judul punya tspan sendiri");
  assert.match(typed, /data-word="" style="animation-delay:120ms;animation-duration:300ms"/);
  const bouncy = renderSlideSvg(scene, buildPlan(scene, "ceria"));
  assert.match(bouncy, /<g data-build="pop" style="animation-delay:0ms;animation-duration:600ms">/);
  assert.match(bouncy, /data-build="rise"/);
});

test("PPTX writes per-shape entrance effects per preset with staggered delays", async () => {
  const expected = {
    halus: { transition: "<p:fade/>", presets: ["10"] },
    dinamis: { transition: '<p:push dir="l"/>', presets: ["42"] },
    ceria: { transition: "<p:fade/>", presets: ["53", "42"] },
    ketik: { transition: "<p:fade/>", presets: ["10", "22"] },
  } as const;
  for (const [preset, want] of Object.entries(expected) as [keyof typeof expected, (typeof expected)[keyof typeof expected]][]) {
    const deck = kitDeck(preset);
    const zip = await JSZip.loadAsync(await exportDeckPptx(deck));
    for (let i = 1; i <= deck.slides.length; i++) {
      const xml = await zip.file(`ppt/slides/slide${i}.xml`)!.async("string");
      assert.ok(xml.includes(`<p:transition spd="med" advClick="1">${want.transition}`), `${preset} slide ${i} transisi`);
      const ids = [...xml.matchAll(/<p:cTn id="(\d+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, "id cTn unik");
      const delays = [...xml.matchAll(/nodeType="withEffect"><p:stCondLst><p:cond delay="(\d+)"/g)].map((m) => Number(m[1]));
      assert.ok(delays.length >= 3, "beberapa efek per slide");
      assert.ok(new Set(delays).size >= 2, "jeda bertahap");
      for (const [, spid] of xml.matchAll(/<p:spTgt spid="(\d+)"/g)) assert.match(xml, new RegExp(`<p:cNvPr id="${spid}" name="studio-\\d+"`));
      for (const id of want.presets) if (i === 2) assert.match(xml, new RegExp(`presetID="${id}" presetClass="entr"`), `${preset} memakai efek ${id}`);
    }
    const second = await zip.file("ppt/slides/slide2.xml")!.async("string");
    if (preset === "ketik") assert.match(second, /<p:iterate type="wd"><p:tmAbs val="120"\/><\/p:iterate><p:childTnLst>/);
    if (preset === "ceria") assert.match(second, /<p:strVal val="#ppt_w\*1.12"\/>/);
    if (preset === "dinamis") assert.match(second, /<p:strVal val="#ppt_y\+.1"\/>/);
  }
  const still = await JSZip.loadAsync(await exportDeckPptx(kitDeck()));
  for (let i = 1; i <= 4; i++) assert.doesNotMatch(await still.file(`ppt/slides/slide${i}.xml`)!.async("string"), /<p:transition|<p:timing/, "deck tanpa animasi tetap polos");
});

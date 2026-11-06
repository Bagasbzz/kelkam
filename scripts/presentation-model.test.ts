import assert from "node:assert/strict";
import test from "node:test";
import { ART_STYLES, createStarterDeck, deckSchema, EDIT_TARGETS, inspectDeck, LAYOUT_IDS, PALETTE_IDS, slideSchema, THEME_IDS, THEMES, validateDeck, VISUAL_MOTIFS, type SlideEditTarget } from "../src/lib/presentation/model";
import { adjustSlideElement, constrainBounds, layoutSlide, renderSlideSvg, SLIDE_HEIGHT, SLIDE_WIDTH } from "../src/lib/presentation/layout";
import { DESIGN_PRESETS, PALETTES } from "../src/lib/presentation/presets";

test("starter decks are distinct Indonesian narratives covering every native layout", () => {
  const decks = THEME_IDS.map(createStarterDeck);
  assert.equal(new Set(decks.map((deck) => deck.title)).size, 3);
  assert.equal(new Set(decks.map((deck) => deck.id)).size, 3);
  for (const deck of decks) {
    assert.ok(validateDeck(deck).success);
    assert.deepEqual(deck.slides.map((slide) => slide.layout), [...LAYOUT_IDS]);
    assert.equal(new Set(deck.slides.map((slide) => slide.id)).size, 5);
    assert.ok(deck.slides.every((slide) => !slide.locked && slide.notes.length > 20 && slide.source.includes("demonstrasi")));
    assert.deepEqual(inspectDeck(deck), []);
    assert.ok(["Arial", "Arial Black", "Impact", "Georgia"].includes(THEMES[deck.theme].headingFont));
    assert.ok(deck.artDirection && deck.artDirection.concept.length > 30);
    assert.ok(deck.slides.every((slide) => slide.visual));
    assert.match(THEMES[deck.theme].accent, /^[A-F0-9]{6}$/);
  }
});

test("moving an object preserves temporarily blank draft text until full save validation", () => {
  const draft = { ...createStarterDeck("editorial").slides[0], title: "", body: [""] };
  const updated = adjustSlideElement(draft, "art", { x: 3, y: 1, w: 2, h: 2 });
  assert.equal(updated.title, "");
  assert.deepEqual(updated.body, [""]);
  assert.equal(updated.adjustments?.[0].target, "art");
  assert.equal(slideSchema.safeParse(updated).success, false, "persistence must still reject unfinished text");
});

test("optional art contract preserves older decks and rejects raw resources or unbounded fields", () => {
  const deck = createStarterDeck("playful");
  const legacy = { ...deck };
  delete legacy.artDirection;
  legacy.slides = legacy.slides.map((slide) => { const copy = { ...slide }; delete copy.visual; return copy; });
  assert.ok(validateDeck(legacy).success);
  const slide = deck.slides[0];
  const art = { fileId: "a".repeat(100), role: "hero", alt: "a".repeat(300) };
  assert.ok(slideSchema.safeParse({ ...slide, art }).success);
  for (const bad of [
    { ...art, fileId: "" }, { ...art, fileId: "a".repeat(101) }, { ...art, fileId: "https://example.com/a.png" },
    { ...art, fileId: "../secret" }, { ...art, fileId: "." }, { ...art, fileId: ".." }, { ...art, alt: "a".repeat(301) }, { ...art, role: "svg" }, { ...art, url: "https://example.com" },
  ]) assert.equal(slideSchema.safeParse({ ...slide, art: bad }).success, false);
  for (const style of ART_STYLES) assert.ok(validateDeck({ ...deck, artDirection: { style, concept: "x".repeat(400) } }).success);
  assert.equal(validateDeck({ ...deck, artDirection: { style: "zine", concept: "x".repeat(401) } }).success, false);
  assert.equal(validateDeck({ ...deck, artDirection: { style: "custom", concept: "" } }).success, false);
  assert.equal(slideSchema.safeParse({ ...slide, visual: { ...slide.visual, svg: "<svg/>" } }).success, false);
  assert.equal(slideSchema.safeParse({ ...slide, visual: { ...slide.visual, motion: "morph" } }).success, false);
});

test("art directions produce distinct authored texture and native topic scenes with readable demo text", () => {
  const signatures = new Set<string>();
  for (const theme of THEME_IDS) {
    const deck = createStarterDeck(theme);
    for (const slide of deck.slides) {
      const scene = layoutSlide(slide, theme, 0, 5, deck.artDirection);
      for (const element of scene.elements) {
        if (element.type === "text" && [slide.title, ...slide.body].includes(element.text)) assert.ok(element.fontSize >= 16, `${theme}/${slide.layout}/${element.fontSize}`);
      }
      assert.doesNotMatch(scene.elements.filter((element) => element.type === "text").map((element) => element.text).join("\n"), /^(Ide|Aksi|Dampak)$|PRESENTATION STUDIO/m);
    }
    const scene = layoutSlide(deck.slides[0], theme, 0, 5, deck.artDirection);
    signatures.add(JSON.stringify(scene.elements));
    assert.ok(scene.elements.some((element) => element.type === "shape" && element.opacity !== undefined));
    const heading = scene.elements.find((element) => element.type === "text" && element.text === deck.slides[0].title);
    assert.ok(heading && heading.type === "text" && heading.fontSize >= 40);
  }
  assert.equal(signatures.size, 3);
  for (const style of ART_STYLES) for (const motif of VISUAL_MOTIFS) {
    const deck = createStarterDeck("product");
    const scene = layoutSlide({ ...deck.slides[0], visual: { motif, background: "grid", motion: "none" } }, "product", 0, 1, { style, concept: "Test" });
    assert.ok(scene.elements.length < 300);
    assert.match(renderSlideSvg(scene), /<line/);
    for (const element of scene.elements) {
      assert.ok(element.x >= 0 && element.y >= 0 && element.x + element.w <= SLIDE_WIDTH + 0.001 && element.y + element.h <= SLIDE_HEIGHT + 0.001);
    }
  }
});

test("images use safe internal encoded IDs and shared cover/contain geometry", () => {
  const deck = createStarterDeck("playful");
  for (const role of ["hero", "background", "cutout"] as const) for (const layout of LAYOUT_IDS) {
    const slide = { ...deck.slides[0], layout, art: { fileId: 'image &"<>', role, alt: '<script> & image' } };
    const scene = layoutSlide(slide, deck.theme, 0, 1, deck.artDirection);
    const image = scene.elements.find((element) => element.type === "image");
    assert.ok(image && image.type === "image");
    assert.equal(image.crop, role === "cutout" ? "contain" : "cover");
    assert.equal(image.role, role);
    const svg = renderSlideSvg(scene);
    assert.ok(svg.includes(`/api/files/${encodeURIComponent(slide.art.fileId)}`));
    assert.ok(svg.includes(role === "cutout" ? "xMidYMid meet" : "xMidYMid slice"));
    assert.ok(svg.includes("&lt;script&gt;"));
    assert.doesNotMatch(svg, /<script|onload=|href="https?:/);
  }
});

test("schema rejects malformed types, UUIDs, extra keys, unsafe controls and duplicate slide IDs", () => {
  const deck = createStarterDeck("product");
  const invalid: unknown[] = [
    null, [], "deck", {}, { ...deck, id: "not-a-uuid" }, { ...deck, theme: "external" },
    { ...deck, title: " " }, { ...deck, arbitraryCode: "alert(1)" },
    { ...deck, slides: [deck.slides[0], deck.slides[0]] },
    { ...deck, slides: [{ ...deck.slides[0], locked: "false" }] },
    { ...deck, slides: [{ ...deck.slides[0], layout: "remote-image" }] },
    { ...deck, slides: [{ ...deck.slides[0], body: "wrong type" }] },
    { ...deck, slides: [{ ...deck.slides[0], source: "https://example.com", image: "https://example.com/img" }] },
    { ...deck, title: "bad\u0000text" }, { ...deck, title: "bad\uD800text" },
  ];
  for (const input of invalid) assert.equal(validateDeck(input).success, false, JSON.stringify(input));
});

test("schema enforces each bounded field and accepts exact maximum lengths", () => {
  const deck = createStarterDeck("playful");
  const slide = deck.slides[0];
  const boundary = {
    ...slide, title: "T".repeat(120), eyebrow: "E".repeat(60),
    body: Array.from({ length: 4 }, () => "B".repeat(220)), notes: "N".repeat(2000), source: "S".repeat(350),
  };
  assert.ok(slideSchema.safeParse(boundary).success);
  for (const field of ["title", "eyebrow", "notes", "source"] as const) {
    assert.equal(slideSchema.safeParse({ ...boundary, [field]: boundary[field] + "x" }).success, false, field);
  }
  assert.equal(slideSchema.safeParse({ ...slide, body: ["x".repeat(221)] }).success, false);
  assert.equal(slideSchema.safeParse({ ...slide, body: Array(5).fill("x") }).success, false);
  assert.equal(slideSchema.safeParse({ ...slide, body: [" "] }).success, false);
  assert.ok(slideSchema.safeParse({ ...slide, body: [], eyebrow: "", notes: "", source: "" }).success);
  assert.equal(validateDeck({ ...deck, title: "x".repeat(121) }).success, false);
  assert.equal(validateDeck({ ...deck, slides: [] }).success, false);
  const slides = Array.from({ length: 21 }, () => ({ ...slide, id: crypto.randomUUID() }));
  assert.ok(validateDeck({ ...deck, slides: slides.slice(0, 20) }).success);
  assert.equal(validateDeck({ ...deck, slides }).success, false);
  assert.equal(deckSchema.parse({ ...deck, title: "  Valid title  " }).title, "Valid title");
});

test("shared deterministic layout keeps all native elements and text lines inside the slide", () => {
  for (const theme of THEME_IDS) {
    const deck = createStarterDeck(theme);
    for (const slide of deck.slides) {
      for (const dense of [false, true]) {
        const input = dense ? {
          ...slide, title: "W".repeat(120), eyebrow: "W".repeat(60),
          body: Array(4).fill("W".repeat(220)),
        } : slide;
        const scene = layoutSlide(input, theme, 3, 20);
        assert.deepEqual(scene, layoutSlide(input, theme, 3, 20));
        assert.equal(scene.width, SLIDE_WIDTH);
        assert.equal(scene.height, SLIDE_HEIGHT);
        assert.ok(scene.elements.some((element) => element.type === "shape"));
        assert.ok(scene.elements.some((element) => element.type === "line"));
        for (const element of scene.elements) {
          const label = `${theme}/${slide.layout}/${element.type}/${dense}`;
          assert.ok(element.x >= 0 && element.y >= 0 && element.w >= 0 && element.h >= 0, label);
          assert.ok(element.x + element.w <= SLIDE_WIDTH + 0.001, label);
          assert.ok(element.y + element.h <= SLIDE_HEIGHT + 0.001, label);
          if (element.type === "text") {
            assert.ok(element.fontSize >= 9, label);
            assert.ok(element.lines.length * element.fontSize / 72 * element.lineHeight <= element.h + 0.001, `${label}: ${element.fontSize}pt / ${element.lines.length} lines / ${element.h}in`);
          }
        }
      }
    }
  }
});

test("split heading reserves room for two Georgia lines measured in PowerPoint", () => {
  const deck = createStarterDeck("editorial");
  const scene = layoutSlide(deck.slides[1], deck.theme);
  const heading = scene.elements.find((element) => element.type === "text" && element.text === deck.slides[1].title);
  assert.ok(heading && heading.type === "text");
  assert.ok(heading.h * 72 >= 98.33, "PowerPoint measured 96.33pt; preserve at least 2pt clearance");
  assert.ok(heading.y + heading.h < 2.85, "Heading must not reach body content");
});

test("QA explains density, absent content and missing sources without inventing facts", () => {
  const deck = createStarterDeck("editorial");
  const slide = { ...deck.slides[2], title: "Long title ".repeat(10), body: Array(4).fill("word ".repeat(40)), source: "" };
  const scene = layoutSlide(slide, deck.theme);
  for (const code of ["long-title", "dense-body", "missing-source"]) {
    assert.ok(scene.issues.some((issue) => issue.code === code));
  }
  assert.ok(inspectDeck({ ...deck, slides: [{ ...slide, body: [] }] }).some((issue) => issue.code === "empty-body"));
});

test("pasted line breaks cannot bypass conservative text budgets", () => {
  const slide = createStarterDeck("product").slides[0];
  const scene = layoutSlide({ ...slide, title: "A\n".repeat(60), body: Array(4).fill("B\n".repeat(110)) }, "product");
  for (const element of scene.elements) {
    if (element.type !== "text") continue;
    assert.ok(element.lines.every((line) => !line.includes("\n")));
    assert.ok(element.lines.length * element.fontSize / 72 * element.lineHeight <= element.h);
  }
});

test("short, long-word, multilingual and empty slide bodies retain safe layout budgets", () => {
  for (const theme of THEME_IDS) {
    const base = createStarterDeck(theme).slides[0];
    for (const layout of LAYOUT_IDS) {
      for (const body of [[], ["Satu gagasan."], Array(4).fill("\u4E2D".repeat(220)), Array(4).fill("\uD835\uDC00".repeat(110))]) {
        const scene = layoutSlide({ ...base, layout, title: "\u4E2D".repeat(120), body }, theme);
        for (const element of scene.elements) {
          if (element.type !== "text") continue;
          assert.ok(element.lines.length * element.fontSize / 72 * element.lineHeight <= element.h, `${theme}/${layout}`);
        }
      }
    }
  }
});

test("SVG preview escapes user text and contains neither remote resources nor executable markup", () => {
  const slide = createStarterDeck("playful").slides[0];
  const svg = renderSlideSvg(layoutSlide({ ...slide, title: '<script>alert("x")</script> & test', body: ['<image href="https://example.com/x" />'] }, "playful"));
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("&amp;"));
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|<iframe|onload=/);
});

test("optional palettes and strict finite geometry preserve legacy decks and reject invalid persisted edits", () => {
  const deck = createStarterDeck("editorial");
  assert.ok(!("palette" in deck) && !("adjustments" in deck.slides[0]));
  assert.ok(validateDeck(JSON.parse(JSON.stringify(deck))).success);
  for (const palette of PALETTE_IDS) assert.ok(validateDeck({ ...deck, palette }).success);
  for (const palette of ["remote", "", null, {}, "https://example.com"]) assert.equal(validateDeck({ ...deck, palette }).success, false);
  const slide = deck.slides[0];
  const adjustment = { target: "title", x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT };
  assert.ok(slideSchema.safeParse({ ...slide, adjustments: [adjustment] }).success);
  assert.ok(slideSchema.safeParse({ ...slide, adjustments: EDIT_TARGETS.map((target) => ({ ...adjustment, target, w: 0.5, h: 0.3 })) }).success);
  for (const bad of [
    { ...adjustment, target: "decoration" }, { ...adjustment, url: "https://example.com" },
    { ...adjustment, x: -0.01 }, { ...adjustment, y: -0.01 }, { ...adjustment, w: 0.49 }, { ...adjustment, h: 0.29 },
    { ...adjustment, w: SLIDE_WIDTH + 0.01 }, { ...adjustment, h: SLIDE_HEIGHT + 0.01 },
    { ...adjustment, x: 0.01 }, { ...adjustment, y: 0.01 },
    ...["x", "y", "w", "h"].flatMap((key) => [NaN, Infinity, -Infinity, "1", null].map((value) => ({ ...adjustment, [key]: value }))),
  ]) assert.equal(slideSchema.safeParse({ ...slide, adjustments: [bad] }).success, false, JSON.stringify(bad));
  assert.equal(slideSchema.safeParse({ ...slide, adjustments: [adjustment, adjustment] }).success, false);
  assert.equal(slideSchema.safeParse({ ...slide, adjustments: Array(11).fill(adjustment) }).success, false);
});

test("geometry helpers clamp, replace unique targets, validate and never mutate persisted input", () => {
  const slide = createStarterDeck("playful").slides[0];
  const before = JSON.stringify(slide);
  const moved = adjustSlideElement(slide, "title", { x: 100, y: -5, w: 5, h: 0 });
  assert.equal(JSON.stringify(slide), before);
  assert.deepEqual(moved.adjustments, [{ target: "title", x: SLIDE_WIDTH - 5, y: 0, w: 5, h: 0.3 }]);
  const second = adjustSlideElement(moved, "title", { x: 1, y: 2, w: 6, h: 2 });
  assert.deepEqual(second.adjustments, [{ target: "title", x: 1, y: 2, w: 6, h: 2 }]);
  assert.equal(adjustSlideElement(second, "body-0", { x: 1, y: 4, w: 3, h: 1 }).adjustments?.length, 2);
  assert.deepEqual(constrainBounds({ x: -3, y: 20, w: 20, h: 20 }), { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT });
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => constrainBounds({ x: value, y: 0, w: 1, h: 1 }), RangeError);
  assert.throws(() => adjustSlideElement(slide, 'title" onload="x' as SlideEditTarget, { x: 0, y: 0, w: 1, h: 1 }));
  for (let i = 0; i < 500; i++) {
    const bounds = constrainBounds({ x: i / 7, y: i / 13, w: i / 31, h: i / 43 });
    assert.ok(slideSchema.safeParse({ ...slide, adjustments: [{ target: "title", ...bounds }] }).success);
  }
});

test("every layout assigns body keys by slot even for identical content and dense fallback", () => {
  const base = createStarterDeck("playful").slides[0];
  for (const layout of LAYOUT_IDS) for (const repeated of ["Sama", "W".repeat(220)]) for (const count of [2, 4]) {
    const slide = { ...base, layout, title: repeated.slice(0, 120), eyebrow: repeated.slice(0, 60), body: Array(count).fill(repeated), art: { fileId: "owned", role: "hero" as const, alt: "Art" } };
    const scene = layoutSlide(slide, "playful");
    const editable = scene.elements.filter((element) => element.editKey);
    assert.deepEqual(editable.map((element) => element.editKey).sort(), ["title", "eyebrow", "art", ...Array.from({ length: count }, (_, i) => `body-${i}`)].sort());
    for (let i = 0; i < count; i++) {
      const changed = layoutSlide(adjustSlideElement(slide, `body-${i}` as SlideEditTarget, { x: i + 1, y: 1, w: 1, h: 1 }), "playful");
      changed.elements.forEach((element, index) => {
        if (element.editKey === `body-${i}`) assert.equal(element.x, i + 1);
        else assert.deepEqual(element, scene.elements[index]);
      });
    }
  }
});

test("adjustments refit complete text to authoritative boxes and rerun readability QA", () => {
  const base = createStarterDeck("product").slides[0];
  const slide = { ...base, title: "Judul monumental yang tetap utuh ketika dipindahkan", body: ["Kalimat isi yang tetap dapat diedit dan dibungkus ulang."] };
  let adjusted = adjustSlideElement(slide, "title", { x: 0.5, y: 0.5, w: 0.5, h: 0.3 });
  adjusted = adjustSlideElement(adjusted, "body-0", { x: 2, y: 2, w: 2, h: 0.3 });
  const scene = layoutSlide(adjusted, "product");
  assert.deepEqual(scene, layoutSlide(adjusted, "product"));
  assert.ok(scene.issues.some((issue) => issue.code === "small-text"));
  for (const element of scene.elements) {
    if (element.type !== "text" || !["title", "body-0"].includes(element.editKey ?? "")) continue;
    assert.equal(element.lines.join("").replace(/\s/g, ""), element.text.replace(/\s/g, ""));
    const leading = element.fontFace === "Impact" ? 1.35 : 1.17;
    assert.ok(element.lines.length * element.fontSize / 72 * element.lineHeight * leading <= element.h - 0.04 + 0.001);
  }
  const title = scene.elements.find((element) => element.editKey === "title")!;
  assert.equal(title.h, 0.3);
  const larger = layoutSlide(adjustSlideElement(adjusted, "title", { x: 0.5, y: 0.5, w: 12, h: 3 }), "product").elements.find((element) => element.editKey === "title")!;
  assert.ok(larger.type === "text" && title.type === "text" && larger.fontSize > title.fontSize);
});

test("art adjustments move the image alone while generated mats and decorations stay fixed", () => {
  const base = createStarterDeck("editorial").slides[0];
  for (const role of ["hero", "background", "cutout"] as const) {
    const slide = { ...base, art: { fileId: "owned", role, alt: "Art" } };
    const original = layoutSlide(slide, "editorial");
    const adjusted = layoutSlide(adjustSlideElement(slide, "art", { x: 1, y: 2, w: 3, h: 4 }), "editorial");
    original.elements.forEach((element, index) => {
      if (element.type === "image") assert.deepEqual(adjusted.elements[index], { ...element, x: 1, y: 2, w: 3, h: 4 });
      else assert.deepEqual(adjusted.elements[index], element);
    });
    const svg = renderSlideSvg(adjusted);
    assert.match(svg, /<svg data-edit-key="art" x="96" y="192" width="288" height="384"/);
    assert.match(svg, /<text data-edit-key="title"/);
    assert.doesNotMatch(svg, /<(?:rect|line|polygon|ellipse)[^>]*data-edit-key=/);
    const malicious = { ...adjusted, elements: adjusted.elements.map((element) => ({ ...element, editKey: 'title" onload="x' as SlideEditTarget })) };
    assert.doesNotMatch(renderSlideSvg(malicious), /data-edit-key|onload=/);
  }
});

test("ten client-safe design presets render distinct native scenes and all palettes change core tokens", () => {
  assert.equal(DESIGN_PRESETS.length, 10);
  assert.equal(new Set(DESIGN_PRESETS.map((preset) => preset.id)).size, 10);
  const signatures = new Set<string>();
  for (const preset of DESIGN_PRESETS) {
    assert.ok(preset.label && preset.description && preset.artDirection.concept);
    const deck = createStarterDeck(preset.theme);
    assert.ok(validateDeck({ ...deck, palette: preset.palette, artDirection: preset.artDirection }).success);
    const slide = { ...deck.slides[0], title: "Gagasan yang sama", eyebrow: "PRATINJAU", body: ["Isi yang sama"], visual: undefined };
    const scene = layoutSlide(slide, preset.theme, 0, 1, preset.artDirection, preset.palette);
    signatures.add(renderSlideSvg(scene));
    assert.ok(scene.elements.every((element) => element.type !== "image"));
    for (const element of scene.elements) if (element.type === "text") assert.ok(["Arial", "Arial Black", "Impact", "Georgia"].includes(element.fontFace));
  }
  assert.equal(signatures.size, 10);
  const deck = createStarterDeck("editorial");
  const original = layoutSlide(deck.slides[0], deck.theme, 0, 1, deck.artDirection);
  assert.deepEqual(original, layoutSlide(deck.slides[0], deck.theme, 0, 1, deck.artDirection, "original"));
  for (const palette of PALETTE_IDS.filter((id) => id !== "original")) {
    const scene = layoutSlide(deck.slides[0], deck.theme, 0, 1, deck.artDirection, palette);
    assert.equal(scene.background, PALETTES[palette].background);
    const heading = scene.elements.find((element) => element.editKey === "title");
    assert.ok(heading?.type === "text" && heading.color === PALETTES[palette].foreground);
    scene.elements.forEach((element, i) => assert.deepEqual({ x: element.x, y: element.y, w: element.w, h: element.h }, { x: original.elements[i].x, y: original.elements[i].y, w: original.elements[i].w, h: original.elements[i].h }));
  }
});

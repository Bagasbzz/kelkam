import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as layout from "../src/lib/presentation/layout";
import * as model from "../src/lib/presentation/model";
import * as presets from "../src/lib/presentation/presets";
import * as design from "../src/lib/presentation/design";

type Props = Record<string, unknown>;
type Element = { type: unknown; props: Props; key?: unknown };
type Component = (props: Props) => Element;
type Effect = { dependencies?: readonly unknown[]; cleanup?: () => void };
type Frame = { slots: unknown[]; effects: Map<number, Effect> };
type Bounds = layout.Bounds;
type EditTarget = model.SlideEditTarget;
const directory = new URL("../src/components/presentation/", import.meta.url);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function content(node: unknown): string {
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (node && typeof node === "object" && "props" in node) return content((node as Element).props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function find(tree: Element, predicate: (element: Element) => boolean, description: string): Element {
  const result = elements(tree).find(predicate);
  assert.ok(result, `Missing ${description}`);
  return result;
}

const button = (tree: Element, label: string) => find(tree, (element) => element.type === "button" && (element.props["aria-label"] === label || content(element).includes(label)), `button ${label}`);
const invoke = (element: Element, handler: string, event?: unknown) => {
  assert.equal(typeof element.props[handler], "function", `Missing ${handler}`);
  return (element.props[handler] as (event?: unknown) => unknown)(event);
};

// Like presentation-ui.test.ts, run actual TSX but deny every unlisted import.
// Host refs are attached before effects; state is retained by component and hook
// position, and each explicit render observes the preceding event's updates.
function hooksFixture(host: object = {}) {
  const frames = new Map<Component, Frame>();
  let frame: Frame;
  let cursor = 0;
  let pending: (() => void)[] = [];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      const current = frame;
      if (!(index in current.slots)) current.slots[index] = typeof initial === "function" ? initial() : initial;
      return [current.slots[index], (value: unknown) => { current.slots[index] = typeof value === "function" ? value(current.slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in frame.slots)) frame.slots[index] = { current: initial };
      return frame.slots[index];
    },
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = cursor++;
      const current = frame;
      const previous = current.effects.get(index);
      if (previous && dependencies && previous.dependencies?.length === dependencies.length && dependencies.every((value, i) => Object.is(value, previous.dependencies![i]))) return;
      pending.push(() => {
        previous?.cleanup?.();
        current.effects.set(index, { dependencies, cleanup: effect() || undefined });
      });
    },
  };
  return {
    react,
    render(component: Component, props: Props = {}) {
      if (!frames.has(component)) frames.set(component, { slots: [], effects: new Map() });
      frame = frames.get(component)!; cursor = 0; pending = [];
      const tree = component(props);
      for (const element of elements(tree)) {
        const ref = element.props.ref;
        if (ref && typeof ref === "object" && "current" in ref) ref.current = host;
      }
      for (const effect of pending) effect();
      return tree;
    },
    cleanup() {
      for (const current of frames.values()) {
        for (const effect of current.effects.values()) effect.cleanup?.();
        current.effects.clear();
      }
    },
  };
}

async function loadComponent(file: string, react: unknown, overrides: Props = {}, globals: Props = {}, realJsx = false) {
  const source = await readFile(new URL(file, directory), "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0, (compiled.diagnostics || []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
  const jsx = (type: unknown, props: Props, key?: unknown) => ({ type, props, key });
  const icons = Object.fromEntries(["ArrowLeft", "ArrowRight", "Maximize2", "X", "ArrowDown", "ArrowUp", "Check", "Copy", "Download", "ImagePlus", "Loader2", "Play", "Plus", "Save", "Sparkles", "Trash2"].map((name) => [name, `${name.toLowerCase()}-icon`]));
  const mocks: Props = {
    react,
    "react/jsx-runtime": realJsx ? jsxRuntime : { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": icons,
    "@/lib/presentation/layout": layout,
    "@/lib/presentation/model": model,
    "@/lib/presentation/presets": presets,
    "@/lib/presentation/design": design,
    "./presentation.module.css": { default: new Proxy({}, { get: (_, name) => String(name) }) },
    ...overrides,
  };
  const exports: Props = {};
  runInNewContext(compiled.outputText, {
    exports, AbortController, ...globals,
    require(name: string) { assert.ok(Object.hasOwn(mocks, name), `Unexpected offline UI dependency: ${name}`); return mocks[name]; },
  }, { filename: file });
  assert.equal(typeof exports.default, "function");
  return exports as { default: Component; setObjectBounds?: (slide: model.PresentationSlide, target: EditTarget, bounds: Bounds) => model.PresentationSlide; TARGET_LABELS?: Record<EditTarget, string> };
}

function deckFixture(): model.PresentationDeck {
  const deck = model.createStarterDeck("editorial");
  deck.slides = deck.slides.slice(0, 4).map((slide, index) => ({ ...slide, visual: { motif: "none", background: "solid", motion: (["none", "fade", "push", "reveal"] as const)[index] } }));
  deck.slides[0].art = { fileId: "offline-image", role: "hero", alt: "Offline test image" };
  return deck;
}

async function canvasFixture() {
  const hooks = hooksFixture({ getBoundingClientRect: () => ({ left: 20, top: 40, width: 1000, height: 562.5 }) });
  const canvasModule = await loadComponent("SlideCanvas.tsx", hooks.react);
  const deck = deckFixture();
  const changes: model.PresentationSlide[] = [];
  const selected: EditTarget[] = [];
  const props = { deck, index: 0, disabled: false, selected: "title" as EditTarget, onSelect: (target: EditTarget) => { selected.push(target); props.selected = target; }, onChange: (slide: model.PresentationSlide) => { changes.push(slide); deck.slides[0] = slide; } };
  const render = () => hooks.render(canvasModule.default, props);
  const captured: number[] = [];
  function pointer(x = 100, y = 100, pointerId = 7) {
    return { clientX: x, clientY: y, pointerId, button: 0, isPrimary: true, preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture: (id: number) => captured.push(id), releasePointerCapture() {}, hasPointerCapture: () => true } };
  }
  const bounds = (target: EditTarget) => {
    const scene = layout.layoutSlide(deck.slides[0], deck.theme, 0, deck.slides.length, deck.artDirection, deck.palette);
    const element = scene.elements.find((item) => item.editKey === target);
    assert.ok(element);
    return { x: element.x, y: element.y, w: element.w, h: element.h };
  };
  return { ...hooks, module: canvasModule, deck, props, changes, selected, captured, pointer, bounds, render };
}

test("setObjectBounds clamps real slides, preserves content and unrelated adjustments, and replaces duplicate targets", async () => {
  const fixture = await canvasFixture();
  const setBounds = fixture.module.setObjectBounds;
  assert.ok(setBounds);
  const slide = fixture.deck.slides[0];
  slide.adjustments = [
    { target: "body-0", x: 1, y: 3, w: 4, h: 1 },
    { target: "title", x: 1, y: 1, w: 4, h: 1 },
    { target: "title", x: 2, y: 2, w: 4, h: 1 },
  ];
  const before = plain(slide);
  const next = setBounds(slide, "title", { x: -100, y: 100, w: 100, h: -10 });
  assert.deepEqual(plain(slide), before, "The input slide must not be mutated");
  assert.notEqual(next, slide);
  assert.deepEqual(plain(next.adjustments), [before.adjustments![0], { target: "title", x: 0, y: 7.2, w: 13.333, h: 0.3 }]);
  assert.deepEqual(plain({ ...next, adjustments: undefined }), plain({ ...before, adjustments: undefined }));
  assert.equal(model.slideSchema.safeParse(next).success, true);
  const right = setBounds(next, "art", { x: 100, y: -100, w: -1, h: 100 });
  assert.deepEqual(plain(right.adjustments!.find((item) => item.target === "art")), { target: "art", x: 12.833, y: 0, w: 0.5, h: 7.5 });
  assert.equal(model.slideSchema.safeParse(right).success, true);
  assert.equal(right.adjustments!.filter((item) => item.target === "title").length, 1);
});

test("canvas text and image moves preview without persistence and commit scaled inch bounds only on pointer up", async (t) => {
  for (const [target, label] of [["title", "Judul"], ["art", "Gambar"]] as const) {
    await t.test(target, async () => {
      const fixture = await canvasFixture();
      const original = fixture.bounds(target);
      const originalSlide = plain(fixture.deck.slides[0]);
      let hit = button(fixture.render(), `Pilih dan geser ${label}`);
      invoke(hit, "onPointerDown", fixture.pointer());
      assert.deepEqual(fixture.captured, [7]);
      assert.equal(fixture.selected.at(-1), target);
      hit = button(fixture.render(), `Pilih dan geser ${label}`);
      invoke(hit, "onPointerMove", fixture.pointer(200, 137.5));
      const preview = fixture.render();
      assert.equal(fixture.changes.length, 0);
      assert.deepEqual(plain(fixture.deck.slides[0]), originalSlide);
      const image = find(preview, (element) => element.props.role === "img", "SVG preview");
      const previewSlide = layout.adjustSlideElement(fixture.deck.slides[0], target, { ...original, x: original.x + (200 - 100) / 1000 * layout.SLIDE_WIDTH, y: original.y + (137.5 - 100) / 562.5 * layout.SLIDE_HEIGHT });
      const expectedSvg = layout.renderSlideSvg(layout.layoutSlide(previewSlide, fixture.deck.theme, 0, fixture.deck.slides.length, fixture.deck.artDirection, fixture.deck.palette));
      assert.equal((image.props.dangerouslySetInnerHTML as { __html: string }).__html, expectedSvg, "The uncommitted draft must actually be rendered");
      const otherPointer = button(preview, `Pilih dan geser ${label}`);
      invoke(otherPointer, "onPointerUp", fixture.pointer(200, 137.5, 99));
      assert.equal(fixture.changes.length, 0, "An unrelated pointer cannot finish this gesture");
      invoke(otherPointer, "onPointerUp", fixture.pointer(200, 137.5));
      assert.equal(fixture.changes.length, 1);
      const changed = fixture.changes[0].adjustments!.find((item) => item.target === target)!;
      closeTo(changed.x, Math.min(layout.SLIDE_WIDTH - original.w, original.x + 1.3333));
      closeTo(changed.y, Math.min(layout.SLIDE_HEIGHT - original.h, original.y + 0.5));
      closeTo(changed.w, original.w); closeTo(changed.h, original.h);
      assert.equal(model.slideSchema.safeParse(fixture.changes[0]).success, true);
      invoke(button(fixture.render(), `Pilih dan geser ${label}`), "onPointerUp", fixture.pointer(200, 137.5));
      assert.equal(fixture.changes.length, 1, "Capture loss/up after completion must not double commit");
    });
  }
});

test("canvas resize changes text and image dimensions, clamps edges, and keeps the anchor", async (t) => {
  for (const [target, label] of [["title", "Judul"], ["art", "Gambar"]] as const) {
    await t.test(target, async () => {
      const fixture = await canvasFixture();
      fixture.props.selected = target;
      const original = fixture.bounds(target);
      invoke(button(fixture.render(), `Ubah ukuran ${label}`), "onPointerDown", fixture.pointer());
      invoke(button(fixture.render(), `Ubah ukuran ${label}`), "onPointerMove", fixture.pointer(10000, 10000));
      assert.equal(fixture.changes.length, 0);
      invoke(button(fixture.render(), `Ubah ukuran ${label}`), "onPointerUp", fixture.pointer(10000, 10000));
      const changed = fixture.changes[0].adjustments!.find((item) => item.target === target)!;
      closeTo(changed.x, original.x); closeTo(changed.y, original.y);
      closeTo(changed.w, layout.SLIDE_WIDTH - original.x); closeTo(changed.h, layout.SLIDE_HEIGHT - original.y);
      assert.equal(model.slideSchema.safeParse(fixture.changes[0]).success, true);
      invoke(button(fixture.render(), `Ubah ukuran ${label}`), "onPointerDown", fixture.pointer());
      invoke(button(fixture.render(), `Ubah ukuran ${label}`), "onPointerMove", fixture.pointer(-10000, -10000));
      invoke(button(fixture.render(), `Ubah ukuran ${label}`), "onPointerUp", fixture.pointer(-10000, -10000));
      const minimum = fixture.changes[1].adjustments!.find((item) => item.target === target)!;
      closeTo(minimum.x, original.x); closeTo(minimum.y, original.y);
      closeTo(minimum.w, 0.5); closeTo(minimum.h, 0.3);
    });
  }
});

test("canvas commits the latest pointer position even when move and up arrive before another render", async () => {
  const fixture = await canvasFixture();
  const original = fixture.bounds("title");
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerDown", fixture.pointer());
  const hit = button(fixture.render(), "Pilih dan geser Judul");
  invoke(hit, "onPointerMove", fixture.pointer(125, 137.5));
  assert.equal(fixture.changes.length, 0);
  invoke(hit, "onPointerUp", fixture.pointer(125, 137.5));
  assert.equal(fixture.changes.length, 1);
  const bounds = fixture.changes[0].adjustments!.find((item) => item.target === "title")!;
  closeTo(bounds.x, original.x + 0.333325);
  closeTo(bounds.y, original.y + 0.5);
});

test("selecting an object without moving never commits a dirty geometry edit", async () => {
  const fixture = await canvasFixture();
  const before = plain(fixture.deck);
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerDown", fixture.pointer());
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerUp", fixture.pointer());
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onClick");
  assert.equal(fixture.selected.at(-1), "title");
  assert.equal(fixture.changes.length, 0);
  assert.deepEqual(plain(fixture.deck), before);
});

test("canvas preview uses the selected deck palette and actual adjusted layout", async () => {
  const fixture = await canvasFixture();
  fixture.deck.palette = "forest";
  fixture.deck.slides[0] = layout.adjustSlideElement(fixture.deck.slides[0], "title", { x: 1.4, y: 1.5, w: 5, h: 2 });
  const preview = find(fixture.render(), (element) => element.props.role === "img", "palette preview");
  const expected = layout.renderSlideSvg(layout.layoutSlide(fixture.deck.slides[0], fixture.deck.theme, 0, fixture.deck.slides.length, fixture.deck.artDirection, "forest"));
  assert.equal((preview.props.dangerouslySetInnerHTML as { __html: string }).__html, expected);
});

test("canvas pointer cancel and lost capture discard drafts; disabled state blocks pointer and keyboard mutations", async (t) => {
  for (const handler of ["onPointerCancel", "onLostPointerCapture"]) {
    await t.test(handler, async () => {
      const fixture = await canvasFixture();
      const before = plain(fixture.deck);
      invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerDown", fixture.pointer());
      invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerMove", fixture.pointer(200, 200));
      invoke(button(fixture.render(), "Pilih dan geser Judul"), handler, fixture.pointer(200, 200));
      invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerUp", fixture.pointer(200, 200));
      assert.deepEqual(plain(fixture.deck), before);
      assert.equal(fixture.changes.length, 0);
    });
  }
  const fixture = await canvasFixture();
  fixture.props.disabled = true;
  let tree = fixture.render();
  assert.equal(elements(tree).some((element) => element.props["aria-label"] === "Ubah ukuran Judul"), false);
  invoke(button(tree, "Pilih dan geser Judul"), "onPointerDown", fixture.pointer());
  tree = fixture.render();
  invoke(button(tree, "Pilih dan geser Judul"), "onPointerMove", fixture.pointer(300, 300));
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerUp", fixture.pointer(300, 300));
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onKeyDown", { key: "ArrowRight", shiftKey: true, preventDefault() {} });
  assert.equal(fixture.captured.length, 0);
  assert.equal(fixture.changes.length, 0);
  fixture.props.disabled = false;
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerDown", fixture.pointer());
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerMove", fixture.pointer(200, 200));
  fixture.props.disabled = true;
  invoke(button(fixture.render(), "Pilih dan geser Judul"), "onPointerUp", fixture.pointer(200, 200));
  assert.equal(fixture.changes.length, 0, "Disabling an in-flight drag must also block its commit");
});

test("canvas arrow keys move by small steps, Shift increases the step, and unrelated keys do nothing", async () => {
  const fixture = await canvasFixture();
  const original = fixture.bounds("title");
  let prevented = 0;
  const press = (key: string, shiftKey = false) => invoke(button(fixture.render(), "Pilih dan geser Judul"), "onKeyDown", { key, shiftKey, preventDefault: () => prevented++ });
  press("ArrowRight"); press("ArrowDown", true); press("ArrowLeft"); press("ArrowUp", true); press("Enter");
  assert.equal(fixture.changes.length, 4);
  assert.equal(prevented, 4);
  const first = fixture.changes[0].adjustments!.find((item) => item.target === "title")!;
  const second = fixture.changes[1].adjustments!.find((item) => item.target === "title")!;
  closeTo(first.x, original.x + 0.05); closeTo(second.y, original.y + 0.2);
  closeTo(fixture.bounds("title").x, original.x); closeTo(fixture.bounds("title").y, original.y);
  assert.equal(fixture.changes.at(-1)!.adjustments!.filter((item) => item.target === "title").length, 1);
});

async function playerFixture(initialIndex = 0) {
  const document = { activeElement: null as object | null, body: { style: { overflow: "scroll" } } };
  let restored = 0;
  const origin = { focus() { restored++; document.activeElement = origin; } };
  document.activeElement = origin;
  let focusable: { focus: () => void; element: Element }[] = [];
  const container = { focus() { document.activeElement = container; }, querySelectorAll: () => focusable, requestFullscreen: () => Promise.resolve() };
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const window = {
    addEventListener(name: string, callback: (event: unknown) => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
    removeEventListener(name: string, callback: (event: unknown) => void) { listeners.get(name)?.delete(callback); },
  };
  const hooks = hooksFixture(container);
  const playerModule = await loadComponent("SlidePlayer.tsx", hooks.react, {}, { document, window });
  const deck = deckFixture();
  let closed = 0;
  const props = { deck, initialIndex, onClose: () => { closed++; hooks.cleanup(); } };
  function render() {
    const tree = hooks.render(playerModule.default, props);
    const previous = focusable;
    focusable = elements(tree).filter((element) => element.type === "button" && !element.props.disabled).map((element) => {
      const match = previous.find((item) => content(item.element) === content(element) && item.element.props["aria-label"] === element.props["aria-label"]);
      if (match) { match.element = element; return match; }
      const node = { element, focus() { document.activeElement = node; } };
      return node;
    });
    return tree;
  }
  const key = (value: string, shiftKey = false) => {
    let prevented = false;
    for (const listener of [...listeners.get("keydown") || []]) listener({ key: value, shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { render, key, deck, props, document, listeners, container, cleanup: hooks.cleanup, closed: () => closed, restored: () => restored, focusable: () => focusable };
}

test("player renders actual React SSR with slide-specific motion and accessible dialog semantics", async () => {
  const playerModule = await loadComponent("SlidePlayer.tsx", React, {}, {}, true);
  const deck = deckFixture();
  deck.palette = "rose";
  for (let index = 0; index < deck.slides.length; index++) {
    const html = renderToStaticMarkup(React.createElement(playerModule.default as unknown as React.ComponentType<{ deck: model.PresentationDeck; initialIndex: number; onClose: () => void }>, { deck, initialIndex: index, onClose() {} }));
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.ok(html.includes(`data-motion="${deck.slides[index].visual!.motion}"`));
    assert.ok(html.includes(`Slide ${index + 1}:`));
    assert.match(html, /<svg/);
    assert.ok(html.includes(layout.renderSlideSvg(layout.layoutSlide(deck.slides[index], deck.theme, index, deck.slides.length, deck.artDirection, deck.palette))), "Player must use the shared palette-aware layout");
    assert.match(html, /Tutup tayangan/);
  }
});

test("player next/previous and keyboard navigation stay within the deck and update actual slide motion", async (t) => {
  const fixture = await playerFixture();
  t.after(fixture.cleanup);
  const verify = (index: number) => {
    const tree = fixture.render();
    const stage = find(tree, (element) => element.props.role === "img", "player stage");
    assert.equal(stage.props["data-motion"], fixture.deck.slides[index].visual!.motion);
    assert.equal(stage.props["aria-label"], `Slide ${index + 1}: ${fixture.deck.slides[index].title}`);
    assert.equal(button(tree, "Sebelumnya").props.disabled, index === 0);
    assert.equal(button(tree, "Berikutnya").props.disabled, index === fixture.deck.slides.length - 1);
    return tree;
  };
  let tree = verify(0);
  invoke(button(tree, "Sebelumnya"), "onClick"); tree = verify(0);
  for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) { assert.equal(fixture.key(key), true); verify(0); }
  invoke(button(tree, "Berikutnya"), "onClick"); tree = verify(1);
  invoke(button(tree, "Sebelumnya"), "onClick"); verify(0);
  for (const [key, index] of [["ArrowRight", 1], ["ArrowDown", 2], [" ", 3], ["PageDown", 3]] as const) { assert.equal(fixture.key(key), true); verify(index); }
  for (const key of ["ArrowRight", "ArrowDown", " ", "PageDown"]) { fixture.key(key); verify(3); }
  invoke(button(fixture.render(), "Berikutnya"), "onClick"); verify(3);
  for (const [key, index] of [["PageUp", 2], ["ArrowLeft", 1], ["ArrowUp", 0]] as const) { fixture.key(key); verify(index); }
  assert.equal(fixture.key("a"), false); verify(0);
  assert.equal(fixture.listeners.get("keydown")?.size, 1, "Re-rendering must not accumulate keyboard listeners");
});

test("player traps forward and reverse focus, and Escape cleans up listener, overflow, and prior focus", async (t) => {
  const fixture = await playerFixture();
  t.after(fixture.cleanup);
  fixture.render();
  assert.equal(fixture.document.body.style.overflow, "hidden");
  assert.equal(fixture.document.activeElement, fixture.container);
  const items = fixture.focusable();
  assert.ok(items.length >= 3);
  assert.equal(fixture.key("Tab", true), true);
  assert.equal(fixture.document.activeElement, items.at(-1), "Shift+Tab from initial dialog focus must reach the last enabled control");
  assert.equal(fixture.key("Tab"), true);
  assert.equal(fixture.document.activeElement, items[0], "Tab wraps from last to first");
  fixture.key("Tab", true);
  assert.equal(fixture.document.activeElement, items.at(-1));
  assert.equal(fixture.key("Escape"), true);
  assert.equal(fixture.closed(), 1);
  assert.equal(fixture.document.body.style.overflow, "scroll");
  assert.equal(fixture.restored(), 1);
  assert.equal(fixture.listeners.get("keydown")?.size, 0);
  assert.equal(fixture.key("Escape"), false);
});

test("player remains safe when a concurrent reload replaces the deck with fewer slides", async (t) => {
  const fixture = await playerFixture(3);
  t.after(fixture.cleanup);
  fixture.render();
  fixture.props.deck = { ...fixture.deck, slides: fixture.deck.slides.slice(0, 1) };
  const tree = fixture.render();
  const stage = find(tree, (element) => element.props.role === "img", "player stage");
  assert.equal(stage.props["aria-label"], `Slide 1: ${fixture.deck.slides[0].title}`);
  assert.equal(button(tree, "Sebelumnya").props.disabled, true);
  assert.equal(button(tree, "Berikutnya").props.disabled, true);
  fixture.key("ArrowRight");
  assert.doesNotThrow(() => fixture.render());
});

test("player parent re-renders do not steal focus or restore scrolling and Escape uses the latest close callback", async (t) => {
  const fixture = await playerFixture();
  t.after(fixture.cleanup);
  fixture.render();
  fixture.focusable()[0].focus();
  const focused = fixture.document.activeElement;
  let latestClosed = 0;
  fixture.props.onClose = () => { latestClosed++; fixture.cleanup(); };
  fixture.render();
  assert.equal(fixture.document.activeElement, focused);
  assert.equal(fixture.document.body.style.overflow, "hidden");
  assert.equal(fixture.restored(), 0);
  assert.equal(fixture.listeners.get("keydown")?.size, 1);
  fixture.key("Escape");
  assert.equal(latestClosed, 1);
  assert.equal(fixture.closed(), 0, "An old onClose closure must not be called");
  assert.equal(fixture.restored(), 1);
});

test("motion CSS leaves none unanimated and scopes reveal to the editable heading", async () => {
  const css = await readFile(new URL("presentation.module.css", directory), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({ selector: match[1].trim(), declarations: match[2] }));
  const animated = rules.filter((rule) => /(?:^|;)\s*animation\s*:/u.test(rule.declarations) && !/animation\s*:\s*none/u.test(rule.declarations));
  const motionRules = animated.filter((rule) => rule.selector.includes(".motionPreview"));
  assert.ok(motionRules.length, "Presentation playback must have actual motion CSS");
  for (const rule of motionRules) {
    for (const selector of rule.selector.split(",")) {
      assert.match(selector, /\[data-motion=(?:["']?)(?:fade|push|reveal)/u, "Unqualified motion animation would animate none");
      if (selector.includes("data-motion=reveal") || selector.includes('data-motion="reveal"')) assert.match(selector, /data-edit-key\s*=\s*["']?title/u, "Reveal must not animate every text object");
    }
  }
  assert.ok(motionRules.some((rule) => rule.selector.includes("data-edit-key") && /(?:0?\.55)s/u.test(rule.declarations)), "Heading reveal uses the short .55s motion");
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/u);
  assert.ok(rules.some((rule) => rule.selector.includes(".motionPreview") && /animation\s*:\s*none\s*!important/u.test(rule.declarations)));
});

test("workspace defaults to simple text editing, wires canvas/player, and keeps VisualControls in closed details", async (t) => {
  const hooks = hooksFixture({ click() {} });
  t.after(hooks.cleanup);
  const Canvas = () => null;
  const Player = () => null;
  const VisualControls = () => null;
  const Chat = () => null;
  const PlanPanel = () => null;
  const deck = deckFixture();
  const project = { id: "offline-project", revision: 1, deck, history: [] };
  const requests: string[] = [];
  const workspaceModule = await loadComponent("PresentationWorkspace.tsx", hooks.react, {
    "@/components/AuthProvider": { useAuth: () => ({ user: { id: "offline-owner" }, loading: false }), authenticatedFetch: async (url: string) => {
      requests.push(url);
      assert.ok(["/api/presentasi", "/api/presentasi/offline-project"].includes(url), `Unexpected workspace request ${url}`);
      return Response.json(url === "/api/presentasi" ? { success: true, projects: [{ id: project.id, title: deck.title, revision: 1, updatedAt: "2026-11-06T00:00:00Z" }] } : { success: true, project });
    } },
    "@/lib/client/agent-run": { fetchActiveRun: async () => null, isRunLive: () => false },
    "@/lib/errors": { getErrorMessage: (error: Error) => error.message },
    "./PresentationChat": { default: Chat },
    "./PresentationPlanPanel": { default: PlanPanel },
    "./SlideCanvas": { default: Canvas, TARGET_LABELS: { title: "Judul", eyebrow: "Label", "body-0": "Teks 1", art: "Gambar" } },
    "./SlidePlayer": { default: Player },
    "./VisualControls": { default: VisualControls },
  }, { URLSearchParams, window: { addEventListener() {}, removeEventListener() {}, confirm: () => true, location: { search: "", pathname: "/presentasi" }, history: { replaceState() {} } } });
  const library = hooks.render(workspaceModule.default);
  assert.equal(typeof library.type, "function");
  hooks.render(library.type as Component, library.props);
  await flush();
  let tree = hooks.render(library.type as Component, library.props);
  assert.equal(content(find(tree, (element) => element.type === "h1", "library heading")), "Buat presentasi dengan AI");
  assert.ok(button(tree, "Buat presentasi"));
  assert.doesNotMatch(content(tree), /Bawa bahannya|Kita susun ceritanya|Bukan sekadar poin/);
  await invoke(button(tree, deck.title), "onClick");
  const editor = hooks.render(library.type as Component, library.props);
  assert.equal(typeof editor.type, "function");
  const render = () => hooks.render(editor.type as Component, editor.props);
  tree = render(); await flush(); tree = render();
  // Chat AI is the default view, as in Laporan: conversation plus slide preview, no manual text editor.
  assert.ok(elements(tree).some((element) => element.type === Chat), "chat is the first view");
  assert.ok(elements(tree).some((element) => element.type === PlanPanel), "preview and plan panel sit beside the chat");
  assert.equal(elements(tree).some((element) => element.type === Canvas), false);
  assert.equal(elements(tree).some((element) => element.type === "textarea" && element.props.value === deck.slides[0].body[0]), false);
  invoke(button(tree, "Edit slide"), "onClick");
  tree = render();
  assert.equal(elements(tree).some((element) => element.type === VisualControls), false);
  const canvas = find(tree, (element) => element.type === Canvas, "editable canvas");
  assert.equal(canvas.props.disabled, false);
  assert.equal(canvas.props.selected, "title");
  invoke(canvas, "onSelect", "body-0");
  tree = render();
  const text = find(tree, (element) => element.type === "textarea" && element.props.value === deck.slides[0].body[0], "selected body editor");
  invoke(text, "onChange", { target: { value: "Body edited offline" } });
  tree = render();
  assert.equal((find(tree, (element) => element.type === Canvas, "updated canvas").props.deck as model.PresentationDeck).slides[0].body[0], "Body edited offline");
  const changed = layout.adjustSlideElement(deck.slides[0], "art", { x: 7, y: 2, w: 3, h: 3 });
  invoke(find(tree, (element) => element.type === Canvas, "canvas geometry callback"), "onChange", { ...changed, body: ["Body edited offline", ...changed.body.slice(1)] });
  tree = render();
  const editedDeck = find(tree, (element) => element.type === Canvas, "persisted canvas geometry").props.deck as model.PresentationDeck;
  assert.deepEqual(plain(editedDeck.slides[0].adjustments), plain(changed.adjustments));
  invoke(button(tree, deck.slides[1].title), "onClick");
  tree = render();
  invoke(button(tree, "Tayangkan"), "onClick");
  tree = render();
  const player = find(tree, (element) => element.type === Player, "slide player");
  assert.equal(player.props.initialIndex, 1);
  invoke(player, "onClose");
  assert.equal(elements(render()).some((element) => element.type === Player), false);
  invoke(button(render(), "Tampilan"), "onClick");
  tree = render();
  const details = find(tree, (element) => element.type === "details" && elements(element).some((child) => child.type === VisualControls), "advanced visual details");
  assert.ok(!details.props.open, "Advanced controls are collapsed by default");
  assert.equal(elements(details).filter((element) => element.type === "summary").length, 1);
  assert.ok(elements(tree).some((element) => element.type === "option" && element.props.value === "none"));
  const motion = find(tree, (element) => element.type === "select" && elements(element).some((child) => child.type === "option" && child.props.value === "none"), "optional motion selection");
  invoke(motion, "onChange", { target: { value: "none" } });
  const noMotionDeck = find(render(), (element) => element.type === Canvas, "no-motion deck").props.deck as model.PresentationDeck;
  assert.ok(noMotionDeck.slides.every((slide) => slide.visual?.motion === "none"));
  assert.deepEqual(noMotionDeck.slides.map((slide) => slide.visual?.background), editedDeck.slides.map((slide) => slide.visual?.background));
  assert.deepEqual(requests, ["/api/presentasi", "/api/presentasi/offline-project"], "Editing and presentation are local, with no generation requests");
});

test("signed-out presentation uses the same plain heading and requires login without AI calls", async (t) => {
  const hooks = hooksFixture({ click() {} });
  t.after(hooks.cleanup);
  let opened = 0;
  const workspaceModule = await loadComponent("PresentationWorkspace.tsx", hooks.react, {
    "@/components/AuthProvider": { useAuth: () => ({ user: null, loading: false, openLoginModal: () => { opened++; } }), authenticatedFetch: () => assert.fail("Signed-out landing must not make requests") },
    "@/lib/client/agent-run": {},
    "@/lib/errors": {},
    "./PresentationChat": { default: () => null },
    "./PresentationPlanPanel": { default: () => null },
    "./SlideCanvas": { default: () => null, TARGET_LABELS: {} },
    "./SlidePlayer": { default: () => null },
    "./VisualControls": { default: () => null },
  });
  const tree = hooks.render(workspaceModule.default);
  assert.equal(content(find(tree, (element) => element.type === "h1", "signed-out heading")), "Buat presentasi dengan AI");
  invoke(button(tree, "Masuk untuk membuat presentasi"), "onClick");
  assert.equal(opened, 1);
});

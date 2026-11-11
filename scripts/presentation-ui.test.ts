import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createStarterDeck } from "../src/lib/presentation/model";

type Element = { type: unknown; props: Record<string, unknown> };
type Effect = { dependencies?: readonly unknown[]; cleanup?: () => void };
type PendingRequest = { url: string; init: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void };

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

function button(tree: Element, label: string): Element {
  const found = elements(tree).find((element) => element.type === "button" && content(element).includes(label));
  assert.ok(found, `Missing button: ${label}`);
  return found;
}

const click = (element: Element) => (element.props.onClick as () => void | Promise<void>)();
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const json = (value: unknown, status = 200) => Response.json(value, { status });

test("home features Presentasi first with an editable PowerPoint description", async () => {
  const source = await readFile(new URL("../src/components/home/HomeClient.tsx", import.meta.url), "utf8");
  const featured = source.slice(source.indexOf("const FEATURED"), source.indexOf("const PRIMARY_FEATURES"));
  assert.match(featured, /href: "\/presentasi"/, "Presentasi must be a featured card");
  assert.match(featured, /PowerPoint/);
  assert.ok(featured.indexOf('"/dashboard"') < featured.indexOf('"/presentasi"'), "Laporan and Presentasi lead the page");
});

test("presentation interface follows site typography and indigo palette without changing slide artwork", async () => {
  const css = await readFile(new URL("../src/components/presentation/presentation.module.css", import.meta.url), "utf8");
  assert.match(css, /#4f46e5/i);
  assert.match(css, /font-family:\s*inherit/);
  assert.doesNotMatch(css, /Georgia|#1e302c|#315c4b|#f5f6f1|#f4f5ef/i);
  // The chat reuses the Laporan conversation layout and plain, formal wording.
  for (const name of ["PresentationChat.tsx", "PresentationPlanPanel.tsx"]) {
    const source = await readFile(new URL(`../src/components/presentation/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /Bawa bahannya|Kita susun ceritanya|Sedikit obrolan|Siap jadi cerita|Pilih yang terasa seperti Anda/);
  }
  const chat = await readFile(new URL("../src/components/presentation/PresentationChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /AgentRunProgress/);
  assert.match(chat, /rounded-2xl rounded-br-md bg-slate-900/);
});

// Execute the actual component with isolated hooks and deferred transport. Imports
// are deny-by-default; neither the app auth module nor any server/provider loads.
async function visualFixture() {
  const source = await readFile(new URL("../src/components/presentation/VisualControls.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: "VisualControls.tsx",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const hooks: unknown[] = [];
  const effects: Effect[] = [];
  let hookIndex = 0;
  let effectIndex = 0;
  let pendingEffects: (() => void)[] = [];
  const requests: PendingRequest[] = [];
  const busyChanges: boolean[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const mocks: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState: (initial: unknown) => {
        const index = hookIndex++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value: unknown) => {
          hooks[index] = typeof value === "function" ? value(hooks[index]) : value;
        }];
      },
      useEffect: (effect: () => void | (() => void), dependencies?: readonly unknown[]) => {
        const index = effectIndex++;
        const previous = effects[index];
        if (previous && dependencies && previous.dependencies?.length === dependencies.length && dependencies.every((value, i) => Object.is(value, previous.dependencies![i]))) return;
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { dependencies, cleanup: effect() || undefined };
        });
      },
    },
    "lucide-react": { ImagePlus: "image-icon", RefreshCw: "refresh-icon", Sparkles: "sparkles-icon", X: "close-icon" },
    "./presentation.module.css": { default: {} },
    "@/lib/errors": { getErrorMessage: (error: Error) => error.message },
    "@/components/AuthProvider": { authenticatedFetch: (url: string, init: RequestInit) => {
      assert.equal(url, "/api/presentasi/project-a/art");
      return new Promise<Response>((resolve, reject) => requests.push({ url, init, resolve, reject }));
    } },
  };
  const exports: { default?: (props: Record<string, unknown>) => Element } = {};
  runInNewContext(compiled.outputText, {
    exports, AbortController,
    window: {
      setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 5000); timers.set(++timerId, callback); return timerId; },
      clearTimeout: (id: number) => timers.delete(id),
    },
    require(name: string) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected UI dependency: ${name}`);
      return mocks[name];
    },
  });
  assert.ok(exports.default);
  const deck = createStarterDeck("playful");
  const props = {
    root: "/api/presentasi/project-a", revision: 1, deck, slide: deck.slides[0], disabled: false, saved: true,
    onDeckChange: () => assert.fail("Asset listing must not change the deck"),
    onSlideChange: () => assert.fail("Generating an asset must not apply it"),
    onBusyChange: (busy: boolean) => busyChanges.push(busy),
  };
  function render() {
    hookIndex = 0; effectIndex = 0; pendingEffects = [];
    const tree = exports.default!(props);
    for (const effect of pendingEffects) effect();
    return tree;
  }
  function enterPrompt() {
    const field = elements(render()).find((element) => element.type === "textarea" && String(element.props.placeholder).startsWith("Jelaskan objek"));
    assert.ok(field);
    (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Ilustrasi jaringan layanan kampus" } });
    return render();
  }
  return {
    render, enterPrompt, requests, busyChanges, timers,
    cleanup: () => { for (const effect of effects) effect?.cleanup?.(); },
  };
}

test("delayed initial art GET blocks attempted POST until listing completes and then retains the new job", async (t) => {
  const fixture = await visualFixture();
  t.after(fixture.cleanup);
  let tree = fixture.enterPrompt();
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].init.method, "GET");
  const waiting = button(tree, "Memeriksa aset");
  assert.equal(waiting.props.disabled, true);
  // Invoke the handler even though the browser would suppress a disabled click.
  click(waiting);
  await flush();
  assert.equal(fixture.requests.length, 1, "A faster POST must not start while the initial GET is unresolved");
  assert.deepEqual(fixture.busyChanges, []);

  fixture.requests[0].resolve(json({ success: true, jobs: [] }));
  await flush();
  tree = fixture.render();
  const ready = button(tree, "Buat gambar AI");
  assert.equal(ready.props.disabled, false);
  click(ready);
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.requests[1].init.method, "POST");
  assert.equal(JSON.parse(String(fixture.requests[1].init.body)).prompt, "Ilustrasi jaringan layanan kampus");
  const duringPost = button(fixture.render(), "Memproses");
  assert.equal(duringPost.props.disabled, true);
  click(duringPost);
  assert.equal(fixture.requests.length, 2);
  fixture.requests[1].resolve(json({ success: true, job: { id: "job-a", status: "queued", title: "Aset baru", fileId: null, error: null } }));
  await flush();
  tree = fixture.render();
  assert.match(content(tree), /Aset baru/);
  assert.equal(button(tree, "Buat gambar AI").props.disabled, true);
  click(button(tree, "Buat gambar AI"));
  await flush();
  assert.equal(fixture.requests.length, 2, "An active job must also block the runtime generation handler");
  assert.equal(fixture.timers.size, 1, "The newly created job remains tracked for polling");
  assert.deepEqual(fixture.busyChanges, [true, false]);
});

test("failed initial art listing blocks generation until an explicit successful manual retry", async (t) => {
  for (const failure of ["network", "http"] as const) {
    await t.test(failure, async (t) => {
      const fixture = await visualFixture();
      t.after(fixture.cleanup);
      fixture.enterPrompt();
      if (failure === "network") fixture.requests[0].reject(new Error("Listing unavailable"));
      else fixture.requests[0].resolve(json({ success: false, error: "Listing unavailable" }, 503));
      await flush();
      let tree = fixture.render();
      assert.match(content(tree), /Listing unavailable/);
      assert.equal(button(tree, "Buat gambar AI").props.disabled, true);
      click(button(tree, "Buat gambar AI"));
      await flush();
      assert.equal(fixture.requests.length, 1);
      assert.equal(fixture.timers.size, 0, "A failed initial listing must not auto-retry");

      const failedRetry = click(button(tree, "Cek status lagi"));
      assert.equal(fixture.requests[1].init.method, "GET");
      fixture.requests[1].resolve(json({ success: false, error: "Still unavailable" }, 429));
      await failedRetry;
      tree = fixture.render();
      assert.equal(button(tree, "Buat gambar AI").props.disabled, true);
      click(button(tree, "Buat gambar AI"));
      assert.equal(fixture.requests.length, 2);

      const successfulRetry = click(button(tree, "Cek status lagi"));
      assert.equal(fixture.requests[2].init.method, "GET");
      click(button(fixture.render(), "Buat gambar AI"));
      assert.equal(fixture.requests.length, 3, "Generation stays blocked while the manual retry is unresolved");
      fixture.requests[2].resolve(json({ success: true, jobs: [] }));
      await successfulRetry;
      tree = fixture.render();
      assert.doesNotMatch(content(tree), /Still unavailable|Cek status lagi/);
      assert.equal(button(tree, "Buat gambar AI").props.disabled, false);
      click(button(tree, "Buat gambar AI"));
      assert.equal(fixture.requests.length, 4);
      assert.equal(fixture.requests[3].init.method, "POST");
      fixture.requests[3].resolve(json({ success: true, job: { id: "job-retry", status: "queued", title: "Retry asset", fileId: null, error: null } }));
      await flush();
      assert.deepEqual(fixture.busyChanges, [true, false]);
    });
  }
});

test("gateway exempts exact presentation art polling while retaining auth and limiting adjacent mutation paths", async () => {
  const source = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const limited: string[] = [];
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { next: () => new Response(null, { status: 204 }), json: Response.json.bind(Response) } },
    jose: { jwtVerify: async () => ({ payload: { sub: "offline-owner" } }) },
    "@/lib/server/auth": { SESSION_COOKIE_NAME: "offline-session" },
    "@/lib/server/request-guards": { enforceRateLimit: (key: string) => { limited.push(key); return new Response(null, { status: 429 }); } },
    "@/lib/server/maintenance": { isMaintenanceExemptPath: () => false, isSuperAdminId: async () => false, loadMaintenance: async () => ({ enabled: false }), maintenanceText: () => "" },
  };
  const exports: { proxy?: (request: unknown) => Promise<Response> } = {};
  runInNewContext(compiled.outputText, {
    exports, Headers, TextEncoder, process: { env: Object.freeze({ NODE_ENV: "test", AUTH_JWT_SECRET: "offline-test-key-not-a-secret" }) },
    require(name: string) { assert.ok(Object.hasOwn(mocks, name), `Unexpected gateway dependency: ${name}`); return mocks[name]; },
  });
  assert.ok(exports.proxy);
  const request = (pathname: string, signedIn = true, method = "GET") => exports.proxy!({
    nextUrl: { pathname }, method, headers: new Headers(),
    cookies: { get: () => signedIn ? { value: "offline-token" } : undefined },
  });
  const root = "/api/presentasi/project-a";
  for (let i = 0; i < 45; i++) assert.equal((await request(`${root}/art`)).status, 204);
  for (const path of [root, `${root}/run`]) assert.equal((await request(path)).status, 204);
  assert.deepEqual(limited, [], "Art polling must bypass the gateway's 40-request cap");
  assert.equal((await request(`${root}/art`, false)).status, 401, "The polling exemption is not an authentication exemption");
  for (const path of [`${root}/artwork`, `${root}/art/child`, `${root}/generate`, `${root}/revise`, `${root}/export`, `${root}/proposal`]) {
    assert.equal((await request(path, true, "POST")).status, 429, path);
    assert.equal(limited.at(-1), `api-gateway:offline-owner:${path}`);
  }
  assert.equal(limited.length, 6);
});

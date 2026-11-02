import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { jsx, jsxs } from "react/jsx-runtime";
import type { JournalVerificationResult } from "../src/lib/references/journal-verifier";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const doi = "10.1234/paper";
const issn = "1234-5679";
const venue = "Journal of Testing";
const crossref = (overrides = {}) => ({ message: { DOI: doi, title: ["Article title"], "container-title": [venue], publisher: "Publisher", type: "journal-article", ISSN: [issn], ...overrides } });
const openalex = (overrides = {}) => ({ doi: `https://doi.org/${doi}`, primary_location: { source: { display_name: venue, issn: [issn], is_in_doaj: true } }, ...overrides });
const doaj = (identifiers = [{ type: "pissn", id: issn }], title = venue) => ({ results: [{ bibjson: { title, identifier: identifiers } }] });
const json = (data: unknown, status = 200) => Response.json(data, { status });

// Compile the actual modules with deny-by-default dependencies. Auth, React hooks,
// and fetch are isolated; no DB, paid provider, real environment, or network loads.
async function fixture(fetcher: Fetcher = async () => new Response(null, { status: 404 }), fastTimeout = false, searchResponse?: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const cache = new Map<string, Record<string, unknown>>();
  const sourceCache = new Map<string, string>();
  const names = ["journal-check", "crossref", "journal-verifier"];
  for (const name of names) sourceCache.set(`./${name}`, await readFile(new URL(`../src/lib/references/${name}.ts`, import.meta.url), "utf8"));
  for (const [name, path] of Object.entries({ route: "../src/app/api/references/verify/route.ts", guards: "../src/lib/server/request-guards.ts", origin: "../src/lib/server/csrf-origin.ts", ui: "../src/components/JournalCheck.tsx" })) {
    sourceCache.set(name, await readFile(new URL(path, import.meta.url), "utf8"));
  }
  let signedIn = true;
  let authError = false;
  let hookIndex = 0;
  const hooks: unknown[] = [];
  let cleanup: (() => void) | undefined;
  let clickedRequests = 0;
  const globals = {
    Response, Request, URL, AbortController, TextDecoder, TextEncoder, console,
    process: { env: Object.freeze({}) },
    setTimeout: fastTimeout ? (fn: () => void) => setTimeout(fn, 5) : setTimeout,
    clearTimeout,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return fetcher(url, init);
    },
  };
  const aliases: Record<string, string> = {
    "@/lib/references/journal-check": "./journal-check", "@/lib/references/journal-verifier": "./journal-verifier",
    "@/lib/server/request-guards": "guards", "@/lib/server/csrf-origin": "origin",
  };
  const mocks: Record<string, unknown> = {
    "./provider-client": { isRecord: (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value), fetchWithRetryAndCache: () => {
      if (searchResponse !== undefined) return Promise.resolve(searchResponse);
      throw new Error("Unbounded provider fetch is forbidden");
    } },
    "@/lib/errors": { getErrorMessage: () => "Provider error" },
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    zod: { z },
    "@/lib/server/ai-budget": { AiBudgetError: class extends Error {} },
    "@/lib/server/auth": { authenticateRequestFromCookie: async () => {
      if (authError) throw new Error("Secret auth failure");
      return signedIn ? { ok: true, user: { id: "user-a" } } : { ok: false, status: 401, error: "Login required" };
    } },
    "react/jsx-runtime": { jsx, jsxs },
    react: {
      useId: () => "journal-test",
      useState: (initial: unknown) => {
        const index = hookIndex++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value: unknown) => { hooks[index] = value; }];
      },
      useRef: (initial: unknown) => {
        const index = hookIndex++;
        if (!(index in hooks)) hooks[index] = { current: initial };
        return hooks[index];
      },
      useEffect: (effect: () => (() => void)) => { cleanup = effect(); },
    },
    "@/components/AuthProvider": { authenticatedFetch: async (url: string, init?: RequestInit) => {
      assert.equal(url, "/api/references/verify");
      clickedRequests++;
      return post(new Request(`https://keluhkampus.my.id${url}`, { ...init, headers: { ...init?.headers, origin: "https://keluhkampus.my.id", "sec-fetch-site": "same-origin" } }));
    } },
  };
  function load(name: string): Record<string, unknown> {
    const key = aliases[name] || name;
    if (Object.hasOwn(mocks, key)) return mocks[key] as Record<string, unknown>;
    if (cache.has(key)) return cache.get(key)!;
    const source = sourceCache.get(key);
    assert.ok(source, `Unexpected dependency ${key}`);
    const compiled = ts.transpileModule(source, { fileName: key === "ui" ? "JournalCheck.tsx" : "module.ts", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    const exports = {};
    cache.set(key, exports);
    runInNewContext(compiled.outputText, { ...globals, exports, require: load });
    return exports;
  }
  const verify = load("./journal-verifier").verifyJournal as (input: { doi?: unknown; issn?: unknown; venue?: unknown }) => Promise<JournalVerificationResult>;
  const post = load("route").POST as (req: Request) => Promise<Response>;
  const request = (body: unknown = { doi }, headers: Record<string, string> = {}) => post(new Request("https://keluhkampus.my.id/api/references/verify", {
    method: "POST", headers: { origin: "https://keluhkampus.my.id", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { verify, post, request, calls, load, signOut: () => { signedIn = false; }, breakAuth: () => { authError = true; },
    render(props: Record<string, unknown>) {
      hookIndex = 0;
      const component = load("ui").default as (props: Record<string, unknown>) => Element;
      const editor = component(props);
      return (editor.type as (props: unknown) => Element)(editor.props);
    },
    cleanup: () => cleanup?.(), requests: () => clickedRequests,
  };
}

type Element = { type: unknown; props: { children?: unknown; [key: string]: unknown } };
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
function providerFetch(overrides: Partial<Record<string, unknown>> = {}): Fetcher {
  return async (url) => {
    const host = new URL(url).hostname;
    const value = Object.hasOwn(overrides, host) ? overrides[host] : host === "api.crossref.org" ? crossref() : host === "api.openalex.org" ? openalex() : doaj();
    return value instanceof Response ? value.clone() : json(value);
  };
}

test("Crossref search candidates remain unverified until an exact DOI lookup succeeds", async () => {
  const state = await fixture(providerFetch(), false, { message: { items: [crossref().message] } });
  const crossrefModule = state.load("./crossref");
  const search = crossrefModule.searchCrossref as (query: string) => Promise<{ doi: string; doiVerified: boolean }[]>;
  const candidates = await search("Article title");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].doi, doi);
  assert.equal(candidates[0].doiVerified, false);
  assert.equal(state.calls.length, 0);
  const verify = crossrefModule.verifyCrossrefDoi as (value: string) => Promise<{ verified: boolean }>;
  assert.equal((await verify(candidates[0].doi)).verified, true);
  assert.equal(state.calls.length, 1);
});

test("exact DOI identity, normalized DOI URL, metadata and timestamped provenance", async () => {
  const state = await fixture(providerFetch());
  const result = await state.verify({ doi: "https://doi.org/10.1234%2FPAPER", venue, issn: [issn] });
  assert.equal(result.status, "verified");
  assert.equal(result.confidence, "high");
  assert.equal(result.crossref.doi, doi);
  assert.equal(result.crossref.publisher, "Publisher");
  assert.equal(result.crossref.type, "journal-article");
  assert.equal(result.doaj.status, "verified");
  assert.equal(result.sources.length, 3);
  for (const source of result.sources) {
    assert.equal(source.checkedAt, result.checkedAt);
    assert.equal(new Date(source.checkedAt).toISOString(), source.checkedAt);
    assert.equal(source.status, "verified");
    assert.equal(new URL(source.url).protocol, "https:");
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result.manual)), { sinta: "manual_required", scopus: "manual_required", quartile: "manual_required" });
  for (const call of state.calls) {
    assert.ok(["api.crossref.org", "api.openalex.org", "doaj.org"].includes(new URL(call.url).hostname));
    assert.equal(call.init?.redirect, "error");
    assert.equal(call.init?.cache, "no-store");
    assert.ok(call.init?.signal);
  }
});

test("missing and mismatched DOI never verify, and publisher is not a venue", async () => {
  for (const response of [crossref({ DOI: "10.1234/other" }), crossref({ DOI: undefined })]) {
    const state = await fixture(providerFetch({ "api.crossref.org": response, "api.openalex.org": new Response(null, { status: 404 }) }));
    const result = await state.verify({ doi });
    assert.notEqual(result.crossref.status, "verified");
    assert.equal(result.confidence, "low");
    assert.equal(result.crossref.issn.length, 0);
  }
  const state = await fixture(providerFetch({ "api.crossref.org": crossref({ "container-title": [] }) }));
  assert.equal((await state.verify({ doi })).crossref.venue, undefined);
});

test("404 is not_found while rate limits, server errors, malformed JSON and aborts are unavailable", async () => {
  for (const status of [404, 429, 500, 503]) {
    const state = await fixture(async () => new Response(null, { status }));
    const result = await state.verify({ doi, issn: [issn] });
    assert.equal(result.status, status === 404 ? "not_found" : "unavailable");
    assert.equal(result.crossref.status, status === 404 ? "not_found" : "unavailable");
    assert.equal(result.openAlex.status, result.crossref.status);
    assert.equal(result.doaj.status, result.crossref.status);
    assert.equal(result.confidence, "low");
    assert.equal(state.calls.length, 3, "No retries");
  }
  for (const fetcher of [async () => new Response("not json"), async () => { throw new DOMException("aborted", "AbortError"); }]) {
    assert.equal((await (await fixture(fetcher)).verify({ doi })).crossref.status, "unavailable");
  }
});

test("fetch and body deadlines settle even when mocked transport ignores abort", async () => {
  const hangingFetch = await fixture(async () => new Promise<Response>(() => {}), true);
  assert.equal((await hangingFetch.verify({ doi, issn: [issn] })).status, "unavailable");
  assert.ok(hangingFetch.calls.every((call) => call.init?.signal?.aborted));
  const hangingBody = await fixture(async () => new Response(new ReadableStream({ start() {} })), true);
  assert.equal((await hangingBody.verify({ doi, issn: [issn] })).status, "unavailable");
});

test("response byte limits and malicious DOI URLs cannot cause unbounded or injected requests", async () => {
  for (const headers of [{ "content-length": "999999" }, {}] as Record<string, string>[]) {
    const state = await fixture(async () => new Response("x".repeat(512 * 1024 + 1), { headers }));
    assert.equal((await state.verify({ doi })).status, "unavailable");
  }
  const state = await fixture();
  for (const bad of ["https://evil.example/10.1234/a", "https://doi.org@evil.example/10.1234/a", "https://doi.org/10.1234/a?redirect=evil", "10.1234/a\nHost: evil", "https://doi.org/10.1234/%zz"]) {
    assert.equal((await state.verify({ doi: bad })).status, "manual_required");
  }
  assert.equal(state.calls.length, 0);
  const request = state.load("./crossref").fetchVerificationJson as (url: string) => Promise<unknown>;
  await assert.rejects(request("https://evil.example/x"), /Unsupported/);
  await assert.rejects(request("https://api.crossref.org:444/x"), /Unsupported/);
});

test("DOAJ checks explicit identifiers across results, not assumed query or title matches", async () => {
  for (const payload of [doaj([{ type: "pissn", id: "9999-9999" }]), { results: [{ bibjson: { title: venue } }] }, doaj([{ type: "doi", id: issn }]), { results: [] }]) {
    const state = await fixture(providerFetch({ "doaj.org": payload }));
    assert.equal((await state.verify({ issn: [issn] })).doaj.status, "not_found");
  }
  const state = await fixture(providerFetch({ "doaj.org": { results: [doaj([{ type: "pissn", id: "9999-9999" }]).results[0], doaj([{ type: "eissn", id: "12345679" }]).results[0]] } }));
  const result = await state.verify({ issn: [issn] });
  assert.equal(result.doaj.status, "verified");
  assert.deepEqual(Array.from(result.doaj.issn), [issn]);
});

test("OpenAlex must match DOI/source ISSN; missing DOAJ flag is unknown, not false", async () => {
  const wrongWork = await fixture(providerFetch({ "api.openalex.org": openalex({ doi: "https://doi.org/10.1234/other" }) }));
  assert.equal((await wrongWork.verify({ doi })).status, "conflict");
  const wrongSource = await fixture(providerFetch({ "api.openalex.org": { display_name: venue, issn: ["9999-9999"] }, "doaj.org": { results: [] } }));
  assert.equal((await wrongSource.verify({ issn: [issn] })).openAlex.status, "conflict");
  const noFlag = await fixture(providerFetch({ "api.openalex.org": openalex({ primary_location: { source: { display_name: venue, issn: [issn] } } }) }));
  assert.equal((await noFlag.verify({ doi })).openAlex.inDoaj, undefined);
});

test("conflicting input ISSN is never merged into provider evidence; venue substring is a conflict", async () => {
  const state = await fixture(providerFetch());
  const mismatch = await state.verify({ doi, issn: ["9999-9999"], venue: "Testing" });
  assert.equal(mismatch.status, "conflict");
  assert.equal(mismatch.confidence, "low");
  assert.deepEqual(Array.from(mismatch.crossref.issn), [issn]);
  assert.ok(mismatch.conflicts.some((entry) => entry.includes("ISSN")));
  assert.ok(mismatch.conflicts.some((entry) => entry.includes("venue")));
  const onlyCrossref = await fixture(providerFetch({ "api.openalex.org": new Response(null, { status: 503 }), "doaj.org": new Response(null, { status: 503 }) }));
  const single = await onlyCrossref.verify({ doi });
  assert.equal(single.confidence, "medium");
  assert.equal(single.status, "verified");
});

test("venue-only input requires manual checks without speculative provider calls", async () => {
  const state = await fixture();
  const result = await state.verify({ venue });
  assert.equal(result.status, "manual_required");
  assert.equal(result.confidence, "low");
  assert.equal(result.sources.length, 0);
  assert.equal(state.calls.length, 0);
});

test("real route enforces authentication, same-origin JSON, bounded payload and no-store on all paths", async () => {
  const state = await fixture(providerFetch());
  for (const [body, headers, expected] of [
    [{ doi }, { origin: "https://evil.example" }, 403],
    [{ doi }, { origin: "" }, 403],
    [{ doi }, { "sec-fetch-site": "same-site" }, 403],
    [{ doi }, { "content-type": "text/plain" }, 415],
    ["{", {}, 400], ["x".repeat(8193), {}, 413],
    [{ doi }, { "content-length": "8193" }, 413],
    [null, {}, 400], [{}, {}, 400], [{ issn: ["bad"] }, {}, 400],
    [{ doi: "https://evil.example/" }, {}, 400], [{ venue, extra: "ignored?" }, {}, 400],
  ] as const) {
    const response = await state.request(body, headers);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(state.calls.length, 0);
  state.signOut();
  const denied = await state.request();
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.equal(state.calls.length, 0);
  state.breakAuth();
  const failure = await state.request();
  assert.equal(failure.status, 500);
  assert.equal(failure.headers.get("cache-control"), "private, no-store");
  assert.doesNotMatch(await failure.text(), /Secret/);
});

test("route returns live verifier data and rate limits before provider calls, preserving Retry-After", async () => {
  const state = await fixture(providerFetch());
  const response = await state.request({ doi, issn: [issn], venue });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).data.status, "verified");
  for (let i = 1; i < 20; i++) assert.equal((await state.request({ venue })).status, 200);
  const calls = state.calls.length;
  const limited = await state.request();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "private, no-store");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(state.calls.length, calls);
});

test("one UI click reaches authenticated route, displays direct vs indirect DOAJ and never changes manual record", async () => {
  const state = await fixture(providerFetch());
  let changes = 0;
  const props = { source: { id: "source-a", doi, venue, issn: [issn] }, onVerificationChange: () => { changes++; } };
  const initial = state.render(props);
  const button = elements(initial).find((entry) => entry.type === "button" && content(entry).includes("Periksa metadata otomatis"));
  assert.ok(button);
  assert.equal(state.calls.length, 0);
  (button.props.onClick as () => void)();
  assert.match(content(state.render(props)), /Memeriksa metadata/);
  // The click handler intentionally fire-and-forgets; wait for its actual route work.
  for (let i = 0; i < 30 && !content(state.render(props)).includes("Metadata cocok"); i++) await new Promise<void>((resolve) => setImmediate(resolve));
  const rendered = content(state.render(props));
  assert.equal(state.requests(), 1);
  assert.match(rendered, /Metadata cocok/);
  assert.match(rendered, /Publisher/);
  assert.match(rendered, /journal-article/);
  assert.match(rendered, /rekaman DOI pada penyedia/);
  assert.match(rendered, /Judul karya:/);
  assert.doesNotMatch(rendered, /hanya memvalidasi artikel|Judul artikel:/);
  assert.match(rendered, /DOAJ langsung: ISSN cocok/);
  assert.match(rendered, /menurut OpenAlex: ya \(bukan konfirmasi langsung DOAJ\)/);
  assert.match(rendered, /tidak disimpan/);
  assert.match(rendered, /Scopus.*manual/);
  assert.equal(changes, 0);
  state.cleanup();
});

test("UI exposes no match, unavailable and authentication errors without claiming success", async () => {
  for (const outcome of ["not_found", "unavailable", "unauthenticated"]) {
    const state = await fixture(async () => new Response(null, { status: outcome === "unavailable" ? 503 : 404 }));
    if (outcome === "unauthenticated") state.signOut();
    const props = { source: { id: "source-a", doi } };
    const button = elements(state.render(props)).find((entry) => entry.type === "button" && content(entry).includes("Periksa metadata otomatis"))!;
    (button.props.onClick as () => void)();
    for (let i = 0; i < 30 && content(state.render(props)).includes("Memeriksa metadata..."); i++) await new Promise<void>((resolve) => setImmediate(resolve));
    const rendered = content(state.render(props));
    assert.match(rendered, outcome === "not_found" ? /Tidak ditemukan kecocokan/ : outcome === "unavailable" ? /Penyedia tidak tersedia/ : /Masuk terlebih dahulu/);
    assert.doesNotMatch(rendered, /Metadata cocok/);
    state.cleanup();
  }
});

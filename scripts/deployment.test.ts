import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function startFixture({ nested = true, dev = false, missingManifest = false } = {}) {
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const root = path.resolve("passenger-fixture");
  const standalone = path.join(root, ".next", "standalone");
  const env: Record<string, string> = { NODE_ENV: dev ? "development" : "production" };
  const calls: { app?: { dev: boolean; dir: string }; resolution?: string[]; cwd?: string; envRoot?: string; handler?: (req: { url: string }, res: object) => void; routed?: unknown; manifest?: string } = {};
  const config = { output: "standalone", distDir: ".next", poweredByHeader: false };
  const next = (options: { dev: boolean; dir: string }) => {
    assert.equal(calls.envRoot, root, "Root runtime configuration must load before Next initializes");
    calls.app = options;
    return { prepare: async () => {}, getRequestHandler: () => (_req: unknown, _res: unknown, parsed: unknown) => { calls.routed = parsed; } };
  };
  const modules: Record<string, unknown> = {
    http: { createServer: (handler: typeof calls.handler) => { calls.handler = handler; return { listen: () => {} }; } },
    url: { parse: (url: string) => { const parsed = new URL(url, "https://campus.test"); return { pathname: parsed.pathname, query: Object.fromEntries(parsed.searchParams) }; } },
    fs: {
      existsSync: (file: string) => file === standalone ? nested : !missingManifest,
      readFileSync: (file: string) => { calls.manifest = file; if (missingManifest) throw new Error("Missing standalone manifest"); return JSON.stringify({ config }); },
    },
    path,
    "resolved-next": next,
    "resolved-env": { loadEnvConfig: (dir: string, development: boolean) => { calls.envRoot = dir; assert.equal(development, dev); } },
  };
  const load = Object.assign((name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; }, {
    resolve(name: string, options: { paths: string[] }) { if (name === "@next/env") { assert.equal(options.paths[0], nested && !dev ? standalone : root); return "resolved-env"; } assert.equal(name, "next"); calls.resolution = [...options.paths]; return "resolved-next"; },
  });
  runInNewContext(serverSource, { require: load, __dirname: root, console, process: { env, chdir: (dir: string) => { calls.cwd = dir; }, exit: () => assert.fail("Unexpected server exit") } });
  await Promise.resolve();
  return { calls, root, standalone, config, env };
}

test("Passenger startup selects deployed nested build rather than stale root .next", async () => {
  const f = await startFixture();
  assert.equal(f.calls.app?.dir, f.standalone);
  assert.deepEqual(f.calls.resolution, [f.standalone]);
  assert.equal(f.calls.cwd, f.root, "Private upload/data paths must not move into standalone");
  assert.equal(f.calls.manifest, path.join(f.standalone, ".next", "required-server-files.json"));
  assert.deepEqual(JSON.parse(f.env.__NEXT_PRIVATE_STANDALONE_CONFIG), f.config);
  assert.equal(f.env.APPLICATION_NODE_MODULES, path.join(f.standalone, "node_modules"));
  assert.equal(f.calls.envRoot, f.root);
});

test("flattened manual deployment keeps working with root build config", async () => {
  const f = await startFixture({ nested: false });
  assert.equal(f.calls.app?.dir, f.root);
  assert.deepEqual(JSON.parse(f.env.__NEXT_PRIVATE_STANDALONE_CONFIG), f.config);
  assert.equal(f.env.APPLICATION_NODE_MODULES, path.join(f.root, "node_modules"));
});

test("development ignores standalone leftovers", async () => {
  const f = await startFixture({ dev: true });
  assert.equal(f.calls.app?.dir, f.root);
  assert.equal(f.env.__NEXT_PRIVATE_STANDALONE_CONFIG, undefined);
  assert.equal(f.calls.manifest, undefined);
});

test("broken nested deployment fails instead of silently serving stale root build", async () => {
  await assert.rejects(startFixture({ missingManifest: true }), /Missing standalone manifest/);
});

test("nested startup preserves Apache prefix adapter and query string", async () => {
  const f = await startFixture();
  assert.ok(f.calls.handler);
  f.calls.handler({ url: "/keluhkampus.my.id/presentasi?check=release" }, {});
  assert.equal(JSON.stringify(f.calls.routed), JSON.stringify({ pathname: "/presentasi", query: { check: "release" } }));
});

test("public release endpoint returns only compiled revision with no-store", async () => {
  const source = await readFile(new URL("../src/app/api/release/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const exported = {} as { GET: () => Response; dynamic: string };
  runInNewContext(compiled.outputText, { exports: exported, Response, process: { env: { APPLICATION_RELEASE: "a".repeat(40) } } });
  const response = exported.GET();
  assert.deepEqual(await response.json(), { commit: "a".repeat(40) });
  assert.equal(exported.dynamic, "force-dynamic");
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("raster WASM and font assets use selected release dependencies, not stale root assets", async () => {
  const source = await readFile(new URL("../src/lib/server/laporan/svg-raster.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const assetRoot = path.resolve("deployed-release", "node_modules");
  const reads: string[] = [];
  const exported = {} as { svgToPngServer: (svg: string) => Promise<Uint8Array> };
  const modules: Record<string, unknown> = {
    fs: { promises: { readFile: async (file: string) => { reads.push(file); return Buffer.from([1]); } } },
    path,
    "@resvg/resvg-wasm": { initWasm: async () => {}, Resvg: class { width = 10; height = 10; free() {} render() { return { asPng: () => new Uint8Array([1]), free() {} }; } } },
  };
  runInNewContext(compiled.outputText, { exports: exported, Buffer, Uint8Array, process: { env: { APPLICATION_NODE_MODULES: assetRoot }, cwd: () => path.resolve("private-data-root") }, require: (id: string) => { assert.ok(id in modules); return modules[id]; } });
  await exported.svgToPngServer("<svg/>");
  assert.equal(reads.length, 4);
  assert.equal(reads[0], path.join(assetRoot, "@resvg", "resvg-wasm", "index_bg.wasm"));
  assert.ok(reads.slice(1).every((file) => file.startsWith(path.join(assetRoot, "dejavu-fonts-ttf", "ttf"))));
});

test("deploy verifies the running commit after requesting restart, not just transfer success", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.ok(workflow.indexOf("Verify Active Production Release") > workflow.indexOf("touch tmp/restart.txt"));
  assert.match(workflow, /EXPECTED_COMMIT: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /release\.commit !== expected/);
  assert.match(workflow, /redirect: 'error'/);
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(config, /APPLICATION_RELEASE: .*process\.env\.GITHUB_SHA/);
});

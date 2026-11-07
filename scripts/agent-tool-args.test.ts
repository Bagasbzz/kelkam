import assert from "node:assert/strict";
import test from "node:test";
import { validateToolArgs } from "../src/lib/server/agent-runs/engine";
import { presentasiAgentDriver } from "../src/lib/server/presentasi/assistant";

const slide = (extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), layout: "statement", title: "Judul", eyebrow: "", body: [], notes: "", source: "", locked: false, ...extra,
});
const deck = (slides: unknown[]) => ({ id: crypto.randomUUID(), title: "Deck", theme: "editorial", slides });

test("commit_deck accepts slides that carry canvas adjustments", () => {
  const args = { deck: deck([slide({ adjustments: [{ target: "title", x: 1, y: 1, w: 50, h: 10 }] })]) };
  assert.equal(validateToolArgs(presentasiAgentDriver.tools, "commit_deck", args), null);
});

test("tool argument validation still rejects wrong types and unknown tools", () => {
  const wrong = { deck: deck([slide({ adjustments: [{ target: { not: "" }, x: 1, y: 1, w: 5, h: 5 }] })]) };
  assert.match(validateToolArgs(presentasiAgentDriver.tools, "commit_deck", wrong) ?? "", /target/);
  assert.match(validateToolArgs(presentasiAgentDriver.tools, "tidak_ada", {}) ?? "", /tidak tersedia/);
});

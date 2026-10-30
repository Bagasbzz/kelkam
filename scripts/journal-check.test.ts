import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJournalCheckLinks,
  normalizeJournalIssns,
  parseJournalVerification,
} from "../src/lib/references/journal-check";

test("normalizes and unions valid ISSNs without inventing identifiers", () => {
  assert.deepEqual(
    normalizeJournalIssns(["1234-5678", "12345678", "9876-543X", "bad", 12345678]),
    ["1234-5678", "9876-543X"],
  );
});

test("builds independent official and official-domain fallback links", () => {
  const links = buildJournalCheckLinks({ venue: "Journal of Testing", issn: ["1234-5678", "9876-543X"] });
  assert.equal(links.length, 12);
  assert.ok(links.some((link) => link.url.includes("sinta.kemdiktisaintek.go.id") && link.url.includes("12345678")));
  assert.ok(links.some((link) => link.url.includes("scimagojr.com") && link.url.includes("Journal%20of%20Testing")));
  assert.ok(links.some((link) => link.url.includes("google.com/search") && link.url.includes("site%3Asinta.kemdiktisaintek.go.id")));
  assert.ok(links.every((link) => /^https:\/\//.test(link.url)));
});

test("parses only user records with an official HTTPS evidence URL", () => {
  const valid = parseJournalVerification({
    sintaRank: 2,
    scimagoQuartile: "Q1",
    evidenceUrl: "https://sinta.kemdiktisaintek.go.id/journals/123",
    checkedAt: "2026-10-29T12:00:00.000Z",
    method: "user",
  });
  assert.deepEqual(valid?.sintaRank, 2);
  assert.deepEqual(valid?.scimagoQuartile, "Q1");

  assert.equal(parseJournalVerification({
    sintaRank: 2,
    evidenceUrl: "https://example.com/rank",
    checkedAt: "2026-10-29T12:00:00.000Z",
    method: "user",
  }), null);
  assert.equal(parseJournalVerification({
    sintaRank: 2,
    evidenceUrl: "https://www.google.com/search?q=sinta",
    checkedAt: "2026-10-29T12:00:00.000Z",
    method: "user",
  }), null);
  assert.equal(parseJournalVerification({
    sintaRank: 2,
    evidenceUrl: "https://sinta.kemdiktisaintek.go.id/journals/123",
    checkedAt: "2026-10-29T12:00:00Z",
    method: "user",
    extra: true,
  }), null);
});

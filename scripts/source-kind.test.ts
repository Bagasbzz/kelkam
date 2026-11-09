import assert from "node:assert/strict";
import test from "node:test";
import { classifySourceKind, formatApaCitation, normalizeSourceKinds, sourceKindOf } from "../src/lib/references/source-kind.ts";

test("provider publication types map to source kinds", () => {
  assert.equal(classifySourceKind({ publicationType: "journal-article" }), "journal");
  assert.equal(classifySourceKind({ publicationType: "proceedings-article" }), "journal");
  assert.equal(classifySourceKind({ publicationType: "book-chapter" }), "book");
  assert.equal(classifySourceKind({ publicationType: "Book" }), "book");
  assert.equal(classifySourceKind({ publicationType: "JournalArticle,BookSection" }), "book");
  assert.equal(classifySourceKind({ publicationType: "dissertation" }), "thesis");
  assert.equal(classifySourceKind({ publicationType: "posted-content" }), "thesis");
  assert.equal(classifySourceKind({ publicationType: "report" }), "official");
  assert.equal(classifySourceKind({ venueType: "repository", publicationType: "article" }), "thesis");
  assert.equal(classifySourceKind({}), "journal");
});

test("old sessions without kind fall back to venue type", () => {
  assert.equal(sourceKindOf({ venueType: "journal" }), "journal");
  assert.equal(sourceKindOf({ venueType: "repository" }), "thesis");
  assert.equal(sourceKindOf({ kind: "book", venueType: "journal" }), "book");
});

test("only searchable kinds are accepted from AI input", () => {
  assert.deepEqual(normalizeSourceKinds(["book", "web", "journal", "book", "x"]), ["book", "journal"]);
  assert.deepEqual(normalizeSourceKinds("thesis"), ["thesis"]);
  assert.deepEqual(normalizeSourceKinds(undefined), []);
});

test("APA citation follows the source kind", () => {
  const doiUrl = "https://doi.org/10.1/x";
  assert.equal(
    formatApaCitation({ kind: "journal", authors: ["A. Smith"], year: 2020, title: "Study", venue: "Journal One", doiUrl }),
    "A. Smith (2020). Study. Journal One. https://doi.org/10.1/x",
  );
  assert.equal(
    formatApaCitation({ kind: "book", authors: ["R. Pressman"], year: 2019, title: "Software Engineering", publisher: "McGraw-Hill", url: "https://books.google.com/x" }),
    "R. Pressman (2019). Software Engineering. McGraw-Hill.",
  );
  assert.equal(
    formatApaCitation({ kind: "book", publicationType: "book-chapter", authors: ["B. Boehm"], year: 1984, title: "Economics", venue: "Pioneers", publisher: "Springer", doiUrl }),
    "B. Boehm (1984). Economics. Dalam Pioneers. Springer. https://doi.org/10.1/x",
  );
  assert.equal(
    formatApaCitation({ kind: "book", authors: [], year: 2019, title: "Handbook", publisher: "Springer" }),
    "Handbook. (2019). Springer.",
  );
  assert.equal(
    formatApaCitation({ kind: "thesis", publicationType: "dissertation", authors: ["C. Dewi"], year: 2022, title: "Sistem", venue: "Repositori UI", url: "https://lib.ui.ac.id/x" }),
    "C. Dewi (2022). Sistem [Tesis/disertasi]. Repositori UI. https://lib.ui.ac.id/x",
  );
});

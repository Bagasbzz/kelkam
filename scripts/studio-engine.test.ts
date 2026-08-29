import assert from "node:assert/strict";
import test from "node:test";
import {
  addStudioSource,
  advanceArtifact,
  answerStudioQuestion,
  createStudioProject,
  specificationAsMarkdown,
  updateFormatProfile,
  updateStudioIntake,
} from "../src/lib/studio/engine.ts";

const timestamp = "2026-07-27T00:00:00.000Z";

function question(project: ReturnType<typeof createStudioProject>, key: string) {
  const item = project.questions.find((candidate) => candidate.key === key);
  assert.ok(item, `question ${key} should exist`);
  return item;
}

function answer(project: ReturnType<typeof createStudioProject>, key: string, value: string, lock = false) {
  const item = question(project, key);
  return answerStudioQuestion(project, item.id, value, { lock }, timestamp);
}

test("Project Studio starts with deterministic blocker questions and a readiness gate", () => {
  const project = createStudioProject({ id: "project_test", name: "Test" }, timestamp);
  assert.equal(project.schemaVersion, 1);
  assert.ok(project.questions.length >= 15);
  assert.ok(project.questions.some((item) => item.key === "flow.exceptions" && item.class === "important"));
  assert.ok(project.readiness.blockerCount > 0);
  assert.equal(project.artifacts.find((item) => item.id === "final-docx")?.status, "not_started");
});

test("Answers become decisions and compile into one specification", () => {
  let project = createStudioProject({ id: "project_spec", name: "Spec test" }, timestamp);
  project = updateStudioIntake(project, {
    title: "Sistem Keluh Kampus",
    problem: "Aduan mahasiswa tersebar dan sulit dilacak.",
    objective: "Membangun alur pelaporan dan pelacakan yang dapat diaudit.",
    institution: "Universitas Test",
    deadline: "2026-08-30",
  }, timestamp);
  project = addStudioSource(project, {
    kind: "campus_guide",
    authority: "binding",
    title: "Pedoman Format Fakultas",
    content: "A4; margin 4-3-3-4 cm; APA 7.",
  }, timestamp);
  project = addStudioSource(project, {
    kind: "lecturer_request",
    authority: "binding",
    title: "Brief Dosen",
    content: "Wajib ada aktor, exception, dan test case.",
  }, timestamp);

  project = answer(project, "scope.in", "Pelaporan keluhan; pelacakan status; dashboard admin", true);
  project = answer(project, "scope.out", "Pembayaran online; aplikasi mobile native");
  project = answer(project, "actors.matrix", "Mahasiswa — membuat dan melihat keluhan\nAdmin — memverifikasi dan mengubah status", true);
  project = answer(project, "requirements.functional", "Membuat keluhan\nMelacak status\nMemverifikasi keluhan", true);
  project = answer(project, "requirements.nonfunctional", "Role-based access; audit log; response maksimal 3 detik");
  project = answer(project, "requirements.business_rules", "Keluhan final tidak dapat dihapus; hanya admin yang dapat memverifikasi");
  project = answer(project, "flow.normal", "Mahasiswa login\nMahasiswa mengisi keluhan\nAdmin memverifikasi\nSistem menampilkan status", true);
  project = answer(project, "flow.exceptions", "Data kosong — tampilkan validasi — keluhan tidak disimpan");
  project = answer(project, "data.entities", "User; Keluhan; Status; AuditLog");
  project = answer(project, "method.approach", "Prototype iteratif; black-box testing; wawancara admin");
  project = answer(project, "citation.style", "APA 7", true);
  project = answer(project, "lecturer.requests", "Wajib menjelaskan exception dan pengujian", true);
  project = answer(project, "format.binding_source", "Pedoman Format Fakultas", true);

  assert.equal(project.specification.title, "Sistem Keluh Kampus");
  assert.equal(project.specification.actors.length, 2);
  assert.equal(project.specification.functionalRequirements.length, 3);
  assert.ok(project.specification.unresolvedBlockers.length === 0);
  assert.ok(specificationAsMarkdown(project.specification).includes("Sistem Keluh Kampus"));
});

test("Artifact graph blocks invalid approval and propagates stale state", () => {
  let project = createStudioProject({ id: "project_graph", name: "Graph test" }, timestamp);
  project = advanceArtifact(project, "project-spec", "approve", [], timestamp);
  project = advanceArtifact(project, "requirements", "draft", [], timestamp);
  project = advanceArtifact(project, "requirements", "approve", [], timestamp);
  project = advanceArtifact(project, "actor-matrix", "draft", [], timestamp);
  project = advanceArtifact(project, "actor-matrix", "approve", [], timestamp);
  project = advanceArtifact(project, "usecase-main", "draft", [], timestamp);
  project = advanceArtifact(project, "usecase-main", "approve", [], timestamp);
  assert.equal(project.artifacts.find((item) => item.id === "usecase-main")?.status, "approved");
  assert.throws(() => advanceArtifact(project, "sequence-main", "approve", [], timestamp), /Dependensi belum siap/);

  project = answer(project, "identity.title", "Judul baru");
  assert.equal(project.artifacts.find((item) => item.id === "usecase-main")?.status, "stale");
  assert.equal(project.artifacts.find((item) => item.id === "sequence-main")?.status, "not_started");
});

test("Format profile preflight requires a real binding source", () => {
  let project = createStudioProject({ id: "project_format", name: "Format test" }, timestamp);
  assert.ok(project.formatIssues.some((issue) => issue.id === "format-source" && issue.severity === "error"));
  project = addStudioSource(project, {
    kind: "campus_guide",
    authority: "binding",
    title: "Pedoman resmi",
    content: "Format A4",
  }, timestamp);
  const sourceId = project.sources[0].id;
  project = updateFormatProfile(project, { sourceId }, timestamp);
  assert.equal(project.formatIssues.some((issue) => issue.id === "format-source"), false);
});

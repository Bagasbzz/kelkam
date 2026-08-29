import assert from "node:assert/strict";
import test from "node:test";

import {
  autoLayoutDiagram,
  validateDiagramData,
  validateSpec,
  type CompactSpecLike,
  type SupportedDiagramType,
} from "../src/lib/uml/diagram-guard.ts";
import type { DiagramEdge, DiagramNode } from "../src/lib/types/diagram.ts";

const goldenSpecs: Array<{
  name: string;
  type: SupportedDiagramType;
  prompt: string;
  spec: CompactSpecLike;
}> = [
  {
    name: "activity login mahasiswa",
    type: "activity",
    prompt: "Buat activity diagram login mahasiswa, validasi kredensial, tampilkan kesalahan, lalu masuk dashboard.",
    spec: {
      title: "Login Mahasiswa",
      lanes: ["Mahasiswa", "Sistem"],
      steps: [
        { id: "start", lane: "Mahasiswa", type: "start", text: "Mulai", next: "open" },
        { id: "open", lane: "Mahasiswa", type: "activity", text: "Buka halaman login", next: "input" },
        { id: "input", lane: "Mahasiswa", type: "activity", text: "Masukkan username dan password", next: "validate" },
        { id: "validate", lane: "Sistem", type: "activity", text: "Validasi kredensial", next: "valid" },
        { id: "valid", lane: "Sistem", type: "decision", text: "Kredensial valid?", yes: "session", no: "error" },
        { id: "error", lane: "Sistem", type: "activity", text: "Tampilkan pesan gagal", next: "input" },
        { id: "session", lane: "Sistem", type: "activity", text: "Buat sesi pengguna", next: "dashboard" },
        { id: "dashboard", lane: "Mahasiswa", type: "activity", text: "Tampilkan dashboard", next: "end" },
        { id: "end", lane: "Mahasiswa", type: "end", text: "Selesai" },
      ],
    },
  },
  {
    name: "flowchart pengaduan kampus",
    type: "flowchart",
    prompt: "Flowchart pengaduan kampus: mahasiswa kirim keluhan, sistem validasi, petugas tindak lanjut, mahasiswa menerima status.",
    spec: {
      title: "Pengaduan Kampus",
      steps: [
        { id: "start", type: "start", text: "Mulai", next: "submit" },
        { id: "submit", type: "process", text: "Mahasiswa mengirim keluhan", next: "validate" },
        { id: "validate", type: "decision", text: "Data keluhan lengkap?", yes: "assign", no: "revise" },
        { id: "revise", type: "process", text: "Mahasiswa melengkapi keluhan", next: "submit" },
        { id: "assign", type: "process", text: "Sistem meneruskan ke petugas", next: "follow-up" },
        { id: "follow-up", type: "process", text: "Petugas menindaklanjuti keluhan", next: "notify" },
        { id: "notify", type: "process", text: "Mahasiswa menerima status", next: "end" },
        { id: "end", type: "end", text: "Selesai" },
      ],
    },
  },
  {
    name: "use case penyusunan laporan",
    type: "usecase",
    prompt: "Use case penyusunan laporan mahasiswa yang direview dosen dan diperiksa formatnya oleh sistem.",
    spec: {
      title: "Penyusunan Laporan",
      actors: [
        { id: "student", name: "Mahasiswa", side: "left" },
        { id: "lecturer", name: "Dosen", side: "right" },
      ],
      usecases: [
        { id: "draft", text: "Menyusun draf laporan", actors: ["student"] },
        { id: "format", text: "Memeriksa format laporan", actors: ["student"] },
        { id: "review", text: "Meninjau laporan", actors: ["lecturer"] },
        { id: "revise", text: "Memperbaiki laporan", actors: ["student", "lecturer"] },
      ],
    },
  },
  {
    name: "sequence pengiriman keluhan",
    type: "sequence",
    prompt: "Sequence mahasiswa mengirim keluhan melalui antarmuka, API menyimpan ke database, lalu status ditampilkan.",
    spec: {
      title: "Pengiriman Keluhan",
      participants: [
        { id: "student", name: "Mahasiswa" },
        { id: "ui", name: "Antarmuka" },
        { id: "api", name: "API Keluhan" },
        { id: "db", name: "Database" },
      ],
      messages: [
        { from: "student", to: "ui", text: "Isi formulir keluhan" },
        { from: "ui", to: "api", text: "Kirim data keluhan" },
        { from: "api", to: "db", text: "Simpan keluhan" },
        { from: "db", to: "api", text: "Konfirmasi tersimpan", return: true },
        { from: "api", to: "ui", text: "Kirim status berhasil", return: true },
        { from: "ui", to: "student", text: "Tampilkan nomor keluhan", return: true },
      ],
    },
  },
];

test("golden UML scenarios pass the strict quality gate", () => {
  for (const scenario of goldenSpecs) {
    const result = validateSpec(scenario.spec, scenario.type, scenario.prompt);
    assert.equal(result.ok, true, `${scenario.name}: ${result.errors.join(" | ")}`);
    assert.equal(
      result.warnings.some((warning) => warning.includes("Istilah inti")),
      false,
      `${scenario.name}: output lost the prompt context`,
    );
  }
});

test("flow validation rejects broken branches and unreachable content", () => {
  const result = validateSpec({
    title: "Alur Rusak",
    steps: [
      { id: "start", type: "start", text: "Mulai", next: "decision" },
      { id: "decision", type: "decision", text: "Valid?", yes: "end", no: "missing" },
      { id: "orphan", type: "process", text: "Node liar", next: "end" },
      { id: "end", type: "end", text: "Selesai" },
    ],
  }, "flowchart", "validasi data");

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /cabang tidak/i);
  assert.match(result.errors.join(" "), /tidak terhubung dari start/i);
});

test("use-case and sequence validation reject dangling references", () => {
  const usecase = validateSpec({
    actors: [{ id: "student", name: "Mahasiswa" }],
    usecases: [{ id: "submit", text: "Mengirim laporan", actors: ["ghost"] }],
  }, "usecase", "mahasiswa mengirim laporan");
  assert.equal(usecase.ok, false);
  assert.match(usecase.errors.join(" "), /aktor yang tidak ada/i);

  const sequence = validateSpec({
    participants: [
      { id: "student", name: "Mahasiswa" },
      { id: "api", name: "API" },
    ],
    messages: [
      { from: "student", to: "api", text: "Kirim data" },
      { from: "api", to: "database", text: "Simpan data" },
      { from: "api", to: "student", text: "Kirim status", return: true },
      { from: "student", to: "student", text: "Pesan diri sendiri" },
    ],
  }, "sequence", "mahasiswa mengirim data");
  assert.equal(sequence.ok, false);
  assert.match(sequence.errors.join(" "), /participant yang tidak ada|dirinya sendiri|participant yang sama/i);
});

test("use-case auto layout separates actors sharing the same use case", () => {
  const nodes: DiagramNode[] = [
    { id: "a1", type: "actor", text: "Mahasiswa", lines: ["Mahasiswa"], x: 0, y: 0, width: 60, height: 80, side: "left" },
    { id: "a2", type: "actor", text: "Dosen", lines: ["Dosen"], x: 0, y: 0, width: 60, height: 80, side: "left" },
    { id: "a3", type: "actor", text: "Admin", lines: ["Admin"], x: 0, y: 0, width: 60, height: 80, side: "left" },
    { id: "u1", type: "usecase", text: "Meninjau laporan", lines: ["Meninjau laporan"], x: 0, y: 0, width: 190, height: 76 },
  ];
  const edges: DiagramEdge[] = ["a1", "a2", "a3"].map((actorId) => ({
    id: `edge-${actorId}`,
    fromId: actorId,
    toId: "u1",
  }));

  const laidOut = autoLayoutDiagram(nodes, edges, "usecase");
  const validation = validateDiagramData(laidOut, edges, "usecase");

  assert.equal(validation.ok, true, validation.errors.join(" | "));
  assert.equal(
    validation.warnings.some((warning) => warning.includes("bertumpuk")),
    false,
    validation.warnings.join(" | "),
  );
  assert.equal(new Set(laidOut.filter((node) => node.type === "actor").map((node) => node.y)).size, 3);
});

test("render validation catches invalid endpoints and duplicate edges", () => {
  const nodes: DiagramNode[] = [
    { id: "start", type: "start", text: "Mulai", lines: ["Mulai"], x: 100, y: 100, width: 80, height: 60 },
  ];
  const edges: DiagramEdge[] = [
    { id: "edge-1", fromId: "start", toId: "missing" },
    { id: "edge-1", fromId: "start", toId: "missing" },
  ];
  const result = validateDiagramData(nodes, edges, "flowchart");

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /ID edge render duplikat/i);
  assert.match(result.errors.join(" "), /node yang tidak ada/i);
});

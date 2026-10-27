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
import { diagramToSequenceSpec, messageKind, sequenceToDiagram, sequenceSpecErrors, type SequenceSpec } from "../src/lib/uml/sequence.ts";
import { sequenceShapes } from "../src/lib/uml/sequence-shapes.ts";
import { routeEdge } from "../src/lib/uml/edge-route.ts";
import { diagramToSvg } from "../src/lib/uml/render-svg.ts";

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

const richSequence: SequenceSpec = {
  participants: [{ id: "user", name: "Pengguna", kind: "actor" }, { id: "api", name: "Layanan", kind: "control" }, { id: "worker", name: "Pekerja", kind: "entity" }],
  messages: [
    { from: "user", to: "api", text: "Kirim permintaan" },
    { from: "api", to: "api", text: "Validasi data" },
    { from: "api", to: "worker", text: "Buat pekerja", kind: "create" },
    { from: "api", to: "worker", text: "Proses tugas", kind: "async" },
    { from: "worker", to: "api", text: "Hasil proses", return: true },
    { from: "api", to: "worker", text: "Hapus pekerja", kind: "destroy" },
    { from: "api", to: "user", text: "Tampilkan hasil", kind: "return" },
  ],
  activations: [{ participant: "api", from: 1, to: 7 }, { participant: "api", from: 2, to: 2, depth: 1 }, { participant: "worker", from: 4, to: 5 }],
  fragments: [{ kind: "alt", from: 4, to: 6, operands: [{ from: 4, guard: "valid" }, { from: 6, guard: "selesai" }] }],
  notes: [{ kind: "note", text: "Periksa hak akses", after: 0, participants: ["api"] }, { kind: "ref", text: "Pencatatan audit", after: 7, participants: ["user", "api"] }],
};

test("sequence symbols survive layout, serialization, and semantic round trip", () => {
  assert.deepEqual(sequenceSpecErrors(richSequence), []);
  assert.equal(validateSpec(richSequence, "sequence").ok, true);
  const diagram = sequenceToDiagram(richSequence);
  const check = validateDiagramData(diagram.nodes, diagram.edges, "sequence");
  assert.equal(check.ok, true, check.errors.join(" | "));
  assert.deepEqual(autoLayoutDiagram(diagram.nodes, diagram.edges, "sequence"), diagram.nodes);
  const roundTrip = diagramToSequenceSpec(JSON.parse(JSON.stringify(diagram.nodes)), diagram.edges);
  assert.deepEqual(sequenceSpecErrors(roundTrip), []);
  assert.deepEqual(roundTrip.fragments, [{ ...richSequence.fragments![0], participants: ["user", "api", "worker"] }]);
  assert.deepEqual(roundTrip.activations, richSequence.activations!.map((a) => ({ depth: 0, ...a })));
  assert.deepEqual(roundTrip.notes, richSequence.notes);
  const worker = diagram.nodes.find((n) => n.id === "worker")!;
  assert.equal(worker.created, true);
  assert.equal(worker.destroyed, true);
  assert.equal(worker.y + worker.height, diagram.edges[5].y);
});

test("sequence routing uses self loops, activation boundaries, and open response arrows", () => {
  const { nodes, edges } = sequenceToDiagram(richSequence);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const routed = edges.map((e) => routeEdge(e, byId.get(e.fromId)!, byId.get(e.toId)!, nodes));
  assert.equal(routed[1].points.length, 4);
  assert.ok(routed[1].points[3].y > routed[1].points[0].y);
  assert.equal(routed[3].marker, "open");
  assert.equal(routed[4].marker, "open");
  assert.equal(routed[6].marker, "open");
  assert.equal(messageKind({ dashed: true }), "return");
  assert.notEqual(routed[0].points[1].x, byId.get("api")!.x + byId.get("api")!.width / 2);
  assert.equal(routed[2].points[1].x, byId.get("worker")!.x);
});

test("sequence validation rejects invalid lifecycle, ranges, and crossing fragments", () => {
  const invalid = structuredClone(richSequence);
  invalid.messages!.push({ from: "worker", to: "api", text: "Sudah dihancurkan" });
  invalid.activations!.push({ participant: "ghost", from: 0, to: 100 });
  invalid.fragments!.push({ kind: "loop", from: 5, to: 7, operands: [{ from: 5, guard: "ulang" }] });
  invalid.notes!.push({ kind: "note", text: "", after: 99, participants: ["ghost"] });
  const errors = sequenceSpecErrors(invalid).join(" ");
  assert.match(errors, /sudah dihancurkan/);
  assert.match(errors, /Activation/);
  assert.match(errors, /saling memotong/);
  assert.match(errors, /Note\/ref/);
  const beforeCreate = structuredClone(richSequence);
  beforeCreate.messages![0].to = "worker";
  assert.match(sequenceSpecErrors(beforeCreate).join(" "), /sebelum create/);
});

test("legacy sequence returns and implicit sync self calls remain valid", () => {
  const spec: SequenceSpec = { participants: richSequence.participants!.slice(0, 2), messages: [
    { from: "user", to: "api", text: "Masuk" }, { from: "api", to: "api", text: "Validasi" },
    { from: "api", to: "user", text: "Berhasil", return: true }, { from: "user", to: "api", text: "Lanjut" },
  ] };
  assert.equal(validateSpec(spec, "sequence").ok, true);
  const data = sequenceToDiagram(spec);
  assert.equal(validateDiagramData(data.nodes, data.edges, "sequence").ok, true);
});

test("nested frames, long guards, all participant icons, and creation spacing remain valid", () => {
  const spec = structuredClone(richSequence);
  spec.fragments!.push({ kind: "loop", from: 4, to: 5, participants: ["api", "worker"], operands: [{ from: 4, guard: "ulang sampai semua data panjang selesai diperiksa dengan benar dan lengkap" }] });
  spec.fragments![0].operands[1].guard = "selesai setelah semua pekerjaan diperiksa kembali";
  const data = sequenceToDiagram(spec);
  const result = validateDiagramData(data.nodes, data.edges, "sequence");
  assert.equal(result.ok, true, result.errors.join(" | "));
  assert.deepEqual(sequenceSpecErrors(diagramToSequenceSpec(data.nodes, data.edges)), []);
  const worker = data.nodes.find((n) => n.id === "worker")!;
  assert.ok(data.edges[3].y! - worker.y >= 80 + 32);
  for (const kind of ["actor", "boundary", "control", "entity", "database", "participant"] as const) {
    const shapes = sequenceShapes({ ...worker, participantKind: kind, text: "Participant Dengan Nama Panjang" });
    assert.ok(shapes.some((s) => s.tag === "text"));
    assert.ok(shapes.some((s) => s.tag === "line" && s.attrs.strokeDasharray));
  }
});

test("sequence SVG uses shared primitives, escaped text, and can rasterize", async () => {
  const data = sequenceToDiagram(richSequence);
  data.nodes.find((n) => n.type === "note")!.text = '<script>alert("x")</script>';
  const svg = diagramToSvg(data);
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes('id="arrowhead-open"'));
  const frame = data.nodes.find((n) => n.type === "fragment")!;
  assert.ok(sequenceShapes(frame).some((s) => s.tag === "line" && s.attrs.strokeDasharray));
  assert.ok(svg.includes("[valid]"));
  const { svgToPngServer } = await import("../src/lib/server/laporan/svg-raster.ts");
  const png = await svgToPngServer(svg, 1);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  if (process.env.UML_TEST_PNG) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.UML_TEST_PNG, png);
  }
});

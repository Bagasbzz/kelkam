import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";
import { validateSpec } from "@/lib/uml/diagram-guard";

export const maxDuration = 45;

type DiagramType = "flowchart" | "usecase" | "activity" | "sequence";
type StepType = "start" | "end" | "process" | "activity" | "decision";

interface CompactStep {
  id: string;
  lane?: string;
  type: StepType;
  text: string;
  next?: string;
  yes?: string;
  no?: string;
}

interface CompactSpec {
  needsClarification?: boolean;
  clarification?: string;
  title?: string;
  lanes?: string[];
  steps?: CompactStep[];
  actors?: { id: string; name: string; side?: "left" | "right" }[];
  usecases?: { id: string; text: string; actors: string[] }[];
  participants?: { id: string; name: string }[];
  messages?: { from: string; to: string; text: string; return?: boolean }[];
  qualityNotes?: string[];
}

const allowedTypes = new Set(["flowchart", "usecase", "activity", "sequence"]);

const cleanId = (value: string, fallback: string) => {
  const cleaned = String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return cleaned || fallback;
};

const cleanText = (value: string, fallback: string, max = 90) => String(value || fallback).replace(/\s+/g, " ").trim().replace(/^[-•\d.)\s]+/, "").slice(0, max) || fallback;

const wrapText = (text: string, max = 20) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = words.shift() || "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length <= max) line = `${line} ${word}`.trim();
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
};

const nodeSize = (type: string, text: string) => {
  if (type === "start" || type === "end") return { width: 80, height: 60 };
  if (type === "decision") return { width: 180, height: 118 };
  const lines = wrapText(text, 20);
  return { width: Math.max(150, Math.min(260, Math.max(...lines.map((l) => l.length), 1) * 9 + 48)), height: Math.max(64, lines.length * 22 + 38) };
};

function inferDomainPrompt(prompt: string, reportContext: any) {
  const parts = [
    prompt,
    reportContext?.reportTitle,
    reportContext?.topic,
    reportContext?.purpose,
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function buildGenericSpec(prompt: string, diagramType: DiagramType, reportContext: any): CompactSpec {
  const contextText = inferDomainPrompt(prompt, reportContext);
  const title = cleanText(reportContext?.reportTitle || reportContext?.topic || prompt, "Proses Sistem", 72);
  const subject = cleanText(title.replace(/^(buat|generate|diagram|uml|alur)\s+/i, ""), "sistem", 60);
  const actor = /admin|operator|petugas/i.test(contextText) ? "Admin" : /mahasiswa|student/i.test(contextText) ? "Mahasiswa" : "Pengguna";

  if (diagramType === "usecase") {
    return {
      title: `Use Case ${subject}`,
      actors: [
        { id: "actor-primary", name: actor, side: "left" },
        { id: "actor-system", name: "Sistem", side: "right" },
      ],
      usecases: [
        { id: "uc-access", text: `Mengakses ${subject}`, actors: ["actor-primary"] },
        { id: "uc-input", text: "Mengisi data yang diperlukan", actors: ["actor-primary"] },
        { id: "uc-validate", text: "Memvalidasi data", actors: ["actor-system"] },
        { id: "uc-process", text: "Memproses permintaan", actors: ["actor-system"] },
        { id: "uc-result", text: "Melihat hasil proses", actors: ["actor-primary"] },
      ],
      qualityNotes: ["Spec dibuat dari template generik karena prompt tidak cocok dengan template khusus."],
    };
  }

  if (diagramType === "sequence") {
    return {
      title: `Sequence Diagram ${subject}`,
      participants: [
        { id: "user", name: actor },
        { id: "ui", name: "Antarmuka" },
        { id: "service", name: "Layanan Sistem" },
        { id: "db", name: "Database" },
      ],
      messages: [
        { from: "user", to: "ui", text: "Membuka fitur" },
        { from: "user", to: "ui", text: "Mengisi dan mengirim data" },
        { from: "ui", to: "service", text: "Meneruskan permintaan" },
        { from: "service", to: "db", text: "Validasi dan simpan/ambil data" },
        { from: "db", to: "service", text: "Kirim hasil query", return: true },
        { from: "service", to: "ui", text: "Kirim status proses", return: true },
        { from: "ui", to: "user", text: "Tampilkan hasil", return: true },
      ],
      qualityNotes: ["Spec dibuat dari template generik karena prompt tidak cocok dengan template khusus."],
    };
  }

  const actionType: StepType = diagramType === "activity" ? "activity" : "process";
  const lanes = diagramType === "activity" ? [actor, "Sistem"] : undefined;
  return {
    title: `Alur ${subject}`,
    lanes,
    steps: [
      { id: "start", lane: lanes?.[0], type: "start", text: "Mulai", next: "open" },
      { id: "open", lane: lanes?.[0], type: actionType, text: "Buka fitur yang dibutuhkan", next: "input" },
      { id: "input", lane: lanes?.[0], type: actionType, text: "Masukkan data atau pilihan", next: "validate" },
      { id: "validate", lane: lanes?.[1], type: actionType, text: "Validasi kelengkapan data", next: "valid" },
      { id: "valid", lane: lanes?.[1], type: "decision", text: "Data valid?", yes: "process", no: "revise" },
      { id: "revise", lane: lanes?.[0], type: actionType, text: "Perbaiki input", next: "input" },
      { id: "process", lane: lanes?.[1], type: actionType, text: "Proses permintaan", next: "save" },
      { id: "save", lane: lanes?.[1], type: actionType, text: "Simpan atau perbarui data", next: "result" },
      { id: "result", lane: lanes?.[0], type: actionType, text: "Tampilkan hasil proses", next: "end" },
      { id: "end", lane: lanes?.[0], type: "end", text: "Selesai" },
    ],
    qualityNotes: ["Spec dibuat dari template generik karena prompt tidak cocok dengan template khusus."],
  };
}

function buildFlowSpec(kind: "login" | "crud" | "transaction", diagramType: DiagramType, prompt: string): CompactSpec {
  const asActivity = diagramType === "activity";
  const actionType: StepType = asActivity ? "activity" : "process";
  const object = prompt.match(/kelola\s+([a-zA-Z0-9\s]+)/i)?.[1]?.trim() || "data";
  const lanes = asActivity ? [kind === "login" ? "Pengguna" : "Pengguna/Admin", "Sistem"] : undefined;

  if (kind === "login") {
    return { title: "Login", lanes, steps: [
      { id: "start", lane: lanes?.[0], type: "start", text: "Mulai", next: "open" },
      { id: "open", lane: lanes?.[0], type: actionType, text: "Buka halaman login", next: "input" },
      { id: "input", lane: lanes?.[0], type: actionType, text: "Masukkan username dan password", next: "click" },
      { id: "click", lane: lanes?.[0], type: actionType, text: "Klik tombol login", next: "validate" },
      { id: "validate", lane: lanes?.[1], type: actionType, text: "Validasi kredensial", next: "valid" },
      { id: "valid", lane: lanes?.[1], type: "decision", text: "Kredensial valid?", yes: "role", no: "failed" },
      { id: "failed", lane: lanes?.[0], type: actionType, text: "Tampilkan pesan login gagal", next: "input" },
      { id: "role", lane: lanes?.[1], type: "decision", text: "Role admin?", yes: "admin", no: "user" },
      { id: "user", lane: lanes?.[1], type: actionType, text: "Buat sesi user", next: "dashUser" },
      { id: "dashUser", lane: lanes?.[1], type: actionType, text: "Tampilkan dashboard user", next: "end" },
      { id: "admin", lane: lanes?.[1], type: actionType, text: "Buat sesi admin", next: "dashAdmin" },
      { id: "dashAdmin", lane: lanes?.[1], type: actionType, text: "Tampilkan dashboard admin", next: "end" },
      { id: "end", lane: lanes?.[1], type: "end", text: "Selesai" },
    ] };
  }

  if (kind === "crud") {
    const label = object.replace(/\s+$/g, "") || "data";
    return { title: `Kelola ${label}`, lanes, steps: [
      { id: "start", lane: lanes?.[0], type: "start", text: "Mulai", next: "open" },
      { id: "open", lane: lanes?.[0], type: actionType, text: `Buka menu ${label}`, next: "list" },
      { id: "list", lane: lanes?.[1], type: actionType, text: `Tampilkan daftar ${label}`, next: "choose" },
      { id: "choose", lane: lanes?.[0], type: "decision", text: "Pilih aksi?", yes: "form", no: "deletePick" },
      { id: "form", lane: lanes?.[0], type: actionType, text: `Isi atau ubah data ${label}`, next: "validate" },
      { id: "deletePick", lane: lanes?.[0], type: actionType, text: `Pilih ${label} yang dihapus`, next: "confirm" },
      { id: "confirm", lane: lanes?.[0], type: actionType, text: "Konfirmasi penghapusan", next: "delete" },
      { id: "validate", lane: lanes?.[1], type: actionType, text: "Validasi data", next: "valid" },
      { id: "valid", lane: lanes?.[1], type: "decision", text: "Data valid?", yes: "save", no: "error" },
      { id: "error", lane: lanes?.[1], type: actionType, text: "Tampilkan pesan kesalahan", next: "form" },
      { id: "save", lane: lanes?.[1], type: actionType, text: `Simpan data ${label}`, next: "refresh" },
      { id: "delete", lane: lanes?.[1], type: actionType, text: `Hapus data ${label}`, next: "refresh" },
      { id: "refresh", lane: lanes?.[1], type: actionType, text: `Perbarui daftar ${label}`, next: "end" },
      { id: "end", lane: lanes?.[1], type: "end", text: "Selesai" },
    ] };
  }

  return { title: "Transaksi", lanes, steps: [
    { id: "start", lane: lanes?.[0], type: "start", text: "Mulai", next: "open" },
    { id: "open", lane: lanes?.[0], type: actionType, text: "Buka menu transaksi", next: "form" },
    { id: "form", lane: lanes?.[0], type: actionType, text: "Isi data transaksi dan pembayaran", next: "check" },
    { id: "check", lane: lanes?.[1], type: actionType, text: "Periksa ketersediaan data", next: "enough" },
    { id: "enough", lane: lanes?.[1], type: "decision", text: "Data valid dan stok cukup?", yes: "total", no: "fail" },
    { id: "fail", lane: lanes?.[1], type: actionType, text: "Tampilkan pesan gagal", next: "form" },
    { id: "total", lane: lanes?.[1], type: actionType, text: "Hitung total transaksi", next: "save" },
    { id: "save", lane: lanes?.[1], type: actionType, text: "Simpan transaksi", next: "update" },
    { id: "update", lane: lanes?.[1], type: actionType, text: "Perbarui stok atau status", next: "show" },
    { id: "show", lane: lanes?.[1], type: actionType, text: "Tampilkan hasil transaksi", next: "end" },
    { id: "end", lane: lanes?.[0], type: "end", text: "Selesai" },
  ] };
}

function localTemplate(prompt: string, diagramType: DiagramType): CompactSpec | null {
  const p = prompt.toLowerCase();
  if (diagramType === "sequence") {
    if (p.includes("login")) {
      return {
        title: "Sequence Diagram Login",
        participants: [
          { id: "user", name: "Pengguna" },
          { id: "ui", name: "Halaman Login" },
          { id: "auth", name: "Auth Service" },
          { id: "db", name: "Database" },
        ],
        messages: [
          { from: "user", to: "ui", text: "Isi username dan password" },
          { from: "ui", to: "auth", text: "Kirim kredensial" },
          { from: "auth", to: "db", text: "Cek data pengguna" },
          { from: "db", to: "auth", text: "Kirim hasil validasi", return: true },
          { from: "auth", to: "ui", text: "Buat sesi / pesan gagal", return: true },
          { from: "ui", to: "user", text: "Tampilkan dashboard atau error", return: true },
        ],
      };
    }
    if (p.includes("kelola") || p.includes("crud") || p.includes("tambah") || p.includes("hapus")) {
      const object = prompt.match(/kelola\s+([a-zA-Z0-9\s]+)/i)?.[1]?.trim() || "Data";
      return {
        title: `Sequence Diagram Kelola ${object}`,
        participants: [
          { id: "admin", name: "Admin" },
          { id: "ui", name: "Halaman Kelola" },
          { id: "controller", name: "Controller" },
          { id: "db", name: "Database" },
        ],
        messages: [
          { from: "admin", to: "ui", text: `Pilih menu ${object}` },
          { from: "ui", to: "controller", text: "Minta daftar data" },
          { from: "controller", to: "db", text: "Ambil data" },
          { from: "db", to: "controller", text: "Kirim data", return: true },
          { from: "controller", to: "ui", text: "Tampilkan daftar", return: true },
          { from: "admin", to: "ui", text: "Tambah/ubah/hapus data" },
          { from: "ui", to: "controller", text: "Validasi dan simpan perubahan" },
          { from: "controller", to: "db", text: "Simpan perubahan" },
          { from: "db", to: "controller", text: "Status berhasil/gagal", return: true },
          { from: "controller", to: "ui", text: "Tampilkan notifikasi", return: true },
        ],
      };
    }
    if (p.includes("transaksi") || p.includes("penjualan") || p.includes("pembayaran")) {
      return {
        title: "Sequence Diagram Transaksi",
        participants: [
          { id: "user", name: "Pengguna/Kasir" },
          { id: "ui", name: "Halaman Transaksi" },
          { id: "controller", name: "Controller" },
          { id: "db", name: "Database" },
        ],
        messages: [
          { from: "user", to: "ui", text: "Input data transaksi" },
          { from: "ui", to: "controller", text: "Kirim detail transaksi" },
          { from: "controller", to: "db", text: "Cek data dan stok" },
          { from: "db", to: "controller", text: "Kirim hasil pengecekan", return: true },
          { from: "controller", to: "db", text: "Simpan transaksi" },
          { from: "db", to: "controller", text: "Status penyimpanan", return: true },
          { from: "controller", to: "ui", text: "Kirim ringkasan transaksi", return: true },
          { from: "ui", to: "user", text: "Tampilkan struk/status", return: true },
        ],
      };
    }
  }
  if (diagramType === "usecase") {
    if (p.includes("login")) {
      return {
        title: "Use Case Login",
        actors: [{ id: "actor-user", name: "User/Admin", side: "left" }],
        usecases: [
          { id: "uc-open", text: "Membuka halaman login", actors: ["actor-user"] },
          { id: "uc-login", text: "Melakukan login", actors: ["actor-user"] },
          { id: "uc-dashboard", text: "Mengakses dashboard", actors: ["actor-user"] },
        ],
      };
    }
    if (p.includes("kelola") || p.includes("crud") || p.includes("tambah") || p.includes("hapus")) {
      const object = prompt.match(/kelola\s+([a-zA-Z0-9\s]+)/i)?.[1]?.trim() || "Data";
      return {
        title: `Use Case Kelola ${object}`,
        actors: [{ id: "actor-admin", name: "Admin", side: "left" }],
        usecases: [
          { id: "uc-list", text: `Melihat daftar ${object}`, actors: ["actor-admin"] },
          { id: "uc-add", text: `Menambah ${object}`, actors: ["actor-admin"] },
          { id: "uc-edit", text: `Mengubah ${object}`, actors: ["actor-admin"] },
          { id: "uc-delete", text: `Menghapus ${object}`, actors: ["actor-admin"] },
        ],
      };
    }
    if (p.includes("transaksi") || p.includes("penjualan") || p.includes("pembayaran")) {
      return {
        title: "Use Case Transaksi",
        actors: [{ id: "actor-user", name: "Pengguna/Kasir", side: "left" }],
        usecases: [
          { id: "uc-input", text: "Mengisi data transaksi", actors: ["actor-user"] },
          { id: "uc-pay", text: "Memproses pembayaran", actors: ["actor-user"] },
          { id: "uc-result", text: "Melihat hasil transaksi", actors: ["actor-user"] },
        ],
      };
    }
  }
  if (diagramType !== "sequence" && p.includes("login")) return buildFlowSpec("login", diagramType, prompt);
  if (diagramType !== "sequence" && (p.includes("kelola") || p.includes("crud") || p.includes("tambah") || p.includes("hapus"))) return buildFlowSpec("crud", diagramType, prompt);
  if (diagramType !== "sequence" && (p.includes("transaksi") || p.includes("penjualan") || p.includes("pembayaran"))) return buildFlowSpec("transaction", diagramType, prompt);
  return null;
}

function normalizeSpec(spec: CompactSpec, diagramType: DiagramType, prompt: string, reportContext: any): CompactSpec {
  const fallback = buildGenericSpec(prompt, diagramType, reportContext);
  const normalized: CompactSpec = { ...spec };

  normalized.title = cleanText(normalized.title || fallback.title || prompt, fallback.title || "Diagram", 80);

  if (diagramType === "usecase") {
    if (!Array.isArray(normalized.actors) || !normalized.actors.length) normalized.actors = fallback.actors;
    if (!Array.isArray(normalized.usecases) || !normalized.usecases.length) normalized.usecases = fallback.usecases;

    const actors = (normalized.actors || []).slice(0, 6).map((actor, index) => ({
      id: cleanId(actor.id || actor.name, `actor-${index + 1}`),
      name: cleanText(actor.name, `Aktor ${index + 1}`, 34),
      side: actor.side === "right" ? "right" as const : "left" as const,
    }));
    const actorIds = new Set(actors.map((actor) => actor.id));
    const usecases = (normalized.usecases || []).slice(0, 10).map((usecase, index) => {
      const connectedActors = (usecase.actors || []).map((actorId) => cleanId(actorId, "")).filter((actorId) => actorIds.has(actorId));
      return {
        id: cleanId(usecase.id || usecase.text, `uc-${index + 1}`),
        text: cleanText(usecase.text, `Use Case ${index + 1}`, 64),
        actors: connectedActors.length ? connectedActors : [actors[0].id],
      };
    });
    return { ...normalized, actors, usecases };
  }

  if (diagramType === "sequence") {
    if (!Array.isArray(normalized.participants) || normalized.participants.length < 2) normalized.participants = fallback.participants;
    if (!Array.isArray(normalized.messages) || normalized.messages.length < 3) normalized.messages = fallback.messages;

    const participants = (normalized.participants || []).slice(0, 6).map((participant, index) => ({
      id: cleanId(participant.id || participant.name, `p${index + 1}`),
      name: cleanText(participant.name, `Partisipan ${index + 1}`, 36),
    }));
    const participantIds = new Set(participants.map((participant) => participant.id));
    const messages = (normalized.messages || []).slice(0, 12).map((message) => ({
      from: cleanId(message.from, participants[0].id),
      to: cleanId(message.to, participants[Math.min(1, participants.length - 1)].id),
      text: cleanText(message.text, "Kirim pesan", 52),
      return: Boolean(message.return),
    })).filter((message) => participantIds.has(message.from) && participantIds.has(message.to) && message.from !== message.to);

    return { ...normalized, participants, messages: messages.length >= 3 ? messages : fallback.messages };
  }

  if (!Array.isArray(normalized.steps) || normalized.steps.length < 4) normalized.steps = fallback.steps;
  const fallbackLanes = diagramType === "activity" ? fallback.lanes : undefined;
  normalized.lanes = Array.isArray(normalized.lanes) && normalized.lanes.length ? normalized.lanes.slice(0, 5).map((lane) => cleanText(lane, "Lane", 28)) : fallbackLanes;

  return normalized;
}

function specToDiagram(spec: CompactSpec, diagramType: DiagramType) {
  if (diagramType === "sequence") {
    const rawParticipants = spec.participants?.length ? spec.participants : [
      { id: "actor", name: "Aktor" },
      { id: "system", name: "Sistem" },
    ];
    const participants = rawParticipants.slice(0, 6).map((participant, index) => ({
      id: cleanId(participant.id, `p${index + 1}`),
      name: cleanText(participant.name, `Partisipan ${index + 1}`, 36),
    }));
    const participantIds = new Set(participants.map((p) => p.id));
    const messages = (spec.messages || [])
      .map((message) => ({
        from: cleanId(message.from, participants[0].id),
        to: cleanId(message.to, participants[Math.min(1, participants.length - 1)].id),
        text: cleanText(message.text, "Kirim pesan", 52),
        return: Boolean(message.return),
      }))
      .filter((message) => participantIds.has(message.from) && participantIds.has(message.to) && message.from !== message.to)
      .slice(0, 12);
    const safeMessages = messages.length ? messages : [{ from: participants[0].id, to: participants[1]?.id || participants[0].id, text: "Memulai proses", return: false }];
    const width = Math.max(150, Math.min(210, 900 / Math.max(participants.length, 1)));
    const gap = Math.max(190, Math.floor(980 / Math.max(participants.length, 1)));
    const height = 140 + safeMessages.length * 72;
    const nodes = participants.map((participant, index) => ({
      id: participant.id,
      type: "lifeline",
      text: participant.name,
      lines: wrapText(participant.name, 18),
      x: 110 + index * gap,
      y: 70,
      width,
      height,
      pinned: true,
    }));
    const edges = safeMessages.map((message, index) => ({
      id: `msg-${index + 1}-${message.from}-${message.to}`,
      fromId: message.from,
      toId: message.to,
      label: `${index + 1}. ${message.text}`,
      dashed: message.return,
      y: 150 + index * 72,
    }));
    return { nodes, edges, lanes: [], title: spec.title || "Sequence Diagram" };
  }

  if (diagramType === "usecase") {
    const actors = (spec.actors?.length ? spec.actors : [{ id: "actor-1", name: "Pengguna", side: "left" as const }]).slice(0, 6).map((actor, index) => ({
      id: cleanId(actor.id, `actor-${index + 1}`),
      name: cleanText(actor.name, `Aktor ${index + 1}`, 34),
      side: actor.side === "right" ? "right" as const : "left" as const,
    }));
    const actorIds = new Set(actors.map((actor) => actor.id));
    const usecases = (spec.usecases?.length ? spec.usecases : [{ id: "uc-1", text: spec.title || "Menggunakan Sistem", actors: [actors[0].id] }]).slice(0, 10).map((usecase, index) => {
      const connectedActors = (usecase.actors || []).map((actorId) => cleanId(actorId, "")).filter((actorId) => actorIds.has(actorId));
      return {
        id: cleanId(usecase.id, `uc-${index + 1}`),
        text: cleanText(usecase.text, `Use Case ${index + 1}`, 64),
        actors: connectedActors.length ? connectedActors : [actors[0].id],
      };
    });
    const nodes = [
      ...actors.map((a, i) => ({ id: a.id, type: "actor", text: a.name, lines: wrapText(a.name, 14), x: a.side === "right" ? 850 : 150, y: 160 + i * 140, width: 60, height: 80, side: a.side || "left", pinned: true })),
      ...usecases.map((u, i) => ({ id: u.id, type: "usecase", text: u.text, lines: wrapText(u.text, 18), x: 430, y: 140 + i * 120, width: 190, height: 76, pinned: true })),
    ];
    const edges = usecases.flatMap((u) => u.actors.map((actorId) => ({ id: `edge-${actorId}-${u.id}`, fromId: actorId, toId: u.id, dashed: false })));
    return { nodes, edges, lanes: [], title: spec.title || "Use Case Diagram" };
  }

  const steps: CompactStep[] = spec.steps?.length ? spec.steps : [
    { id: "start", type: "start", text: "Mulai", next: "process" },
    { id: "process", type: diagramType === "activity" ? "activity" : "process", text: spec.title || "Jalankan proses utama", next: "end" },
    { id: "end", type: "end", text: "Selesai" },
  ];
  const lanes = spec.lanes?.length ? spec.lanes.slice(0, 5) : [];
  const normalizedSteps: CompactStep[] = steps.slice(0, 16).map((step, index) => ({
    ...step,
    id: cleanId(step.id, `s${index + 1}`),
    type: (["start", "end", "process", "activity", "decision"].includes(step.type) ? step.type : (diagramType === "activity" ? "activity" : "process")) as StepType,
    text: cleanText(step.text, index === 0 ? "Mulai" : "Proses", 80),
    lane: step.lane && lanes.includes(step.lane) ? step.lane : lanes[0],
    next: step.next ? cleanId(step.next, "") : undefined,
    yes: step.yes ? cleanId(step.yes, "") : undefined,
    no: step.no ? cleanId(step.no, "") : undefined,
  }));
  if (normalizedSteps.length && normalizedSteps[0].type !== "start") normalizedSteps.unshift({ id: "start", type: "start", text: "Mulai", lane: lanes[0], next: normalizedSteps[0].id });
  if (normalizedSteps.length && !normalizedSteps.some((step) => step.type === "end")) normalizedSteps.push({ id: "end", type: "end", text: "Selesai", lane: lanes[lanes.length - 1] || lanes[0] });
  const validStepIds = new Set(normalizedSteps.map((step) => step.id));
  for (let index = 0; index < normalizedSteps.length; index += 1) {
    const step = normalizedSteps[index];
    const nextStep = normalizedSteps[index + 1];
    if (step.type === "end") continue;
    if (step.type === "decision") {
      if (!step.yes || !validStepIds.has(step.yes)) step.yes = nextStep?.id;
      if (!step.no || !validStepIds.has(step.no)) step.no = normalizedSteps[Math.min(index + 2, normalizedSteps.length - 1)]?.id || step.yes;
      step.next = undefined;
    } else if (!step.next || !validStepIds.has(step.next)) {
      step.next = nextStep?.id;
    }
  }
  const laneX = (lane?: string) => {
    if (!lanes.length) return 500;
    const idx = Math.max(0, lanes.indexOf(lane || lanes[0]));
    return 230 + idx * 420;
  };
  const layerById = new Map<string, number>();
  normalizedSteps.forEach((step, index) => layerById.set(step.id, index));
  for (let pass = 0; pass < normalizedSteps.length; pass += 1) {
    for (const step of normalizedSteps) {
      const current = layerById.get(step.id) || 0;
      for (const targetId of [step.next, step.yes, step.no].filter(Boolean) as string[]) {
        if (!validStepIds.has(targetId)) continue;
        const targetLayer = layerById.get(targetId) || 0;
        if (targetLayer <= current && targetId !== step.id) layerById.set(targetId, current + 1);
      }
    }
  }
  const laneOffsets = new Map<string, number>();

  const nodes = normalizedSteps.map((step, index) => {
    const type = diagramType === "activity" && step.type === "process" ? "activity" : step.type;
    const size = nodeSize(type, step.text);
    const lane = step.lane || "main";
    const layer = Math.min(layerById.get(step.id) ?? index, normalizedSteps.length + 2);
    const sameLayerKey = `${lane}-${layer}`;
    const offset = laneOffsets.get(sameLayerKey) || 0;
    laneOffsets.set(sameLayerKey, offset + 1);
    const y = 100 + layer * 145 + offset * 48;
    return {
      id: step.id,
      type,
      text: step.text,
      lines: wrapText(step.text, type === "decision" ? 16 : 20),
      x: laneX(step.lane) - size.width / 2,
      y,
      width: size.width,
      height: size.height,
      lane: step.lane,
      yes: step.yes,
      no: step.no,
      pinned: lanes.length > 0,
    };
  });

  const edges = normalizedSteps.flatMap((step) => {
    const out: { id: string; fromId: string; toId: string; label?: string; direction?: "right" | "left"; dashed: boolean }[] = [];
    if (step.next && validStepIds.has(step.next)) out.push({ id: `edge-${step.id}-${step.next}`, fromId: step.id, toId: step.next, dashed: false });
    if (step.yes && validStepIds.has(step.yes)) out.push({ id: `edge-${step.id}-${step.yes}`, fromId: step.id, toId: step.yes, label: "Ya", direction: "right", dashed: false });
    if (step.no && validStepIds.has(step.no)) out.push({ id: `edge-${step.id}-${step.no}`, fromId: step.id, toId: step.no, label: "Tidak", direction: "left", dashed: false });
    return out;
  });

  return { nodes, edges, lanes, title: spec.title || "Diagram" };
}

function hasEnoughPromptDetail(prompt: string, reportContext: any) {
  const combined = inferDomainPrompt(prompt, reportContext);
  const words = combined.split(/\s+/).filter(Boolean);
  return words.length >= 5 || /login|register|kelola|crud|transaksi|pembayaran|laporan|pengaduan|mahasiswa|admin|sistem|database|dashboard/i.test(combined);
}

function extractJson(text: string) {
  let json = text.trim();
  if (json.startsWith("```json")) json = json.slice(7);
  if (json.startsWith("```")) json = json.slice(3);
  if (json.endsWith("```")) json = json.slice(0, -3);
  const firstBrace = json.indexOf("{");
  const lastBrace = json.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) json = json.slice(firstBrace, lastBrace + 1);
  return JSON.parse(json.trim()) as CompactSpec;
}

export async function POST(req: Request) {
  try {
    const { prompt, diagramType = "flowchart", existingSummary = null, reportContext = null } = await req.json();

    if (!prompt?.trim()) {
      return NextResponse.json({ success: false, error: "Prompt tidak boleh kosong" }, { status: 400 });
    }

    const normalizedType = allowedTypes.has(diagramType) ? diagramType as DiagramType : "flowchart";
    const template = localTemplate(prompt, normalizedType);
    if (template) {
      return NextResponse.json({ success: true, source: "template", data: specToDiagram(template, normalizedType), spec: template });
    }

    assertAiConfigured();

    const systemPrompt = `Buat spec diagram UML ringkas, bukan koordinat. JSON saja.
Tipe: ${normalizedType}. Bahasa: Indonesia.
Jika prompt kabur, balas {"needsClarification":true,"clarification":"pertanyaan singkat"}.
Schema flowchart/activity: {"needsClarification":false,"title":"...","lanes":["Pengguna","Sistem"],"steps":[{"id":"s1","lane":"Pengguna","type":"start","text":"Mulai","next":"s2"},{"id":"s2","lane":"Pengguna","type":"activity|process|decision|end","text":"...","next":"s3","yes":"s4","no":"s5"}]}.
Schema usecase: {"needsClarification":false,"title":"...","actors":[{"id":"a1","name":"Admin","side":"left"}],"usecases":[{"id":"u1","text":"Kelola data","actors":["a1"]}]}.
Schema sequence: {"needsClarification":false,"title":"...","participants":[{"id":"user","name":"Pengguna"},{"id":"system","name":"Sistem"}],"messages":[{"from":"user","to":"system","text":"Kirim permintaan"},{"from":"system","to":"user","text":"Kirim respons","return":true}]}.
Aturan ketat:
- Gunakan id pendek huruf/angka/dash saja, semua relasi harus mengarah ke id yang ada.
- Flowchart/activity wajib punya start dan end, 6-14 langkah, decision wajib yes dan no.
- Activity pakai lane minimal Aktor dan Sistem bila proses sistem.
- Use case gunakan aktor nyata dan use case berbentuk kata kerja.
- Sequence gunakan 2-6 participant dan 4-12 message berurutan, return hanya untuk respons/balikan.
- Label singkat, spesifik sesuai prompt/konteks, jangan isi x/y/width/height/lines.`;

    const userPrompt = JSON.stringify({ prompt, existingSummary, reportContext }, null, 0);
    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1800,
    });

    const spec = extractJson(response.choices[0].message.content || "{}");
    if (spec.needsClarification && !hasEnoughPromptDetail(prompt, reportContext)) {
      return NextResponse.json({ success: false, needsClarification: true, clarification: spec.clarification || "Bisa jelaskan aktor dan alur utamanya dulu?" });
    }

    const normalizedSpec = normalizeSpec(spec.needsClarification ? buildGenericSpec(prompt, normalizedType, reportContext) : spec, normalizedType, prompt, reportContext);
    const validation = validateSpec(normalizedSpec, normalizedType);
    if (!validation.ok) {
      return NextResponse.json({
        success: false,
        needsClarification: true,
        clarification: validation.errors.join(' '),
        validation,
      });
    }
    return NextResponse.json({ success: true, source: spec.needsClarification ? "fallback-generic" : "ai-spec", data: specToDiagram(normalizedSpec, normalizedType), spec: normalizedSpec, validation });
  } catch (error: any) {
    console.error("API /api/ai/generate-uml Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal menghasilkan diagram, coba lagi dengan prompt berbeda." },
      { status: 500 }
    );
  }
}



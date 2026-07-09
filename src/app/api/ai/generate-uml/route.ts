import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";

export const maxDuration = 45;

type DiagramType = "flowchart" | "usecase" | "activity";
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
}

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
  if (type === "decision") return { width: 170, height: 110 };
  const lines = wrapText(text, 20);
  return { width: Math.max(150, Math.min(250, Math.max(...lines.map((l) => l.length), 1) * 9 + 44)), height: Math.max(64, lines.length * 22 + 36) };
};

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
  if (p.includes("login")) return buildFlowSpec("login", diagramType, prompt);
  if (p.includes("kelola") || p.includes("crud") || p.includes("tambah") || p.includes("hapus")) return buildFlowSpec("crud", diagramType, prompt);
  if (p.includes("transaksi") || p.includes("penjualan") || p.includes("pembayaran")) return buildFlowSpec("transaction", diagramType, prompt);
  return null;
}

function specToDiagram(spec: CompactSpec, diagramType: DiagramType) {
  if (diagramType === "usecase") {
    const actors = spec.actors?.length ? spec.actors : [{ id: "actor-1", name: "Pengguna", side: "left" as const }];
    const usecases = spec.usecases?.length ? spec.usecases : [{ id: "uc-1", text: spec.title || "Menggunakan Sistem", actors: [actors[0].id] }];
    const nodes = [
      ...actors.map((a, i) => ({ id: a.id, type: "actor", text: a.name, lines: wrapText(a.name, 14), x: a.side === "right" ? 850 : 150, y: 160 + i * 140, width: 60, height: 80, side: a.side || "left", pinned: true })),
      ...usecases.map((u, i) => ({ id: u.id, type: "usecase", text: u.text, lines: wrapText(u.text, 18), x: 430, y: 140 + i * 120, width: 190, height: 76, pinned: true })),
    ];
    const edges = usecases.flatMap((u) => u.actors.map((actorId) => ({ id: `edge-${actorId}-${u.id}`, fromId: actorId, toId: u.id, dashed: false })));
    return { nodes, edges };
  }

  const steps = spec.steps || [];
  const lanes = spec.lanes?.length ? spec.lanes : [];
  const laneX = (lane?: string) => {
    if (!lanes.length) return 500;
    const idx = Math.max(0, lanes.indexOf(lane || lanes[0]));
    return 230 + idx * 420;
  };
  const yByLane = new Map<string, number>();

  const nodes = steps.map((step, index) => {
    const type = diagramType === "activity" && step.type === "process" ? "activity" : step.type;
    const size = nodeSize(type, step.text);
    const lane = step.lane || "main";
    const laneCount = yByLane.get(lane) || 0;
    yByLane.set(lane, laneCount + 1);
    const y = lanes.length ? 110 + laneCount * 135 : 100 + index * 140;
    return {
      id: step.id,
      type,
      text: step.text,
      lines: wrapText(step.text, type === "decision" ? 16 : 20),
      x: laneX(step.lane) - size.width / 2,
      y,
      width: size.width,
      height: size.height,
      yes: step.yes,
      no: step.no,
      pinned: lanes.length > 0,
    };
  });

  const edges = steps.flatMap((step) => {
    const out = [];
    if (step.next) out.push({ id: `edge-${step.id}-${step.next}`, fromId: step.id, toId: step.next, dashed: false });
    if (step.yes) out.push({ id: `edge-${step.id}-${step.yes}`, fromId: step.id, toId: step.yes, label: "Ya", direction: "right", dashed: false });
    if (step.no) out.push({ id: `edge-${step.id}-${step.no}`, fromId: step.id, toId: step.no, label: "Tidak", direction: "left", dashed: false });
    return out;
  });

  return { nodes, edges };
}

function extractJson(text: string) {
  let json = text.trim();
  if (json.startsWith("```json")) json = json.slice(7);
  if (json.startsWith("```")) json = json.slice(3);
  if (json.endsWith("```")) json = json.slice(0, -3);
  return JSON.parse(json.trim()) as CompactSpec;
}

export async function POST(req: Request) {
  try {
    const { prompt, diagramType = "flowchart", existingSummary = null } = await req.json();

    if (!prompt?.trim()) {
      return NextResponse.json({ success: false, error: "Prompt tidak boleh kosong" }, { status: 400 });
    }

    const normalizedType = diagramType as DiagramType;
    const template = localTemplate(prompt, normalizedType);
    if (template) {
      return NextResponse.json({ success: true, source: "template", data: specToDiagram(template, normalizedType), spec: template });
    }

    assertAiConfigured();

    const systemPrompt = `Buat spec diagram UML ringkas, bukan koordinat. JSON saja.
Tipe: ${normalizedType}. Bahasa: Indonesia.
Jika prompt kabur, balas {"needsClarification":true,"clarification":"pertanyaan singkat"}.
Untuk flowchart/activity balas {"needsClarification":false,"title":"...","lanes":["Pengguna","Sistem"],"steps":[{"id":"s1","lane":"Pengguna","type":"start","text":"Mulai","next":"s2"},{"id":"s2","lane":"Pengguna","type":"activity|process|decision|end","text":"...","next":"s3","yes":"s4","no":"s5"}]}.
Untuk usecase balas {"needsClarification":false,"title":"...","actors":[{"id":"a1","name":"Admin","side":"left"}],"usecases":[{"id":"u1","text":"Kelola data","actors":["a1"]}]}.
Aturan: 6-14 langkah untuk proses nyata, decision wajib punya yes dan no, label singkat, alur jelas, jangan isi x/y/width/height/lines.`;

    const userPrompt = JSON.stringify({ prompt, existingSummary }, null, 0);
    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1300,
    });

    const spec = extractJson(response.choices[0].message.content || "{}");
    if (spec.needsClarification) {
      return NextResponse.json({ success: false, needsClarification: true, clarification: spec.clarification || "Bisa jelaskan aktor dan alur utamanya dulu?" });
    }

    return NextResponse.json({ success: true, source: "ai-spec", data: specToDiagram(spec, normalizedType), spec });
  } catch (error: any) {
    console.error("API /api/ai/generate-uml Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal menghasilkan diagram, coba lagi dengan prompt berbeda." },
      { status: 500 }
    );
  }
}

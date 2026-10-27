import type { DiagramEdge, DiagramNode, FragmentKind, MessageKind, ParticipantKind } from "../types/diagram";
import { lifelineWidth } from "./node-size";
import { wrapLabel } from "./text-fit";
import {
  ACTIVATION_MIN_HEIGHT, ACTIVATION_NEST, ACTIVATION_WIDTH,
  FRAGMENT_BOTTOM, FRAGMENT_FONT, FRAGMENT_GUARD_ROW, FRAGMENT_HEADER, FRAGMENT_PAD,
  LIFELINE_HEADER_HEIGHT, NOTE_FONT, NOTE_GAP, NOTE_MAX_TEXT_WIDTH, NOTE_PAD_Y,
  SEQ_FIRST_MESSAGE_OFFSET, SEQ_ROW_GAP, SEQ_SELF_LOOP_H, SEQ_START_X,
  SEQ_TAIL, SEQ_TOP_Y, sequenceGap,
} from "./theme";

export interface SequenceSpec {
  participants?: { id: string; name: string; kind?: ParticipantKind }[];
  messages?: { from: string; to: string; text: string; return?: boolean; kind?: MessageKind }[];
  /** Rentang nomor pesan inklusif, dimulai dari 1. */
  activations?: { participant: string; from: number; to: number; depth?: number }[];
  fragments?: { kind: FragmentKind; from: number; to: number; participants?: string[]; operands: { from: number; guard: string }[] }[];
  /** after=0 sebelum pesan pertama; selain itu nomor pesan sebelumnya. */
  notes?: { kind: "note" | "ref"; text: string; after: number; participants: string[] }[];
}

export const PARTICIPANT_KINDS = ["participant", "actor", "boundary", "control", "entity", "database"] as const;
export const MESSAGE_KINDS = ["sync", "async", "return", "create", "destroy"] as const;
export const FRAGMENT_KINDS = ["alt", "opt", "loop", "par", "break", "critical"] as const;
export const isSequenceNode = (node: { type: string }) => ["lifeline", "activation", "fragment", "note", "ref"].includes(node.type);
export const messageKind = (message: { kind?: MessageKind; return?: boolean; dashed?: boolean }): MessageKind =>
  message.kind ?? (message.return || message.dashed ? "return" : "sync");
export const sequenceHeaderHeight = (kind?: ParticipantKind) => kind && kind !== "participant" ? 80 : LIFELINE_HEADER_HEIGHT;

export function sequenceSpecErrors(spec: SequenceSpec): string[] {
  const errors: string[] = [];
  const participants = spec.participants ?? [];
  const messages = spec.messages ?? [];
  const ids = new Set(participants.map((p) => p.id));
  if (ids.size !== participants.length || participants.some((p) => !p.id.trim() || !p.name.trim())) errors.push("ID/nama participant kosong atau duplikat.");
  if (participants.length > 6 || messages.length > 12) errors.push("Sequence maksimal enam participant dan dua belas pesan.");
  const range = (from: number, to: number) => Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && to <= messages.length;
  const created = new Set<string>();
  const destroyed = new Set<string>();
  const needsCreation = new Set(messages.filter((m) => messageKind(m) === "create").map((m) => m.to));
  messages.forEach((m, i) => {
    const kind = messageKind(m);
    if (!ids.has(m.from) || !ids.has(m.to) || !m.text.trim()) errors.push(`Pesan ${i + 1} memiliki participant atau label tidak valid.`);
    if (m.from === m.to && kind !== "sync" && kind !== "async") errors.push(`Pesan ${i + 1}: self-message hanya boleh sync/async.`);
    if (destroyed.has(m.from) || destroyed.has(m.to)) errors.push(`Pesan ${i + 1} memakai participant yang sudah dihancurkan.`);
    if (needsCreation.has(m.from) && !created.has(m.from)) errors.push(`Pesan ${i + 1} berasal dari participant sebelum create.`);
    if (kind === "create") {
      if (created.has(m.to)) errors.push(`Participant ${m.to} dibuat lebih dari satu kali.`);
      created.add(m.to);
    } else if (needsCreation.has(m.to) && !created.has(m.to)) errors.push(`Pesan ${i + 1} menuju participant sebelum create.`);
    if (kind === "destroy") destroyed.add(m.to);
  });
  if ((spec.activations?.length ?? 0) > 24 || (spec.fragments?.length ?? 0) > 6 || (spec.notes?.length ?? 0) > 8) errors.push("Terlalu banyak elemen pendukung sequence.");
  for (const a of spec.activations ?? []) {
    if (!ids.has(a.participant) || !range(a.from, a.to) || !Number.isInteger(a.depth ?? 0) || (a.depth ?? 0) < 0 || (a.depth ?? 0) > 5) errors.push("Activation memiliki participant, rentang pesan, atau depth tidak valid.");
    const createAt = messages.findIndex((m) => m.to === a.participant && messageKind(m) === "create");
    const destroyAt = messages.findIndex((m) => m.to === a.participant && messageKind(m) === "destroy");
    if (createAt >= 0 && a.from <= createAt + 1) errors.push("Activation harus dimulai setelah kepala participant create.");
    if (destroyAt >= 0 && a.to > destroyAt + 1) errors.push("Activation tidak boleh melewati destroy.");
  }
  const fragments = spec.fragments ?? [];
  fragments.forEach((f, i) => {
    if (!FRAGMENT_KINDS.includes(f.kind) || !range(f.from, f.to)) errors.push(`Fragment ${i + 1} memiliki jenis atau rentang tidak valid.`);
    if (f.participants?.some((id) => !ids.has(id))) errors.push(`Fragment ${i + 1} mengacu ke participant yang tidak ada.`);
    if (!f.operands.length || f.operands[0].from !== f.from || f.operands.some((o, j) => !Number.isInteger(o.from) || o.from < f.from || o.from > f.to || (j > 0 && o.from <= f.operands[j - 1].from))) errors.push(`Operand fragment ${i + 1} harus berurutan dan mulai di pesan pertama fragment.`);
    if (f.kind === "alt" && f.operands.length < 2) errors.push("Fragment alt memerlukan minimal dua operand.");
    fragments.slice(i + 1).forEach((g) => {
      if ((f.from < g.from && g.from <= f.to && f.to < g.to) || (g.from < f.from && f.from <= g.to && g.to < f.to) || (f.from === g.from && f.to === g.to)) errors.push("Rentang fragment harus terpisah atau bersarang, bukan saling memotong/identik.");
    });
  });
  for (const n of spec.notes ?? []) {
    if (!Number.isInteger(n.after) || n.after < 0 || n.after > messages.length || !n.participants.length || n.participants.some((id) => !ids.has(id)) || !n.text.trim()) errors.push("Note/ref memiliki nomor pesan, participant, atau teks tidak valid.");
  }
  return errors;
}

/** Semua koordinat vertikal berasal dari urutan pesan, bukan koordinat buatan model. */
export function sequenceToDiagram(spec: SequenceSpec): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const participants = (spec.participants ?? []).slice(0, 6);
  const messages = (spec.messages ?? []).slice(0, 12);
  const fragments = spec.fragments ?? [];
  const notes = spec.notes ?? [];
  const gap = sequenceGap(participants.length);
  const nodes: DiagramNode[] = [];
  const ys: number[] = [];
  const frameStarts = new Map<number, number>();
  const operandYs = new Map<string, number>();
  const guardHeight = (f: NonNullable<SequenceSpec["fragments"]>[number], guard: string) => {
    const positions = (f.participants?.length ? f.participants : participants.map((p) => p.id)).map((id) => participants.findIndex((p) => p.id === id)).filter((i) => i >= 0);
    const depth = fragments.filter((g) => g !== f && g.from <= f.from && g.to >= f.to).length;
    const span = positions.length ? Math.max(...positions) - Math.min(...positions) : 0;
    const width = Math.max(150, span * gap + 2 * Math.max(16, FRAGMENT_PAD - depth * 10));
    return wrapLabel(`[${guard}]`, width - 20, FRAGMENT_FONT).length * 17;
  };
  let cursor = SEQ_TOP_Y + Math.max(LIFELINE_HEADER_HEIGHT, ...participants.map((p) => sequenceHeaderHeight(p.kind))) + SEQ_FIRST_MESSAGE_OFFSET;
  const addNotes = (after: number) => {
    notes.forEach((n, i) => {
      if (n.after !== after) return;
      const lines = wrapLabel(n.text, NOTE_MAX_TEXT_WIDTH, NOTE_FONT);
      const height = Math.max(48, lines.length * NOTE_FONT * 1.2 + NOTE_PAD_Y * 2 + (n.kind === "ref" ? 22 : 0));
    let id = `seq-note-${i + 1}`;
    while (participants.some((p) => p.id === id)) id = `_${id}`;
    nodes.push({ id, type: n.kind, text: n.text, lines, x: 0, y: cursor - 30, width: NOTE_MAX_TEXT_WIDTH + 20, height, attachTo: n.participants, pinned: true });
      cursor += height + NOTE_GAP + 12;
    });
  };
  addNotes(0);
  messages.forEach((m, i) => {
    const index = i + 1;
    fragments.forEach((f, j) => f.operands.slice(1).forEach((o, k) => {
      if (o.from !== index) return;
      operandYs.set(`${j}:${k + 1}`, cursor - 32);
      cursor += Math.max(FRAGMENT_GUARD_ROW + 16, guardHeight(f, o.guard) + 16);
    }));
    // Frame luar dibuka lebih dulu agar tag/guard bersarang tidak bertumpuk.
    fragments.map((f, j) => ({ f, j })).filter(({ f }) => f.from === index).sort((a, b) => b.f.to - a.f.to).forEach(({ f, j }) => {
      frameStarts.set(j, cursor - 32);
      cursor += Math.max(FRAGMENT_HEADER + 16, 22 + guardHeight(f, f.operands[0]?.guard ?? "") + 8);
    });
    ys.push(cursor);
    cursor += (m.from === m.to ? SEQ_SELF_LOOP_H : 0);
    cursor += fragments.filter((f) => f.to === index).length * FRAGMENT_BOTTOM;
    const target = participants.find((p) => p.id === m.to);
    cursor += messageKind(m) === "create" ? Math.max(SEQ_ROW_GAP, sequenceHeaderHeight(target?.kind) / 2 + 52) : SEQ_ROW_GAP;
    addNotes(index);
  });
  const bottom = Math.max(cursor - SEQ_ROW_GAP + SEQ_TAIL, SEQ_TOP_Y + 160);
  participants.forEach((p) => {
    const createIndex = messages.findIndex((m) => m.to === p.id && messageKind(m) === "create");
    const destroyIndex = messages.findIndex((m) => m.to === p.id && messageKind(m) === "destroy");
    const header = sequenceHeaderHeight(p.kind);
    const y = createIndex < 0 ? SEQ_TOP_Y : ys[createIndex] - header / 2;
    const end = destroyIndex < 0 ? bottom : ys[destroyIndex];
    nodes.push({ id: p.id, type: "lifeline", text: p.name, lines: [p.name], x: 0, y, width: lifelineWidth(p.name, gap - 12), height: Math.max(header, end - y), participantKind: p.kind, created: createIndex >= 0, destroyed: destroyIndex >= 0, pinned: true });
  });
  (spec.activations ?? []).forEach((a, i) => {
    if (!ys[a.from - 1] || !ys[a.to - 1]) return;
    const last = messages[a.to - 1];
    const y = ys[a.from - 1] + (messages[a.from - 1].from === messages[a.from - 1].to ? SEQ_SELF_LOOP_H : 0);
    let id = `seq-activation-${i + 1}`;
    while (participants.some((p) => p.id === id)) id = `_${id}`;
    nodes.push({ id, type: "activation", text: "", lines: [], x: 0, y, width: ACTIVATION_WIDTH, height: Math.max(ACTIVATION_MIN_HEIGHT, ys[a.to - 1] + (last.from === last.to ? SEQ_SELF_LOOP_H : 0) - y), attachTo: [a.participant], depth: a.depth ?? 0, pinned: true });
  });
  fragments.forEach((f, i) => {
    const y = frameStarts.get(i);
    if (y === undefined || !ys[f.to - 1]) return;
    const depth = fragments.filter((g) => g !== f && g.from <= f.from && g.to >= f.to).length;
    const last = messages[f.to - 1];
    let id = `seq-fragment-${i + 1}`;
    while (participants.some((p) => p.id === id)) id = `_${id}`;
    nodes.push({ id, type: "fragment", text: f.kind, lines: [], x: 0, y, width: 200, height: ys[f.to - 1] + (last.from === last.to ? SEQ_SELF_LOOP_H : 0) + FRAGMENT_BOTTOM * (fragments.filter((g) => g.to === f.to && g.from >= f.from).length) - y, fragmentKind: f.kind, depth, attachTo: f.participants?.length ? f.participants : participants.map((p) => p.id), operands: f.operands.map((o, j) => ({ guard: o.guard, y: j === 0 ? y + 22 : operandYs.get(`${i}:${j}`) ?? y + 22 })), pinned: true });
  });
  const edges: DiagramEdge[] = messages.map((m, i) => ({ id: `msg-${i + 1}`, fromId: m.from, toId: m.to, label: `${i + 1}. ${m.text}`, kind: messageKind(m), dashed: ["return", "create"].includes(messageKind(m)), y: ys[i] }));
  return { nodes: layoutSequence(nodes), edges };
}

/** Rapikan horizontal saja; posisi lifecycle dan baris pesan dipertahankan. */
export function layoutSequence(nodes: DiagramNode[]): DiagramNode[] {
  const participants = nodes.filter((n) => n.type === "lifeline");
  const gap = Math.max(sequenceGap(participants.length), ...participants.map((n) => n.width + 12));
  const centers = new Map(participants.map((n, i) => [n.id, SEQ_START_X + gap / 2 + i * gap]));
  return nodes.map((n) => {
    if (n.type === "lifeline") return { ...n, x: (centers.get(n.id) ?? n.x) - n.width / 2, y: n.created ? n.y : SEQ_TOP_Y, offsetX: 0, offsetY: 0, pinned: true };
    const xs = (n.attachTo ?? []).flatMap((id) => centers.has(id) ? [centers.get(id)!] : []);
    if (!xs.length) return { ...n, offsetX: 0, offsetY: 0, pinned: true };
    const left = Math.min(...xs), right = Math.max(...xs);
    if (n.type === "activation") return { ...n, x: left - n.width / 2 + (n.depth ?? 0) * ACTIVATION_NEST, offsetX: 0, offsetY: 0, pinned: true };
    const pad = n.type === "fragment" ? Math.max(16, FRAGMENT_PAD - (n.depth ?? 0) * 10) : 26;
    const width = n.type === "fragment" ? Math.max(150, right - left + pad * 2) : Math.max(n.width, right - left + pad * 2);
    return { ...n, x: (left + right - width) / 2, width, offsetX: 0, offsetY: 0, pinned: true };
  });
}

/** Pulihkan rentang pesan dari geometri tersimpan sebelum edit struktur. */
export function diagramToSequenceSpec(nodes: DiagramNode[], edges: DiagramEdge[]): SequenceSpec {
  const messages = [...edges].filter((e) => typeof e.y === "number").sort((a, b) => a.y! - b.y!);
  const at = (y: number) => Math.min(messages.length, Math.max(1, messages.findIndex((m) => m.y! >= y - 1) + 1 || messages.length));
  const until = (y: number) => Math.max(1, messages.filter((m) => m.y! <= y + 1).length);
  return {
    participants: nodes.filter((n) => n.type === "lifeline").map((n) => ({ id: n.id, name: n.text, kind: n.participantKind })),
    messages: messages.map((e) => ({ from: e.fromId, to: e.toId, text: (e.label ?? "Pesan").replace(/^\d+\.\s*/, ""), kind: messageKind(e) })),
    activations: nodes.filter((n) => n.type === "activation").map((n) => ({ participant: n.attachTo?.[0] ?? "", from: until(n.y + (n.offsetY ?? 0)), to: until(n.y + (n.offsetY ?? 0) + n.height), depth: n.depth })),
    fragments: nodes.filter((n) => n.type === "fragment").map((n) => ({ kind: n.fragmentKind ?? "alt", from: at(n.y + (n.offsetY ?? 0)), to: until(n.y + (n.offsetY ?? 0) + n.height), participants: n.attachTo, operands: (n.operands ?? []).map((o) => ({ from: at(o.y + (n.offsetY ?? 0)), guard: o.guard })) })),
    notes: nodes.filter((n) => n.type === "note" || n.type === "ref").map((n) => ({ kind: n.type as "note" | "ref", text: n.text, after: messages.filter((e) => e.y! < n.y + (n.offsetY ?? 0)).length, participants: n.attachTo ?? [] })),
  };
}

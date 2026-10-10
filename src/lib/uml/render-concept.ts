/**
 * src/lib/uml/render-concept.ts
 * -----------------------------------------------------------------------------
 * Diagram non-UML untuk laporan (arsitektur sistem, peta konsep, ERD/kelas
 * sederhana, kerangka pemikiran) → SVG vektor deterministik.
 *
 * AI hanya menghasilkan SPEC terstruktur (kelompok + item + relasi); tata letak,
 * ukuran, dan panah dihitung di sini sehingga hasil rapi, konsisten, dan bisa
 * dirasterisasi ke PNG saat ekspor DOCX seperti diagram UML.
 *
 * Tata letak: kelompok disusun dalam grid (maks 3 kolom); tiap kelompok = kotak
 * berjudul dengan daftar item. Relasi digambar antar kelompok (ortogonal) dengan
 * label opsional. Jika ada `center`, kelompok disusun melingkar (hub-and-spoke).
 * -----------------------------------------------------------------------------
 */
import { aiClient, AI_MODEL, AI_MODEL_FAST, stripThinking } from "@/lib/ai/client";

export interface ConceptGroup { id: string; label: string; items: string[] }
export interface ConceptRelation { from: string; to: string; label?: string }
export interface ConceptSpec {
  title: string;
  /** Node pusat (opsional) → layout hub-and-spoke. */
  center?: string;
  groups: ConceptGroup[];
  relations: ConceptRelation[];
}

/** Tipe diagram yang dirender di sini (selain UML engine). */
export const CONCEPT_TYPES = new Set(["class", "erd", "arsitektur", "architecture", "concept", "konsep", "peta-konsep", "kerangka", "skema", "komponen", "struktur", "hierarki", "mindmap"]);

export function isConceptDiagramType(type: string) {
  const t = (type || "").toLowerCase().trim();
  if (CONCEPT_TYPES.has(t)) return true;
  return /konsep|arsitek|architect|kerangka|skema|struktur|komponen|hierar|entity|erd|class|mind/.test(t);
}

const FONT = "Inter, 'Segoe UI', Arial, sans-serif";
const BORDER = "#1e293b";
const STROKE = "#334155";
const GROUP_W = 250;
const ITEM_H = 22;
const HEAD_H = 34;
const GAP_X = 90;
const GAP_Y = 80;
const PAD = 40;

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const slug = (v: string, fallback: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || fallback;

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (`${line} ${w}`.trim().length <= max) line = `${line} ${w}`.trim();
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export function normalizeConceptSpec(raw: unknown, fallbackTitle: string): ConceptSpec {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const groupsRaw = Array.isArray(o.groups) ? o.groups : [];
  const groups: ConceptGroup[] = groupsRaw.slice(0, 9).map((g, i) => {
    const go = (typeof g === "object" && g !== null ? g : {}) as Record<string, unknown>;
    const label = clean(go.label ?? go.name ?? go.title, 48) || `Komponen ${i + 1}`;
    const items = (Array.isArray(go.items) ? go.items : []).map((it) => clean(it, 60)).filter(Boolean).slice(0, 7);
    return { id: clean(go.id, 40) || slug(label, `g${i + 1}`), label, items };
  });
  const ids = new Set(groups.map((g) => g.id));
  const byLabel = new Map(groups.map((g) => [g.label.toLowerCase(), g.id]));
  const resolve = (v: unknown) => {
    const s = clean(v, 60);
    if (ids.has(s)) return s;
    return byLabel.get(s.toLowerCase()) || "";
  };
  const relations: ConceptRelation[] = (Array.isArray(o.relations) ? o.relations : []).slice(0, 20).map((r) => {
    const ro = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    return { from: resolve(ro.from), to: resolve(ro.to), label: clean(ro.label, 36) || undefined };
  }).filter((r) => r.from && r.to && r.from !== r.to);
  return { title: clean(o.title, 90) || fallbackTitle, center: clean(o.center, 48) || undefined, groups, relations };
}

interface Box { id: string; x: number; y: number; w: number; h: number; label: string; items: string[] }

function groupHeight(g: ConceptGroup) {
  const lines = g.items.reduce((acc, it) => acc + wrap(it, 30).length, 0);
  return HEAD_H + Math.max(1, lines) * ITEM_H + 14;
}

function layoutGrid(groups: ConceptGroup[]): Box[] {
  const cols = groups.length <= 2 ? groups.length : groups.length <= 6 ? 3 : 3;
  const boxes: Box[] = [];
  const rows: ConceptGroup[][] = [];
  for (let i = 0; i < groups.length; i += cols) rows.push(groups.slice(i, i + cols));
  let y = PAD + 50;
  rows.forEach((row) => {
    const rowH = Math.max(...row.map(groupHeight));
    const totalW = row.length * GROUP_W + (row.length - 1) * GAP_X;
    const startX = PAD + Math.max(0, (cols * GROUP_W + (cols - 1) * GAP_X - totalW) / 2);
    row.forEach((g, i) => boxes.push({ id: g.id, x: startX + i * (GROUP_W + GAP_X), y, w: GROUP_W, h: groupHeight(g), label: g.label, items: g.items }));
    y += rowH + GAP_Y;
  });
  return boxes;
}

function layoutHub(center: string, groups: ConceptGroup[]): { boxes: Box[]; hub: Box } {
  const n = groups.length;
  const radius = Math.max(260, 120 + n * 42);
  const cx = PAD + radius + GROUP_W / 2 + 40;
  const cy = PAD + radius + 120;
  const hub: Box = { id: "__hub", x: cx - 110, y: cy - 36, w: 220, h: 72, label: center, items: [] };
  const boxes = groups.map((g, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const h = groupHeight(g);
    return { id: g.id, x: cx + Math.cos(angle) * (radius + 60) - GROUP_W / 2, y: cy + Math.sin(angle) * radius - h / 2, w: GROUP_W, h, label: g.label, items: g.items };
  });
  return { boxes, hub };
}

function renderBox(b: Box, isHub = false) {
  const head = isHub
    ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="#eef2ff" stroke="${BORDER}" stroke-width="2"/>`
    : `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="white" stroke="${BORDER}" stroke-width="1.5"/>` +
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${HEAD_H}" rx="6" fill="#f1f5f9" stroke="${BORDER}" stroke-width="1.5"/>` +
      `<line x1="${b.x}" y1="${b.y + HEAD_H}" x2="${b.x + b.w}" y2="${b.y + HEAD_H}" stroke="${BORDER}" stroke-width="1.5"/>`;
  const labelLines = wrap(b.label, isHub ? 22 : 28);
  const labelY = isHub ? b.y + b.h / 2 - ((labelLines.length - 1) * 18) / 2 : b.y + HEAD_H / 2;
  const label = `<text x="${b.x + b.w / 2}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" font-size="${isHub ? 15 : 13.5}" font-weight="700" fill="${BORDER}" font-family="${FONT}">${labelLines.map((l, i) => `<tspan x="${b.x + b.w / 2}" dy="${i === 0 ? 0 : 18}">${esc(l)}</tspan>`).join("")}</text>`;
  let y = b.y + HEAD_H + 8;
  const items = b.items.map((it) => {
    const lines = wrap(it, 30);
    const t = `<text x="${b.x + 14}" y="${y + ITEM_H / 2}" dominant-baseline="middle" font-size="12.5" fill="${STROKE}" font-family="${FONT}">${lines.map((l, i) => `<tspan x="${b.x + 14}" dy="${i === 0 ? 0 : ITEM_H}">${i === 0 ? "• " : "  "}${esc(l)}</tspan>`).join("")}</text>`;
    y += lines.length * ITEM_H;
    return t;
  }).join("");
  return `<g>${head}${label}${items}</g>`;
}

function anchor(a: Box, b: Box) {
  // Pilih sisi yang menghadap ke kotak lain (ortogonal sederhana).
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { x: a.x + a.w, y: acy } : { x: a.x, y: acy };
  return dy > 0 ? { x: acx, y: a.y + a.h } : { x: acx, y: a.y };
}

function renderRelation(a: Box, b: Box, label?: string) {
  const p = anchor(a, b);
  const q = anchor(b, a);
  const horizontalFirst = Math.abs(q.x - p.x) > Math.abs(q.y - p.y);
  const path = horizontalFirst
    ? `M ${p.x},${p.y} H ${(p.x + q.x) / 2} V ${q.y} H ${q.x}`
    : `M ${p.x},${p.y} V ${(p.y + q.y) / 2} H ${q.x} V ${q.y}`;
  const lx = (p.x + q.x) / 2, ly = (p.y + q.y) / 2;
  const lab = label
    ? `<g><rect x="${lx - (label.length * 6.5 + 14) / 2}" y="${ly - 10}" width="${label.length * 6.5 + 14}" height="20" rx="3" fill="white" stroke="#cbd5e1"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="600" fill="${STROKE}" font-family="${FONT}">${esc(label)}</text></g>`
    : "";
  return `<g><path d="${path}" fill="none" stroke="${STROKE}" stroke-width="2.2" marker-end="url(#c-arrow)"/>${lab}</g>`;
}

/** Render spec konsep → SVG string (lebar minimal 800). */
export function conceptToSvg(spec: ConceptSpec): string {
  const groups = spec.groups.length ? spec.groups : [{ id: "g1", label: spec.title, items: [] }];
  let boxes: Box[];
  let hub: Box | null = null;
  if (spec.center && groups.length >= 3) {
    const r = layoutHub(spec.center, groups);
    boxes = r.boxes; hub = r.hub;
  } else {
    boxes = layoutGrid(groups);
  }
  const all = hub ? [...boxes, hub] : boxes;
  const minX = Math.min(...all.map((b) => b.x)) - PAD;
  const minY = Math.min(...all.map((b) => b.y)) - PAD - 40;
  const maxX = Math.max(...all.map((b) => b.x + b.w)) + PAD;
  const maxY = Math.max(...all.map((b) => b.y + b.h)) + PAD;
  const vw = Math.max(800, Math.ceil(maxX - minX));
  const vh = Math.max(300, Math.ceil(maxY - minY));
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const rel = spec.relations.map((r) => {
    const a = byId.get(r.from), b = byId.get(r.to);
    return a && b ? renderRelation(a, b, r.label) : "";
  }).join("");
  const hubRel = hub ? boxes.map((b) => renderRelation(hub as Box, b)).join("") : "";
  const title = `<text x="${minX + vw / 2}" y="${minY + 30}" text-anchor="middle" font-size="16" font-weight="700" fill="${BORDER}" font-family="${FONT}">${esc(spec.title)}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${minX} ${minY} ${vw} ${vh}" font-family="${FONT}">` +
    `<defs><marker id="c-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${STROKE}"/></marker></defs>` +
    `<rect x="${minX}" y="${minY}" width="${vw}" height="${vh}" fill="white"/>` +
    title + hubRel + rel + boxes.map((b) => renderBox(b)).join("") + (hub ? renderBox(hub, true) : "") +
    `</svg>`
  );
}

/** Ringkasan teks untuk narasi bab. */
export function summarizeConcept(spec: ConceptSpec, max = 900) {
  const parts: string[] = [];
  if (spec.center) parts.push(`Pusat: ${spec.center}`);
  parts.push(`Komponen: ${spec.groups.map((g) => `${g.label}${g.items.length ? ` (${g.items.join(", ")})` : ""}`).join("; ")}`);
  if (spec.relations.length) {
    const byId = new Map(spec.groups.map((g) => [g.id, g.label]));
    parts.push(`Relasi: ${spec.relations.map((r) => `${byId.get(r.from)} → ${byId.get(r.to)}${r.label ? ` [${r.label}]` : ""}`).join("; ")}`);
  }
  const text = parts.join(". ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Generator spec via AI (dipakai job laporan)
// ---------------------------------------------------------------------------

export interface ConceptForReportResult { ok: boolean; spec?: ConceptSpec; svg?: string; summary?: string; error?: string }

export async function generateConceptForReport(input: {
  diagramType: string;
  title: string;
  purpose: string;
  reportContext: Record<string, unknown>;
  budgetMs?: number;
  onStatus?: (text: string) => void;
}): Promise<ConceptForReportResult> {
  const kind = /erd|entity/i.test(input.diagramType) ? "ERD sederhana (kelompok = entitas, item = atribut, relasi = hubungan dengan label kardinalitas)"
    : /class/i.test(input.diagramType) ? "diagram kelas sederhana (kelompok = kelas, item = atribut/metode utama, relasi = asosiasi/pewarisan)"
    : /arsitek|architect|komponen/i.test(input.diagramType) ? "diagram arsitektur sistem (kelompok = lapisan/komponen, item = sub-komponen/teknologi, relasi = aliran data)"
    : "peta konsep/kerangka pemikiran (kelompok = konsep utama, item = sub-konsep, relasi = keterkaitan; isi center bila ada konsep pusat)";
  const system = `Anda menyusun SPEC diagram untuk laporan akademik Indonesia. Jenis: ${kind}.
Balas HANYA JSON: {"title":string,"center"?:string,"groups":[{"id":string,"label":string,"items":string[]}],"relations":[{"from":id,"to":id,"label"?:string}]}.
Aturan: 3-8 groups; tiap group 2-6 items singkat (≤6 kata); label ≤5 kata; relations 2-12 memakai id group; isi harus SPESIFIK pada konteks laporan (jangan generik). Tanpa penjelasan di luar JSON.`;
  const user = JSON.stringify({ judul: input.title, tujuan: input.purpose, konteks: input.reportContext });
  const budget = input.budgetMs ?? 60_000;
  const call = async (model: string, timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const base = { model, messages: [{ role: "system" as const, content: system }, { role: "user" as const, content: user }], temperature: 0.2, max_tokens: 1800 };
      let res;
      try {
        res = await aiClient.chat.completions.create({ ...base, reasoning_effort: "low", response_format: { type: "json_object" } }, { signal: controller.signal, maxRetries: 0 });
      } catch (err) {
        if ((err as { status?: number })?.status !== 400) throw err;
        res = await aiClient.chat.completions.create(base, { signal: controller.signal, maxRetries: 0 });
      }
      return stripThinking(res.choices?.[0]?.message?.content || "");
    } finally { clearTimeout(timer); }
  };
  input.onStatus?.(`Menyusun struktur "${input.title}"…`);
  const started = Date.now();
  let text = "";
  try {
    text = await call(AI_MODEL, Math.min(45_000, budget));
  } catch (err) {
    const left = budget - (Date.now() - started);
    if (left < 10_000) return { ok: false, error: err instanceof Error ? err.message : "AI gagal" };
    input.onStatus?.("Mencoba jalur lebih cepat…");
    try { text = await call(AI_MODEL_FAST, Math.min(30_000, left)); } catch (e2) { return { ok: false, error: e2 instanceof Error ? e2.message : "AI gagal" }; }
  }
  let json = text.trim();
  const a = json.indexOf("{"), b = json.lastIndexOf("}");
  if (a >= 0 && b > a) json = json.slice(a, b + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ok: false, error: "Spec diagram bukan JSON valid" }; }
  const spec = normalizeConceptSpec(parsed, input.title);
  if (spec.groups.length < 2) return { ok: false, error: "Spec diagram terlalu kosong (<2 komponen)" };
  input.onStatus?.(`Menggambar ${spec.groups.length} komponen, ${spec.relations.length} relasi…`);
  return { ok: true, spec, svg: conceptToSvg(spec), summary: summarizeConcept(spec) };
}

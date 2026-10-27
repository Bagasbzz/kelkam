/**
 * src/lib/uml/edge-route.ts
 * -----------------------------------------------------------------------------
 * Routing garis + tata letak label edge, dipakai BERSAMA oleh editor
 * (components/diagram/Edge.tsx) dan renderer laporan (render-svg.ts) supaya
 * gambar di UML Builder = gambar di DOCX.
 *
 * Label diukur dengan measureText (metrik yang sama dengan auto-fit node),
 * bukan lebar tetap. Label pesan sequence boleh dibungkus (default ≤ 2 baris,
 * font turun sedikit bila perlu) dan TIDAK pernah dipotong.
 * -----------------------------------------------------------------------------
 */
import type { DiagramEdge, DiagramNode } from "@/lib/types/diagram";
import {
  EDGE_LABEL_FONT,
  EDGE_LABEL_LINE_RATIO,
  EDGE_LABEL_PAD_X,
  EDGE_LABEL_PAD_Y,
  FIT_MIN_FONT,
  GRID_STEP,
  LOOP_OFFSET,
  NODE_MIN,
  ROW_GAP,
  SEQ_LABEL_MIN_WIDTH,
  SEQ_MESSAGE_FONT,
  SEQ_SELF_LOOP_H,
  SEQ_SELF_LOOP_W,
} from "./theme";
import { measureText, wrapLabel } from "./text-fit";
import { messageKind } from "./sequence";

export interface Point {
  x: number;
  y: number;
}

export interface EdgeLabelLayout {
  lines: string[];
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  /** Ukuran kotak latar label (px). */
  width: number;
  height: number;
}

export interface PlacedLabel extends EdgeLabelLayout {
  /** Pusat kotak label. */
  x: number;
  y: number;
}

export interface EdgeRoute {
  points: Point[];
  path: string;
  label: PlacedLabel | null;
  /** Panah terbuka dipakai untuk async/return/create/destroy. */
  marker: "solid" | "open";
  startMarker?: "aggregation" | "composition";
  endMarker?: "inheritance" | "none";
  cardinalities?: { text: string; x: number; y: number }[];
}

export const snap = (value: number) => Math.round(value / GRID_STEP) * GRID_STEP;

const MAX_PLAIN_LABEL_WIDTH = 200;
const SEQ_MAX_LINES = 2;
/** Jarak jalur cabang side-down dari sisi terluar node (tetap di dalam lane: LANE_PAD + sisa lebar). */
const SIDE_OFFSET = 16;

function boxFor(lines: string[], fontSize: number, bold: boolean): EdgeLabelLayout {
  const lineHeight = fontSize * EDGE_LABEL_LINE_RATIO;
  const textWidth = Math.max(...lines.map((line) => measureText(line, fontSize, bold)), fontSize);
  return {
    lines,
    fontSize,
    fontWeight: bold ? 700 : 600,
    lineHeight,
    width: Math.ceil(textWidth + EDGE_LABEL_PAD_X * 2),
    height: Math.ceil(lines.length * lineHeight + EDGE_LABEL_PAD_Y * 2),
  };
}

/** Label edge biasa (Ya/Tidak, relasi use case): 1 baris bila muat, maks ±200 px. */
export function layoutPlainLabel(label: string): EdgeLabelLayout | null {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const lines = wrapLabel(clean, MAX_PLAIN_LABEL_WIDTH - EDGE_LABEL_PAD_X * 2, EDGE_LABEL_FONT, false);
  return boxFor(lines, EDGE_LABEL_FONT, false);
}

/**
 * Label pesan sequence (bold). `span` = jarak horizontal antara dua lifeline.
 * Lebar kotak ≤ max(span − 12, SEQ_LABEL_MIN_WIDTH); kalau tetap > 2 baris,
 * font turun bertahap sampai FIT_MIN_FONT, lalu baris ke-3 dst. diizinkan.
 */
export function layoutSequenceLabel(label: string, span: number): EdgeLabelLayout | null {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const maxText = Math.max(SEQ_LABEL_MIN_WIDTH, Math.abs(span) - 12) - EDGE_LABEL_PAD_X * 2;
  for (let fs = SEQ_MESSAGE_FONT; fs >= FIT_MIN_FONT; fs -= 0.5) {
    const lines = wrapLabel(clean, maxText, fs, true);
    if (lines.length <= SEQ_MAX_LINES) return boxFor(lines, fs, true);
  }
  return boxFor(wrapLabel(clean, maxText, FIT_MIN_FONT, true), FIT_MIN_FONT, true);
}

const toPath = (points: Point[]) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");

const place = (layout: EdgeLabelLayout | null, x: number, y: number): PlacedLabel | null =>
  layout ? { ...layout, x: snap(x), y: snap(y) } : null;

function exitPoint(node: DiagramNode, side: "right" | "left" | "bottom" | "top"): Point {
  const x = node.x + (node.offsetX || 0);
  const y = node.y + (node.offsetY || 0);
  const cx = x + node.width / 2;
  if (["initial", "final", "interface"].includes(node.type)) {
    const cy = y + (node.type === "interface" ? 10 : 12), r = node.type === "final" ? 12 : 10;
    return { x: cx + (side === "right" ? r : side === "left" ? -r : 0), y: cy + (side === "bottom" ? r : side === "top" ? -r : 0) };
  }
  const cy = y + node.height / 2;
  switch (side) {
    case "right": return { x: x + node.width, y: cy };
    case "left": return { x, y: cy };
    case "bottom": return { x: cx, y: y + node.height };
    default: return { x: cx, y };
  }
}

const centerX = (node: DiagramNode) => node.x + (node.offsetX || 0) + node.width / 2;
const centerY = (node: DiagramNode) => node.y + (node.offsetY || 0) + (node.type === "interface" ? 10 : node.type === "initial" || node.type === "final" ? 12 : node.height / 2);

/** Hitung jalur garis + posisi label untuk satu edge. */
export function routeEdge(edge: DiagramEdge, from: DiagramNode, to: DiagramNode, nodes: DiagramNode[] = []): EdgeRoute {
  const kind = messageKind(edge);
  const marker = kind === "async" || kind === "return" || kind === "create"
    ? "open" as const
    : "solid" as const;
  // Pesan sequence: garis horizontal antar lifeline, label di atas garis.
  if (from.type === "lifeline" && to.type === "lifeline" && typeof edge.y === "number") {
    const y = edge.y;
    const dir = centerX(to) >= centerX(from) ? 1 : -1;
    const anchor = (node: DiagramNode, side: number, at: number) => {
      const bars = nodes.filter((n) => n.type === "activation" && n.attachTo?.[0] === node.id && at >= n.y + (n.offsetY ?? 0) && at <= n.y + (n.offsetY ?? 0) + n.height).sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
      const bar = bars[0];
      return bar ? bar.x + (bar.offsetX ?? 0) + (side > 0 ? bar.width : 0) : centerX(node);
    };
    const fx = anchor(from, dir, y);
    const tx = kind === "create" ? to.x + (to.offsetX ?? 0) + (dir > 0 ? 0 : to.width) : anchor(to, -dir, y);
    if (from.id === to.id) {
      const sideX = fx + SEQ_SELF_LOOP_W;
      const points = [{ x: fx, y }, { x: sideX, y }, { x: sideX, y: y + SEQ_SELF_LOOP_H }, { x: anchor(to, 1, y + SEQ_SELF_LOOP_H), y: y + SEQ_SELF_LOOP_H }];
      const layout = edge.label ? layoutSequenceLabel(edge.label, SEQ_SELF_LOOP_W) : null;
      return {
        points,
        path: toPath(points),
        marker,
        label: layout ? { ...layout, x: fx + layout.width / 2 + 5, y: y - 3 - layout.height / 2 } : null,
      };
    }
    const points = [{ x: fx, y }, { x: tx, y }];
    const layout = edge.label ? layoutSequenceLabel(edge.label, tx - fx) : null;
    return {
      points,
      path: toPath(points),
      marker,
      // Tidak di-snap vertikal: kotak harus tepat 3 px di atas garis agar tidak menyentuh pesan sebelumnya.
      label: layout ? { ...layout, x: snap((fx + tx) / 2), y: y - 3 - layout.height / 2 } : null,
    };
  }

  const plain = edge.label ? layoutPlainLabel(edge.label) : null;

  if (edge.relation) {
    const dx = centerX(to) - centerX(from), dy = centerY(to) - centerY(from);
    let points: Point[];
    if (from.id === to.id) {
      const x = from.x + from.width + (from.offsetX ?? 0), y = centerY(from);
      const bottom = y + Math.min(32, from.height / 2 - 4);
      points = [{ x, y: y - 12 }, { x: x + 44, y: y - 12 }, { x: x + 44, y: bottom }, { x, y: bottom }];
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      const a = exitPoint(from, dx > 0 ? "right" : "left"), b = exitPoint(to, dx > 0 ? "left" : "right");
      points = [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b];
    } else {
      const a = exitPoint(from, dy > 0 ? "bottom" : "top"), b = exitPoint(to, dy > 0 ? "top" : "bottom");
      points = [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b];
    }
    const a = points[0], b = points[points.length - 1];
    let labelStart = points[0], labelEnd = points[1];
    for (let i = 1; i < points.length; i += 1) {
      if (Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) > Math.hypot(labelEnd.x - labelStart.x, labelEnd.y - labelStart.y)) { labelStart = points[i - 1]; labelEnd = points[i]; }
    }
    if (from.id === to.id) { labelStart = points[1]; labelEnd = points[2]; }
    const verticalLabel = labelStart.x === labelEnd.x;
    const cardinality = (value: string | undefined, start: boolean) => {
      if (!value) return [];
      const p = start ? a : b, next = start ? points[1] : points[points.length - 2];
      const length = Math.hypot(next.x - p.x, next.y - p.y) || 1;
      return [{ text: value, x: p.x + (next.x - p.x) / length * 26 + (Math.abs(next.x - p.x) < 1 ? 20 : 0), y: p.y + (next.y - p.y) / length * 26 - 12 }];
    };
    return {
      points, path: toPath(points),
      label: place(plain, (labelStart.x + labelEnd.x) / 2 + (verticalLabel ? (plain?.width ?? 0) / 2 + 6 : 0), (labelStart.y + labelEnd.y) / 2 - (!verticalLabel ? (plain?.height ?? 0) / 2 + 4 : 0)),
      marker: ["dependency", "realization"].includes(edge.relation) ? "open" : "solid",
      endMarker: ["inheritance", "realization"].includes(edge.relation) ? "inheritance" : ["association", "aggregation", "composition", "communication"].includes(edge.relation) ? "none" : undefined,
      startMarker: edge.relation === "aggregation" || edge.relation === "composition" ? edge.relation : undefined,
      cardinalities: [...cardinality(edge.fromCardinality, true), ...cardinality(edge.toCardinality, false)],
    };
  }

  // Use case: garis lurus antar pusat.
  if (["actor", "usecase"].includes(from.type) || ["actor", "usecase"].includes(to.type)) {
    const points = [{ x: snap(centerX(from)), y: snap(centerY(from)) }, { x: snap(centerX(to)), y: snap(centerY(to)) }];
    return {
      points,
      path: toPath(points),
      marker: "solid",
      label: place(plain, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2),
    };
  }

  const fromBottom = exitPoint(from, "bottom");
  const toTop = exitPoint(to, "top");
  const fromRight = exitPoint(from, "right");
  const fromLeft = exitPoint(from, "left");
  const toLeft = exitPoint(to, "left");
  const toRight = exitPoint(to, "right");
  const x1 = snap(fromBottom.x);
  const y1 = snap(fromBottom.y);
  const x2 = snap(toTop.x);
  const y2 = snap(toTop.y);
  const toX = to.x + (to.offsetX || 0);
  const fromX = from.x + (from.offsetX || 0);
  const upwardOrLoop = y2 <= y1 + 24;
  const horizontalDelta = centerX(to) - centerX(from);
  // Route samping (Ya/Tidak). Target di samping → keluar sudut, belok, masuk atas/sisi target.
  // Target di BAWAH pada kolom yang sama (cabang ditumpuk dalam satu lane) → "side-down":
  // keluar sudut, turun di luar kedua node, masuk dari sisi target. Jalur lurus ke bawah
  // akan menembus node cabang lain yang ditumpuk di antaranya.
  let dir = edge.direction;
  let sideDown = false;
  if (!upwardOrLoop && (dir === "right" || dir === "left")) {
    if (Math.abs(horizontalDelta) < from.width / 2 + 24) {
      // Cukup ruang untuk node lain di antara asal & target → hindari dengan jalur samping.
      sideDown = y2 - y1 > ROW_GAP + NODE_MIN.rect.height;
      if (!sideDown) dir = undefined;
    } else dir = horizontalDelta > 0 ? "right" : "left";
  }

  let points: Point[];
  let label: PlacedLabel | null = null;
  const w = plain?.width ?? 0;
  const h = plain?.height ?? 0;

  if (sideDown && (dir === "right" || dir === "left")) {
    const right = dir === "right";
    const start = right ? fromRight : fromLeft;
    const end = right ? toRight : toLeft;
    const sx = snap(start.x);
    const sy = snap(start.y);
    const ey = snap(end.y);
    const outer = right ? Math.max(start.x, end.x) : Math.min(start.x, end.x);
    const sideX = snap(right ? outer + SIDE_OFFSET : outer - SIDE_OFFSET);
    points = [{ x: sx, y: sy }, { x: sideX, y: sy }, { x: sideX, y: ey }, { x: snap(end.x), y: ey }];
    label = place(plain, right ? sx + 4 + w / 2 : sx - 4 - w / 2, sy - 3 - h / 2);
  } else if ((dir === "right" || dir === "left") && !upwardOrLoop) {
    const right = dir === "right";
    const start = right ? fromRight : fromLeft;
    const sx = snap(start.x);
    const sy = snap(start.y);
    const useTop = right ? toX < sx : toX + to.width > sx;
    const end = useTop ? toTop : right ? toLeft : toRight;
    const ex = snap(end.x);
    const ey = snap(end.y);
    const reach = Math.max(40, Math.min(96, Math.abs(ex - sx) / 2));
    const bendX = snap(right ? sx + reach : sx - reach);
    points = [{ x: sx, y: sy }, { x: bendX, y: sy }, { x: bendX, y: ey }, { x: ex, y: ey }];
    // Label tepat di luar sudut node asal, di atas garis keluar.
    label = place(plain, right ? sx + 4 + w / 2 : sx - 4 - w / 2, sy - 3 - h / 2);
  } else if (upwardOrLoop) {
    // Loop balik: keluar dari SISI node asal (bukan bawah) supaya tidak menyeberangi node yang
    // ditumpuk tepat di bawahnya, lewat luar kedua node, lalu masuk dari atas target.
    const goLeft = horizontalDelta < 0 || (horizontalDelta === 0 && edge.direction === "left");
    const edgeX = goLeft ? Math.min(fromX, toX) : Math.max(fromX + from.width, toX + to.width);
    const routeX = snap(goLeft ? edgeX - LOOP_OFFSET : edgeX + LOOP_OFFSET);
    const start = goLeft ? fromLeft : fromRight;
    const sx = snap(start.x);
    const sy = snap(start.y);
    // Masuk dari sisi target yang searah (bukan atas) → tidak bertemu panah masuk lain di atas target.
    const entry = goLeft ? toLeft : toRight;
    const ey = snap(entry.y);
    points = [
      { x: sx, y: sy }, { x: routeX, y: sy },
      { x: routeX, y: ey }, { x: snap(entry.x), y: ey },
    ];
    // Label di atas garis keluar, di sisi luar node asal.
    label = place(plain, goLeft ? sx - 4 - w / 2 : sx + 4 + w / 2, sy - 3 - h / 2);
  } else if (Math.abs(x1 - x2) <= 8) {
    points = [{ x: x1, y: y1 }, { x: x1, y: y2 }];
    // Label (Ya/Tidak) dekat node asal & di samping garis, tidak menutupi garis.
    label = place(plain, x1 + 6 + w / 2, y1 + 4 + h / 2);
  } else {
    const midY = snap(y1 + (y2 - y1) / 2);
    points = [{ x: x1, y: y1 }, { x: x1, y: midY }, { x: x2, y: midY }, { x: x2, y: y2 }];
    const side = x2 > x1 ? 1 : -1;
    label = place(plain, x1 + side * (6 + w / 2), y1 + 4 + h / 2);
  }

  return { points, path: toPath(points), label, marker: "solid" };
}

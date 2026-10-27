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
} from "./theme";
import { measureText, wrapLabel } from "./text-fit";

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
  const cy = y + node.height / 2;
  switch (side) {
    case "right": return { x: x + node.width, y: cy };
    case "left": return { x, y: cy };
    case "bottom": return { x: cx, y: y + node.height };
    default: return { x: cx, y };
  }
}

const centerX = (node: DiagramNode) => node.x + (node.offsetX || 0) + node.width / 2;
const centerY = (node: DiagramNode) => node.y + (node.offsetY || 0) + node.height / 2;

/** Hitung jalur garis + posisi label untuk satu edge. */
export function routeEdge(edge: DiagramEdge, from: DiagramNode, to: DiagramNode): EdgeRoute {
  // Pesan sequence: garis horizontal antar lifeline, label di atas garis.
  if (from.type === "lifeline" && to.type === "lifeline" && typeof edge.y === "number") {
    const fx = snap(centerX(from));
    const tx = snap(centerX(to));
    const y = snap(edge.y);
    const points = [{ x: fx, y }, { x: tx, y }];
    const layout = edge.label ? layoutSequenceLabel(edge.label, tx - fx) : null;
    return {
      points,
      path: toPath(points),
      // Tidak di-snap vertikal: kotak harus tepat 3 px di atas garis agar tidak menyentuh pesan sebelumnya.
      label: layout ? { ...layout, x: snap((fx + tx) / 2), y: y - 3 - layout.height / 2 } : null,
    };
  }

  const plain = edge.label ? layoutPlainLabel(edge.label) : null;

  // Use case: garis lurus antar pusat.
  if (["actor", "usecase"].includes(from.type) || ["actor", "usecase"].includes(to.type)) {
    const points = [{ x: snap(centerX(from)), y: snap(centerY(from)) }, { x: snap(centerX(to)), y: snap(centerY(to)) }];
    return {
      points,
      path: toPath(points),
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

  return { points, path: toPath(points), label };
}

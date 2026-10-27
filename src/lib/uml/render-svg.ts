/**
 * src/lib/uml/render-svg.ts
 * -----------------------------------------------------------------------------
 * Renderer SVG murni (string, tanpa React/DOM) untuk data diagram UML Builder.
 * Geometri, tipografi (theme.ts), auto-fit label (text-fit.ts) dan routing edge
 * (edge-route.ts) dipakai bersama dengan components/diagram/*, sehingga gambar
 * di laporan identik dengan yang dilihat pengguna di UML Builder.
 * Dipakai server (job laporan → payload) dan klien (rasterisasi SVG → PNG saat
 * ekspor DOCX).
 * -----------------------------------------------------------------------------
 */
import type { DiagramEdge, DiagramNode } from "@/lib/types/diagram";
import { routeEdge, type PlacedLabel } from "@/lib/uml/edge-route";
import { fitTerminators } from "@/lib/uml/node-size";
import { diagramFontCap, laneTitleFont, layoutNodeText } from "@/lib/uml/text-fit";
import { isSequenceNode, messageKind } from "./sequence";
import { sequenceNodeOrder, sequenceShapes } from "./sequence-shapes";
import {
  ARROW,
  ARROW_OPEN,
  EDGE_DASH,
  EDGE_DASHED_STROKE,
  EDGE_STROKE,
  EDGE_STROKE_WIDTH,
  FONT_FAMILY,
  INK,
  LABEL_BORDER,
  LANE_FILL_EVEN,
  LANE_FILL_ODD,
  LANE_HEADER_FILL,
  LANE_HEADER_HEIGHT,
  LANE_START_X,
  LANE_STROKE,
  LANE_STROKE_WIDTH,
  LANE_TOP_Y,
  NODE_STROKE_WIDTH,
  OUTSIDE_LINE_HEIGHT,
  OUTSIDE_LABEL_GAP,
  SVG_MIN_HEIGHT,
  SVG_MIN_WIDTH,
  SVG_PADDING,
  resolveLaneWidth,
} from "@/lib/uml/theme";

export interface SvgDiagramInput {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  lanes?: string[];
  /** Lebar lane tersimpan (meta.laneWidth). Kosong → dideteksi dari posisi node (diagram lama = 420). */
  laneWidth?: number;
  title?: string;
}

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const num = (value: number) => Number(value.toFixed(1)).toString();

/** Jarak bawah lane setelah node terbawah. */
const LANE_BOTTOM_PAD = 28;

function renderNode(node: DiagramNode, fontCap?: number): string {
  if (isSequenceNode(node)) {
    return `<g>${sequenceShapes(node).map((shape) => {
      const attrs = Object.entries(shape.attrs).map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${esc(String(value))}"`).join(" ");
      return `<${shape.tag} ${attrs}>${shape.text === undefined ? "" : esc(shape.text)}</${shape.tag}>`;
    }).join("")}</g>`;
  }
  const { type, width, height } = node;
  const x = node.x + (node.offsetX || 0);
  const y = node.y + (node.offsetY || 0);
  const stroke = `stroke="${INK}" stroke-width="${NODE_STROKE_WIDTH}"`;
  let shape = "";
  switch (type) {
    case "start":
    case "end":
    case "usecase":
      // Terminator & use case: satu oval bergaris tunggal (konsisten dengan editor).
      shape = `<ellipse cx="${num(x + width / 2)}" cy="${num(y + height / 2)}" rx="${num(width / 2)}" ry="${num(height / 2)}" fill="white" ${stroke}/>`;
      break;
    case "activity":
      shape = `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="20" fill="white" ${stroke}/>`;
      break;
    case "fork":
    case "join":
      shape = `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="${INK}" ${stroke}/>`;
      break;
    case "actor": {
      const cx = x + width / 2;
      const r = 12;
      shape =
        `<g fill="none" ${stroke}>` +
        `<circle cx="${num(cx)}" cy="${num(y + r)}" r="${r}"/>` +
        `<line x1="${num(cx)}" y1="${num(y + r * 2)}" x2="${num(cx)}" y2="${num(y + 50)}"/>` +
        `<line x1="${num(cx - 20)}" y1="${num(y + 30)}" x2="${num(cx + 20)}" y2="${num(y + 30)}"/>` +
        `<line x1="${num(cx)}" y1="${num(y + 50)}" x2="${num(cx - 15)}" y2="${num(y + 75)}"/>` +
        `<line x1="${num(cx)}" y1="${num(y + 50)}" x2="${num(cx + 15)}" y2="${num(y + 75)}"/>` +
        `</g>`;
      break;
    }
    case "decision": {
      const hw = width / 2;
      const hh = height / 2;
      shape = `<polygon points="${num(x + hw)},${num(y)} ${num(x + width)},${num(y + hh)} ${num(x + hw)},${num(y + height)} ${num(x)},${num(y + hh)}" fill="white" ${stroke}/>`;
      break;
    }
    default:
      // process, system, dll.
      shape = `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="4" fill="white" ${stroke}/>`;
  }

  // Label auto-fit (sama persis dengan editor Node.tsx).
  const layout = layoutNodeText(node, x, y, fontCap);
  const showText = layout.lines.join("").trim().length > 0;
  const cx = x + width / 2;
  const tspans = layout.lines
    .map((line, i) => `<tspan x="${num(cx)}" dy="${i === 0 ? 0 : num(layout.lineHeight)}">${esc(line)}</tspan>`)
    .join("");
  const text = showText
    ? `<text x="${num(cx)}" y="${num(layout.firstLineY)}" text-anchor="middle" dominant-baseline="${layout.baseline}" font-size="${num(layout.fontSize)}" font-weight="${layout.fontWeight}" fill="${INK}" font-family="${FONT_FAMILY}">${tspans}</text>`
    : "";
  return `<g>${shape}${text}</g>`;
}

function renderLabel(label: PlacedLabel): string {
  const firstY = -((label.lines.length - 1) * label.lineHeight) / 2;
  const tspans = label.lines
    .map((line, i) => `<tspan x="0" dy="${i === 0 ? num(firstY) : num(label.lineHeight)}">${esc(line)}</tspan>`)
    .join("");
  return (
    `<g transform="translate(${num(label.x)}, ${num(label.y)})">` +
    `<rect x="${num(-label.width / 2)}" y="${num(-label.height / 2)}" width="${label.width}" height="${label.height}" fill="white" rx="3" opacity="0.98" stroke="${LABEL_BORDER}" stroke-width="1"/>` +
    `<text x="0" y="0" text-anchor="middle" dominant-baseline="middle" font-size="${num(label.fontSize)}" font-weight="${label.fontWeight}" fill="${EDGE_STROKE}" font-family="${FONT_FAMILY}">${tspans}</text>` +
    `</g>`
  );
}

/** Perkiraan tepi bawah label luar (actor / fork / join). */
function outsideLabelBottom(node: DiagramNode, y: number): number {
  if (node.type !== "actor" && node.type !== "fork" && node.type !== "join") return y + node.height;
  const lines = Math.max(node.lines?.length || 1, 1);
  return y + node.height + OUTSIDE_LABEL_GAP + lines * OUTSIDE_LINE_HEIGHT;
}

/**
 * Hasilkan SVG lengkap. viewBox dipangkas ke bounding box node + garis + label
 * (+ lane) dengan padding kecil; tidak ada lebar minimum besar, supaya diagram
 * kecil tidak diperkecil saat ditempel ke laporan.
 */
export function diagramToSvg(input: SvgDiagramInput): string {
  // Diagram lama: oval terminator terlalu kecil → perbesar agar label muat.
  const nodes = fitTerminators(input.nodes ?? []);
  const edges = input.edges ?? [];
  const lanes = input.lanes?.length
    ? input.lanes
    : (Array.from(new Set(nodes.map((n) => n.lane).filter(Boolean))) as string[]);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x1: number, y1: number, x2: number, y2: number) => {
    minX = Math.min(minX, x1); minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
  };

  for (const n of nodes) {
    const x = n.x + (n.offsetX || 0);
    const y = n.y + (n.offsetY || 0);
    // Label actor bisa lebih lebar dari figurnya.
    const labelHalf = n.type === "actor" ? 50 : 0;
    grow(x - labelHalf, y, x + n.width + labelHalf, outsideLabelBottom(n, y) + (n.destroyed ? 10 : 0));
  }

  // Edge dirute dulu agar garis balik & label ikut masuk bounding box (tidak terpotong).
  const routed = edges.map((e) => {
    const from = nodeById.get(e.fromId);
    const to = nodeById.get(e.toId);
    return from && to ? { edge: e, route: routeEdge(e, from, to, nodes) } : null;
  });
  for (const item of routed) {
    if (!item) continue;
    for (const p of item.route.points) grow(p.x - 6, p.y - 6, p.x + 6, p.y + 6);
    const l = item.route.label;
    if (l) grow(l.x - l.width / 2, l.y - l.height / 2, l.x + l.width / 2, l.y + l.height / 2);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = SVG_MIN_WIDTH; maxY = SVG_MIN_HEIGHT; }

  let laneSvg = "";
  if (lanes.length) {
    const laneWidth = resolveLaneWidth(nodes, lanes, input.laneWidth);
    const laneHeight = Math.max(maxY + LANE_BOTTOM_PAD - LANE_TOP_Y, 240);
    grow(LANE_START_X, LANE_TOP_Y, LANE_START_X + lanes.length * laneWidth, LANE_TOP_Y + laneHeight);
    laneSvg = lanes
      .map((lane, i) => {
        const x = LANE_START_X + i * laneWidth;
        const titleFont = laneTitleFont(lane, laneWidth);
        return (
          `<rect x="${x}" y="${LANE_TOP_Y}" width="${laneWidth}" height="${num(laneHeight)}" fill="${i % 2 === 0 ? LANE_FILL_EVEN : LANE_FILL_ODD}" stroke="${LANE_STROKE}" stroke-width="${LANE_STROKE_WIDTH}"/>` +
          `<rect x="${x}" y="${LANE_TOP_Y}" width="${laneWidth}" height="${LANE_HEADER_HEIGHT}" fill="${LANE_HEADER_FILL}" stroke="${LANE_STROKE}" stroke-width="${LANE_STROKE_WIDTH}"/>` +
          `<text x="${num(x + laneWidth / 2)}" y="${num(LANE_TOP_Y + LANE_HEADER_HEIGHT / 2)}" text-anchor="middle" dominant-baseline="middle" fill="${INK}" font-size="${num(titleFont)}" font-weight="700" font-family="${FONT_FAMILY}">${esc(lane)}</text>`
        );
      })
      .join("");
  }

  const vx = Math.floor(minX - SVG_PADDING);
  const vy = Math.floor(minY - SVG_PADDING);
  const vw = Math.max(SVG_MIN_WIDTH, Math.ceil(maxX - minX + SVG_PADDING * 2));
  const vh = Math.max(SVG_MIN_HEIGHT, Math.ceil(maxY - minY + SVG_PADDING * 2));

  const lineSvg = routed
    .map((item) => {
      if (!item) return "";
      const dashed = Boolean(item.edge.dashed) || ["return", "create"].includes(messageKind(item.edge));
      return `<path d="${item.route.path}" fill="none" stroke="${dashed ? EDGE_DASHED_STROKE : EDGE_STROKE}" stroke-width="${EDGE_STROKE_WIDTH}" stroke-dasharray="${dashed ? EDGE_DASH : "none"}" marker-end="url(#${item.route.marker === "open" ? "arrowhead-open" : dashed ? "arrowhead-dashed" : "arrowhead"})"/>`;
    })
    .join("");
  // Label digambar setelah semua garis & node agar tidak tertimpa garis lain.
  const labelSvg = routed.map((item) => (item?.route.label ? renderLabel(item.route.label) : "")).join("");
  const fontCap = diagramFontCap(nodes);
  const ordered = sequenceNodeOrder(nodes);
  const backgroundSvg = ordered.filter((n) => n.type === "fragment" || n.type === "lifeline" || n.type === "activation").map((n) => renderNode(n, fontCap)).join("");
  const nodeSvg = ordered.filter((n) => n.type !== "fragment" && n.type !== "lifeline" && n.type !== "activation").map((n) => renderNode(n, fontCap)).join("");
  const marker = (id: string, fill: string) =>
    `<marker id="${id}" markerWidth="${ARROW.width}" markerHeight="${ARROW.height}" refX="${ARROW.refX}" refY="${ARROW.refY}" orient="auto"><polygon points="${ARROW.points}" fill="${fill}"/></marker>`;
  const openMarker = `<marker id="arrowhead-open" markerWidth="${ARROW_OPEN.width}" markerHeight="${ARROW_OPEN.height}" refX="${ARROW_OPEN.refX}" refY="${ARROW_OPEN.refY}" orient="auto"><path d="${ARROW_OPEN.path}" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.5"/></marker>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}" font-family="${FONT_FAMILY}">` +
    `<defs>${marker("arrowhead", EDGE_STROKE)}${marker("arrowhead-dashed", EDGE_DASHED_STROKE)}${openMarker}</defs>` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="white"/>` +
    laneSvg + backgroundSvg + lineSvg + nodeSvg + labelSvg +
    `</svg>`
  );
}

/** Ringkasan teks diagram untuk konteks penulisan bab (bukan untuk digambar ulang). */
export function summarizeDiagram(input: SvgDiagramInput, max = 900): string {
  const nodes = input.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n.text]));
  const parts: string[] = [];
  if (input.lanes?.length) parts.push(`Lane: ${input.lanes.join(", ")}`);
  parts.push(`Elemen: ${nodes.map((n) => `${n.text} (${n.type})`).join("; ")}`);
  const flows = (input.edges ?? [])
    .map((e) => `${byId.get(e.fromId) ?? e.fromId} → ${byId.get(e.toId) ?? e.toId}${e.label ? ` [${e.label}]` : ""}`)
    .join("; ");
  if (flows) parts.push(`Alur: ${flows}`);
  const text = parts.join(". ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

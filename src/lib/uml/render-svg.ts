/**
 * src/lib/uml/render-svg.ts
 * -----------------------------------------------------------------------------
 * Renderer SVG murni (string, tanpa React/DOM) untuk data diagram UML Builder.
 * Bentuk & routing disalin dari components/diagram/{Node,Edge,DiagramCanvas}.tsx
 * agar gambar di laporan identik dengan yang dilihat pengguna di UML Builder.
 * Dipakai server (job laporan → payload) dan klien (rasterisasi SVG → PNG saat
 * ekspor DOCX).
 * -----------------------------------------------------------------------------
 */
import type { DiagramEdge, DiagramNode } from "@/lib/types/diagram";

export interface SvgDiagramInput {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  lanes?: string[];
  title?: string;
}

const PRIMARY_STROKE = "#334155";
const DASHED_STROKE = "#94a3b8";
const BORDER = "#1e293b";
const FONT = "Inter, 'Segoe UI', Arial, sans-serif";
const LINE_HEIGHT = 20;
const LANE_WIDTH = 420;
const LANE_START_X = 20;
const LANE_HEADER_HEIGHT = 52;
const PADDING = 40;

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const snap = (value: number) => Math.round(value / 4) * 4;
const num = (value: number) => Number(value.toFixed(1)).toString();

function exitPoint(node: DiagramNode, side: "right" | "left" | "bottom" | "top") {
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

function renderNode(node: DiagramNode): string {
  const { type, width, height } = node;
  const x = node.x + (node.offsetX || 0);
  const y = node.y + (node.offsetY || 0);
  const stroke = `stroke="${BORDER}" stroke-width="1.5"`;
  let shape = "";
  switch (type) {
    case "start":
    case "usecase":
      shape = `<ellipse cx="${num(x + width / 2)}" cy="${num(y + height / 2)}" rx="${num(width / 2)}" ry="${num(height / 2)}" fill="white" ${stroke}/>`;
      break;
    case "end":
      shape = `<ellipse cx="${num(x + width / 2)}" cy="${num(y + height / 2)}" rx="${num(width / 2)}" ry="${num(height / 2)}" fill="white" ${stroke}/>`
        + `<ellipse cx="${num(x + width / 2)}" cy="${num(y + height / 2)}" rx="${num(Math.max(8, width / 2 - 5))}" ry="${num(Math.max(8, height / 2 - 5))}" fill="none" stroke="${BORDER}" stroke-width="1.2"/>`;
      break;
    case "process":
    case "system":
      shape = `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="4" fill="white" ${stroke}/>`;
      break;
    case "activity":
      shape = `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="20" fill="white" ${stroke}/>`;
      break;
    case "fork":
    case "join":
      shape = `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="${BORDER}" ${stroke}/>`;
      break;
    case "lifeline": {
      const cx = x + width / 2;
      shape =
        `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="46" rx="4" fill="white" ${stroke}/>` +
        `<line x1="${num(cx)}" y1="${num(y + 46)}" x2="${num(cx)}" y2="${num(y + height)}" stroke="#475569" stroke-width="2" stroke-dasharray="8,6"/>`;
      break;
    }
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
      shape = `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="4" fill="white" ${stroke}/>`;
  }

  const lines = node.lines?.length ? node.lines : [node.text];
  const totalTextHeight = (lines.length - 1) * LINE_HEIGHT;
  let textY = y + height / 2 - totalTextHeight / 2;
  let baseline = "middle";
  if (type === "actor" || type === "fork" || type === "join") {
    textY = y + height + 15;
    if (type === "actor") baseline = "hanging";
  } else if (type === "lifeline") {
    textY = y + 23 - totalTextHeight / 2;
  }
  const showText = lines.join("").trim().length > 0;
  const cx = x + width / 2;
  const tspans = lines
    .map((line, i) => `<tspan x="${num(cx)}" dy="${i === 0 ? 0 : LINE_HEIGHT}">${esc(line)}</tspan>`)
    .join("");
  const text = showText
    ? `<text x="${num(cx)}" y="${num(textY)}" text-anchor="middle" dominant-baseline="${baseline}" font-size="13" font-weight="${type === "actor" ? 600 : 500}" fill="${BORDER}" font-family="${FONT}">${tspans}</text>`
    : "";
  return `<g>${shape}${text}</g>`;
}

function renderLabel(label: string, x: number, y: number, prominent = false): string {
  const width = prominent ? 168 : Math.max(54, Math.min(116, label.length * 7.2 + 18));
  const height = 20;
  return (
    `<g transform="translate(${snap(x)}, ${snap(y)})">` +
    `<rect x="${num(-width / 2)}" y="${-height / 2}" width="${num(width)}" height="${height}" fill="white" rx="3" opacity="0.98" stroke="#cbd5e1" stroke-width="1"/>` +
    `<text text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="${prominent ? 700 : 600}" fill="${PRIMARY_STROKE}" font-family="${FONT}">${esc(label)}</text>` +
    `</g>`
  );
}

function renderEdge(edge: DiagramEdge, from: DiagramNode, to: DiagramNode): string {
  const stroke = edge.dashed ? DASHED_STROKE : PRIMARY_STROKE;
  const marker = edge.dashed ? "arrowhead-dashed" : "arrowhead";
  let path = "";
  let labelX = 0;
  let labelY = 0;
  let prominent = false;

  if (from.type === "lifeline" && to.type === "lifeline" && typeof edge.y === "number") {
    const fx = snap(from.x + (from.offsetX || 0) + from.width / 2);
    const tx = snap(to.x + (to.offsetX || 0) + to.width / 2);
    const y = snap(edge.y);
    path = `M ${fx},${y} H ${tx}`;
    labelX = (fx + tx) / 2;
    labelY = y - 14;
    prominent = true;
  } else if (["actor", "usecase"].includes(from.type) || ["actor", "usecase"].includes(to.type)) {
    const fx = snap(from.x + (from.offsetX || 0) + from.width / 2);
    const fy = snap(from.y + (from.offsetY || 0) + from.height / 2);
    const tx = snap(to.x + (to.offsetX || 0) + to.width / 2);
    const ty = snap(to.y + (to.offsetY || 0) + to.height / 2);
    path = `M ${fx},${fy} L ${tx},${ty}`;
    labelX = (fx + tx) / 2;
    labelY = (fy + ty) / 2 - 12;
  } else {
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
    const upwardOrLoop = y2 <= y1 + 24;
    const horizontalDelta = (toX + to.width / 2) - (from.x + (from.offsetX || 0) + from.width / 2);
    let dir = edge.direction;
    if (!upwardOrLoop && (dir === "right" || dir === "left")) {
      if (Math.abs(horizontalDelta) < from.width / 2 + 24) dir = undefined;
      else dir = horizontalDelta > 0 ? "right" : "left";
    }

    if (dir === "right" && !upwardOrLoop) {
      const sx = snap(fromRight.x);
      const sy = snap(fromRight.y);
      const useTop = toX < sx;
      const ex = snap(useTop ? toTop.x : toLeft.x);
      const ey = snap(useTop ? toTop.y : toLeft.y);
      const bendX = snap(sx + Math.max(48, Math.min(96, Math.abs(ex - sx) / 2)));
      path = `M ${sx},${sy} H ${bendX} V ${ey} H ${ex}`;
      labelX = (sx + bendX) / 2;
      labelY = sy - 12;
    } else if (dir === "left" && !upwardOrLoop) {
      const sx = snap(fromLeft.x);
      const sy = snap(fromLeft.y);
      const useTop = toX + to.width > sx;
      const ex = snap(useTop ? toTop.x : toRight.x);
      const ey = snap(useTop ? toTop.y : toRight.y);
      const bendX = snap(sx - Math.max(48, Math.min(96, Math.abs(ex - sx) / 2)));
      path = `M ${sx},${sy} H ${bendX} V ${ey} H ${ex}`;
      labelX = (sx + bendX) / 2;
      labelY = sy - 12;
    } else if (upwardOrLoop) {
      const goLeft = horizontalDelta < 0;
      const edgeX = goLeft
        ? Math.min(from.x + (from.offsetX || 0), toX)
        : Math.max(from.x + (from.offsetX || 0) + from.width, toX + to.width);
      const routeX = snap(goLeft ? edgeX - 56 : edgeX + 56);
      const departureY = snap(y1 + 28);
      const approachY = snap(y2 - 24);
      path = `M ${x1},${y1} V ${departureY} H ${routeX} V ${approachY} H ${x2} V ${y2}`;
      labelX = goLeft ? routeX - 8 : routeX + 8;
      labelY = (departureY + approachY) / 2;
    } else if (Math.abs(x1 - x2) <= 8) {
      path = `M ${x1},${y1} V ${y2}`;
      // Label (Ya/Tidak) ditaruh dekat node asal & di samping garis supaya tidak tertutup node lain / label edge sejajar.
      labelX = x1 + 40;
      labelY = y1 + 18;
    } else {
      const midY = snap(y1 + (y2 - y1) / 2);
      path = `M ${x1},${y1} V ${midY} H ${x2} V ${y2}`;
      labelX = x1 + (x2 > x1 ? 40 : -40);
      labelY = y1 + 18;
    }
  }

  return (
    `<g><path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-dasharray="${edge.dashed ? "5,5" : "none"}" marker-end="url(#${marker})"/>` +
    (edge.label ? renderLabel(edge.label, labelX, labelY, prominent) : "") +
    `</g>`
  );
}

/**
 * Hasilkan SVG lengkap (dengan viewBox terpangkas ke bounding box + padding).
 * Lebar minimal 800 agar proporsi gambar di laporan konsisten.
 */
export function diagramToSvg(input: SvgDiagramInput): string {
  const nodes = input.nodes ?? [];
  const edges = input.edges ?? [];
  const lanes = input.lanes?.length
    ? input.lanes
    : (Array.from(new Set(nodes.map((n) => n.lane).filter(Boolean))) as string[]);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Bounding box: node (teks di bawah actor/fork perlu ruang ekstra) + lane.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const x = n.x + (n.offsetX || 0);
    const y = n.y + (n.offsetY || 0);
    const extra = n.type === "actor" || n.type === "fork" || n.type === "join" ? 20 + (n.lines?.length || 1) * LINE_HEIGHT : 0;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + n.width); maxY = Math.max(maxY, y + n.height + extra);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 800; maxY = 400; }
  // Edge balik bisa melewati sisi kanan node terjauh.
  maxX += edges.some((e) => !e.direction) ? 160 : 100;

  let laneSvg = "";
  if (lanes.length) {
    const laneHeight = Math.max(maxY + 80 - 24, 300);
    minX = Math.min(minX, LANE_START_X);
    minY = Math.min(minY, 24);
    maxX = Math.max(maxX, LANE_START_X + lanes.length * LANE_WIDTH);
    maxY = Math.max(maxY, 24 + laneHeight);
    laneSvg = lanes
      .map((lane, i) => {
        const x = LANE_START_X + i * LANE_WIDTH;
        return (
          `<rect x="${x}" y="24" width="${LANE_WIDTH}" height="${num(laneHeight)}" fill="${i % 2 === 0 ? "#ffffff" : "#f8fafc"}" stroke="#94a3b8" stroke-width="1.5"/>` +
          `<rect x="${x}" y="24" width="${LANE_WIDTH}" height="${LANE_HEADER_HEIGHT}" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>` +
          `<text x="${x + LANE_WIDTH / 2}" y="56" text-anchor="middle" dominant-baseline="middle" fill="${BORDER}" font-size="18" font-weight="700" font-family="${FONT}">${esc(lane)}</text>`
        );
      })
      .join("");
  }

  const vx = Math.floor(minX - PADDING);
  const vy = Math.floor(minY - PADDING);
  const vw = Math.max(800, Math.ceil(maxX - minX + PADDING * 2));
  const vh = Math.max(240, Math.ceil(maxY - minY + PADDING * 2));

  const edgeSvg = edges
    .map((e) => {
      const from = nodeById.get(e.fromId);
      const to = nodeById.get(e.toId);
      return from && to ? renderEdge(e, from, to) : "";
    })
    .join("");
  const nodeSvg = nodes.map(renderNode).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}" font-family="${FONT}">` +
    `<defs>` +
    `<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${PRIMARY_STROKE}"/></marker>` +
    `<marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${DASHED_STROKE}"/></marker>` +
    `</defs>` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="white"/>` +
    laneSvg + edgeSvg + nodeSvg +
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

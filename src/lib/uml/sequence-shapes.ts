import type { DiagramNode } from "../types/diagram";
import { fitText, wrapLabel } from "./text-fit";
import { sequenceHeaderHeight } from "./sequence";
import {
  ACTIVATION_FILL, DESTROY_SIZE, FONT_FAMILY, FRAGMENT_DASH, FRAGMENT_FONT,
  FRAGMENT_TAG_HEIGHT, INK, LIFELINE_DASH,
  LIFELINE_STROKE_WIDTH, NODE_STROKE_WIDTH, NOTE_FILL, NOTE_FONT, NOTE_FOLD,
} from "./theme";

/** Primitive SVG bersama untuk renderer React dan ekspor tanpa DOM. */
export interface SvgPrimitive {
  tag: "rect" | "line" | "circle" | "ellipse" | "path" | "polygon" | "text";
  attrs: Record<string, string | number>;
  text?: string;
}

export function sequenceShapes(node: DiagramNode, color = INK, strokeWidth = NODE_STROKE_WIDTH): SvgPrimitive[] {
  const x = node.x + (node.offsetX ?? 0), y = node.y + (node.offsetY ?? 0);
  const w = node.width, h = node.height, cx = x + w / 2;
  const shapes: SvgPrimitive[] = [];
  const add = (tag: SvgPrimitive["tag"], attrs: SvgPrimitive["attrs"], text?: string) => shapes.push({ tag, attrs, text });
  const stroke = { stroke: color, strokeWidth, fill: "none" };
  const text = (value: string, tx: number, ty: number, size: number, anchor = "middle", weight = 600) =>
    add("text", { x: tx, y: ty, fill: color, fontSize: size, fontWeight: weight, fontFamily: FONT_FAMILY, textAnchor: anchor, dominantBaseline: "middle" }, value);
  if (node.type === "lifeline") {
    const kind = node.participantKind ?? "participant";
    const plain = kind === "participant";
    const header = sequenceHeaderHeight(kind);
    if (plain) add("rect", { x, y, width: w, height: header, rx: 4, ...stroke, fill: "white" });
    else if (kind === "actor") {
      add("circle", { cx, cy: y + 7, r: 6, ...stroke });
      add("path", { d: `M ${cx} ${y + 13} V ${y + 25} M ${cx - 10} ${y + 18} H ${cx + 10} M ${cx} ${y + 25} l -8 8 M ${cx} ${y + 25} l 8 8`, ...stroke });
    } else if (kind === "database") {
      add("path", { d: `M ${cx - 15} ${y + 8} V ${y + 25} C ${cx - 15} ${y + 34} ${cx + 15} ${y + 34} ${cx + 15} ${y + 25} V ${y + 8}`, ...stroke, fill: "white" });
      add("ellipse", { cx, cy: y + 8, rx: 15, ry: 6, ...stroke, fill: "white" });
    } else {
      add("circle", { cx, cy: y + 18, r: 13, ...stroke, fill: "white" });
      if (kind === "boundary") add("path", { d: `M ${cx - 24} ${y + 5} V ${y + 31} M ${cx - 24} ${y + 18} H ${cx - 13}`, ...stroke });
      if (kind === "control") add("path", { d: `M ${cx - 5} ${y + 1} L ${cx} ${y + 5} L ${cx - 5} ${y + 10}`, ...stroke });
      if (kind === "entity") add("line", { x1: cx - 17, y1: y + 33, x2: cx + 17, y2: y + 33, ...stroke });
    }
    const labelH = plain ? header : header - 36;
    const fitted = fitText(node.text, { shape: "rect", width: w, height: labelH, padX: 6, padY: 2, bold: true }, plain ? 20 : 16);
    fitted.lines.forEach((line, i) => text(line, cx, y + (plain ? header / 2 : 36 + labelH / 2) + (i - (fitted.lines.length - 1) / 2) * fitted.lineHeight, fitted.fontSize));
    add("line", { x1: cx, y1: y + header, x2: cx, y2: y + h, ...stroke, strokeWidth: LIFELINE_STROKE_WIDTH, strokeDasharray: LIFELINE_DASH });
    if (node.destroyed) add("path", { d: `M ${cx - DESTROY_SIZE} ${y + h - DESTROY_SIZE} L ${cx + DESTROY_SIZE} ${y + h + DESTROY_SIZE} M ${cx - DESTROY_SIZE} ${y + h + DESTROY_SIZE} L ${cx + DESTROY_SIZE} ${y + h - DESTROY_SIZE}`, ...stroke, strokeWidth: 2.5 });
    return shapes;
  }
  if (node.type === "activation") {
    add("rect", { x, y, width: w, height: h, ...stroke, fill: ACTIVATION_FILL });
    return shapes;
  }
  if (node.type === "fragment" || node.type === "ref") {
    const tagWidth = node.type === "ref" ? 44 : Math.max(44, (node.fragmentKind?.length ?? 3) * 9 + 14);
    add("rect", { x, y, width: w, height: h, ...stroke, fill: node.type === "ref" ? "white" : "none" });
    add("path", { d: `M ${x} ${y} H ${x + tagWidth} V ${y + FRAGMENT_TAG_HEIGHT - 6} L ${x + tagWidth - 6} ${y + FRAGMENT_TAG_HEIGHT} H ${x} Z`, ...stroke, fill: "white" });
    text(node.type === "ref" ? "ref" : node.fragmentKind ?? "alt", x + tagWidth / 2 - 2, y + 11, FRAGMENT_FONT);
    if (node.type === "fragment") {
      (node.operands ?? []).forEach((o, i) => {
        const oy = o.y + (node.offsetY ?? 0);
        if (i > 0) add("line", { x1: x, x2: x + w, y1: oy, y2: oy, ...stroke, strokeDasharray: FRAGMENT_DASH });
        const guard = o.guard.replace(/^\[|\]$/g, "");
        const lines = wrapLabel(`[${guard}]`, w - 20, FRAGMENT_FONT);
        lines.forEach((line, j) => text(line, x + 10, oy + 12 + j * 17, FRAGMENT_FONT, "start", 500));
      });
      return shapes;
    }
  } else if (node.type === "note") {
    add("path", { d: `M ${x} ${y} H ${x + w - NOTE_FOLD} L ${x + w} ${y + NOTE_FOLD} V ${y + h} H ${x} Z M ${x + w - NOTE_FOLD} ${y} V ${y + NOTE_FOLD} H ${x + w}`, ...stroke, fill: NOTE_FILL });
  } else return shapes;
  const fitted = fitText(node.text, { shape: "rect", width: w, height: h - (node.type === "ref" ? 22 : 0), padX: 12, padY: 6 }, NOTE_FONT);
  fitted.lines.forEach((line, i) => text(line, cx, y + h / 2 + (node.type === "ref" ? 11 : 0) + (i - (fitted.lines.length - 1) / 2) * fitted.lineHeight, fitted.fontSize, "middle", 500));
  return shapes;
}

export function sequenceNodeOrder(nodes: DiagramNode[]): DiagramNode[] {
  const rank = (n: DiagramNode) => n.type === "fragment" ? 0 : n.type === "lifeline" ? 1 : n.type === "activation" ? 2 : 3;
  return [...nodes].sort((a, b) => rank(a) - rank(b) || (a.depth ?? 0) - (b.depth ?? 0));
}

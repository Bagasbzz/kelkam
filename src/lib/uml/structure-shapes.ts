import type { DiagramNode } from "../types/diagram";
import type { SvgPrimitive } from "./sequence-shapes";
import { isStructuralNode, structuralTextSections } from "./structure";
import { FONT_FAMILY, INK, NODE_STROKE_WIDTH } from "./theme";

export { isStructuralNode, orderStructureNodes } from "./structure";

/** Text stays in primitive.text: renderers must escape it, never treat it as markup. */
export function structuralShapes(node: DiagramNode, color = INK, strokeWidth = NODE_STROKE_WIDTH): SvgPrimitive[] {
  if (!isStructuralNode(node)) return [];
  const x = node.x + (node.offsetX ?? 0), y = node.y + (node.offsetY ?? 0);
  const w = node.width, h = node.height, cx = x + w / 2;
  const shapes: SvgPrimitive[] = [];
  const add = (tag: SvgPrimitive["tag"], attrs: SvgPrimitive["attrs"], text?: string) => shapes.push({ tag, attrs, text });
  const stroke = { stroke: color, strokeWidth, fill: "none" };
  const cube = node.type === "device" || node.type === "execution";
  const compact = node.type === "initial" || node.type === "final" || node.type === "interface";
  const inset = cube ? 14 : 0;
  const frontWidth = w - inset;
  if (node.type === "initial") {
    add("circle", { cx, cy: y + 12, r: 10, ...stroke, fill: color });
  } else if (node.type === "final") {
    add("circle", { cx, cy: y + 12, r: 12, ...stroke, fill: "white" });
    add("circle", { cx, cy: y + 12, r: 7, fill: color, stroke: "none" });
  } else if (node.type === "interface") {
    add("circle", { cx, cy: y + 10, r: 10, ...stroke, fill: "white" });
    add("line", { x1: cx, y1: y + 20, x2: cx, y2: y + 30, ...stroke });
  } else if (cube) {
    add("path", { d: `M ${x} ${y + inset} L ${x + inset} ${y} H ${x + w} V ${y + h - inset} L ${x + frontWidth} ${y + h} H ${x} Z`, ...stroke, fill: "white" });
    add("path", { d: `M ${x} ${y + inset} H ${x + frontWidth} V ${y + h} M ${x + frontWidth} ${y + inset} L ${x + w} ${y}`, ...stroke });
  } else if (node.type === "artifact") {
    const fold = 14;
    add("path", { d: `M ${x} ${y} H ${x + w - fold} L ${x + w} ${y + fold} V ${y + h} H ${x} Z M ${x + w - fold} ${y} V ${y + fold} H ${x + w}`, ...stroke, fill: "white" });
  } else {
    add("rect", { x, y, width: w, height: h, rx: node.type === "state" ? 14 : 0, ...stroke, fill: "white" });
    if (node.type === "component") {
      add("rect", { x: x + w - 27, y: y + 9, width: 18, height: 25, ...stroke, fill: "white" });
      for (const dy of [13, 25]) add("rect", { x: x + w - 31, y: y + dy, width: 8, height: 5, ...stroke, fill: "white" });
    }
  }
  let cursor = y + (compact ? 32 : inset);
  for (const section of structuralTextSections(node)) {
    const members = section.kind === "attributes" || section.kind === "operations";
    if (members) add("line", { x1: x, x2: x + frontWidth, y1: cursor, y2: cursor, ...stroke });
    const rightInset = cube ? 14 : node.type === "component" ? 28 : node.type === "artifact" ? 14 : 0;
    const center = x + (w - rightInset) / 2;
    const lineHeight = section.fontSize * 1.2;
    const firstY = cursor + (section.height - (section.lines.length - 1) * lineHeight) / 2;
    section.lines.forEach((line, index) => add("text", {
      x: members ? x + 12 : center, y: firstY + index * lineHeight,
      fill: color, fontFamily: FONT_FAMILY, fontSize: section.fontSize,
      fontWeight: section.bold ? 600 : 400, textAnchor: members ? "start" : "middle", dominantBaseline: "middle",
    }, line));
    cursor += section.height;
  }
  return shapes;
}

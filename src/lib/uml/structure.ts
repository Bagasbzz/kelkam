import type { DiagramEdge, DiagramNode } from "../types/diagram";
import { measureText, wrapToWidth } from "./text-fit";

export const STRUCTURAL_TYPES = ["class", "state", "erd", "component", "deployment"] as const;
export type StructuralDiagramType = typeof STRUCTURAL_TYPES[number];
export const isStructuralType = (value: unknown): value is StructuralDiagramType =>
  typeof value === "string" && STRUCTURAL_TYPES.some((type) => type === value);

export interface StructureSpec {
  elements?: {
    id: string;
    name: string;
    kind?: "class" | "state" | "initial" | "final" | "entity" | "component" | "interface" | "device" | "execution" | "artifact";
    attributes?: string[];
    operations?: string[];
    stereotype?: string;
    parent?: string;
  }[];
  relations?: {
    from: string;
    to: string;
    label?: string;
    kind?: "association" | "inheritance" | "realization" | "aggregation" | "composition" | "dependency" | "transition" | "communication";
    fromCardinality?: string;
    toCardinality?: string;
  }[];
}

type ElementKind = NonNullable<NonNullable<StructureSpec["elements"]>[number]["kind"]>;
type RelationKind = NonNullable<NonNullable<StructureSpec["relations"]>[number]["kind"]>;

const ELEMENT_KINDS: Record<StructuralDiagramType, readonly ElementKind[]> = {
  class: ["class"], state: ["state", "initial", "final"], erd: ["entity"],
  component: ["component", "interface"], deployment: ["device", "execution", "artifact"],
};
const RELATION_KINDS: Record<StructuralDiagramType, readonly RelationKind[]> = {
  class: ["association", "inheritance", "realization", "aggregation", "composition", "dependency"],
  state: ["transition"], erd: ["association"],
  component: ["association", "dependency", "realization"],
  deployment: ["association", "dependency", "communication"],
};
const DEFAULT_RELATION: Record<StructuralDiagramType, RelationKind> = {
  class: "association", state: "transition", erd: "association", component: "dependency", deployment: "communication",
};
const NODE_KINDS = new Set<string>(Object.values(ELEMENT_KINDS).flat());
export const isStructuralNode = (node: { type: string }): boolean => NODE_KINDS.has(node.type);

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Also checks malformed JSON at runtime; callers can display errors before conversion. */
export function structuralSpecErrors(spec: StructureSpec, type: StructuralDiagramType): string[] {
  if (!isStructuralType(type)) return ["Jenis diagram struktural tidak valid."];
  if (!record(spec)) return ["Spesifikasi struktur harus berupa objek."];
  const errors: string[] = [];
  if (!Array.isArray(spec.elements) || !spec.elements.length) errors.push("Diagram memerlukan minimal satu elemen.");
  if (spec.relations !== undefined && !Array.isArray(spec.relations)) errors.push("Relations harus berupa array.");
  const elements: Record<string, unknown>[] = [];
  const relations: Record<string, unknown>[] = [];
  for (const element of Array.isArray(spec.elements) ? spec.elements : []) {
    if (record(element)) elements.push(element);
    else errors.push("Elemen harus berupa objek.");
  }
  for (const relation of Array.isArray(spec.relations) ? spec.relations : []) {
    if (record(relation)) relations.push(relation);
    else errors.push("Relasi harus berupa objek.");
  }
  if (elements.length > 18 || relations.length > 36) errors.push("Diagram maksimal 18 elemen dan 36 relasi.");
  const byId = new Map<unknown, Record<string, unknown>>();
  const kindOf = (element: Record<string, unknown>) => element.kind === undefined ? ELEMENT_KINDS[type][0] : element.kind;
  for (const element of elements) {
    const id = element.id;
    if (!nonempty(id) || !nonempty(element.name)) errors.push("ID dan nama elemen tidak boleh kosong.");
    if (byId.has(id)) errors.push(`ID elemen duplikat: ${String(id)}.`);
    byId.set(id, element);
    if (!ELEMENT_KINDS[type].some((kind) => kind === kindOf(element))) errors.push(`Jenis elemen ${String(id)} tidak sesuai diagram ${type}.`);
    for (const field of ["attributes", "operations"] as const) {
      const values = element[field];
      if (values !== undefined && (!Array.isArray(values) || !values.every(nonempty))) errors.push(`${field} elemen ${String(id)} harus berupa array teks tidak kosong.`);
      if (Array.isArray(values) && values.length > 20) errors.push(`${field} elemen ${String(id)} maksimal 20 anggota.`);
      if (Array.isArray(values) && values.length && ["initial", "final", "interface"].includes(String(kindOf(element)))) errors.push(`Elemen ${String(id)} tidak mendukung ${field}.`);
      if (field === "operations" && kindOf(element) === "entity" && Array.isArray(values) && values.length) errors.push(`Entitas ${String(id)} tidak mendukung operasi.`);
    }
    if (element.stereotype !== undefined && !nonempty(element.stereotype)) errors.push(`Stereotype elemen ${String(id)} tidak valid.`);
    if (["initial", "final", "interface"].includes(String(kindOf(element))) && element.stereotype !== undefined) errors.push(`Elemen ${String(id)} tidak mendukung stereotype.`);
    if (element.parent !== undefined) {
      if (type !== "deployment") errors.push("Containment parent hanya didukung diagram deployment.");
      if (!nonempty(element.parent)) errors.push(`Parent elemen ${String(id)} tidak valid.`);
    }
  }
  for (const element of elements) {
    if (element.parent === undefined) continue;
    const parent = byId.get(element.parent);
    if (!parent) errors.push(`Parent elemen ${String(element.id)} tidak ditemukan.`);
    else if (parent === element || kindOf(parent) === "artifact" || (kindOf(parent) === "execution" && kindOf(element) === "device")) errors.push(`Hierarki containment elemen ${String(element.id)} tidak valid.`);
    const seen = new Set<unknown>([element.id]);
    let cursor: Record<string, unknown> | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.id)) {
        errors.push(`Siklus containment pada elemen ${String(element.id)}.`);
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parent === undefined ? undefined : byId.get(cursor.parent);
    }
  }
  for (const [index, relation] of relations.entries()) {
    const kind = relation.kind === undefined ? DEFAULT_RELATION[type] : relation.kind;
    const from = byId.get(relation.from), to = byId.get(relation.to);
    if (!from || !to) errors.push(`Relasi ${index + 1} mengacu ke ID yang tidak ditemukan.`);
    if (!RELATION_KINDS[type].some((allowed) => allowed === kind)) errors.push(`Jenis relasi ${index + 1} tidak sesuai diagram ${type}.`);
    if (relation.label !== undefined && typeof relation.label !== "string") errors.push(`Label relasi ${index + 1} harus berupa teks.`);
    for (const field of ["fromCardinality", "toCardinality"] as const) {
      if (relation[field] === undefined) continue;
      if (!nonempty(relation[field])) errors.push(`Kardinalitas relasi ${index + 1} tidak valid.`);
      if (!["class", "erd"].includes(type) || !["association", "aggregation", "composition"].includes(String(kind))) errors.push(`Kardinalitas tidak didukung pada relasi ${index + 1}.`);
    }
    if (from && to && type === "state") {
      if (kindOf(from) === "final") errors.push("Final state tidak boleh memiliki transisi keluar.");
      if (kindOf(to) === "initial") errors.push("Initial state tidak boleh memiliki transisi masuk.");
    }
    if (relation.from === relation.to && ["inheritance", "realization", "aggregation", "composition"].includes(String(kind))) errors.push(`Relasi ${index + 1} tidak boleh mengacu ke dirinya sendiri.`);
    if (from && to && type === "component" && kind === "realization" && (kindOf(from) !== "component" || kindOf(to) !== "interface")) errors.push("Realization komponen harus menuju interface dari komponen.");
    if (from && to && type === "deployment" && kind === "communication" && (kindOf(from) === "artifact" || kindOf(to) === "artifact")) errors.push("Communication path hanya menghubungkan device/execution.");
  }
  if (type === "state") {
    if (elements.filter((element) => kindOf(element) === "initial").length !== 1 || !elements.some((element) => kindOf(element) === "final")) errors.push("Diagram state memerlukan tepat satu initial dan minimal satu final.");
    for (const initial of elements.filter((element) => kindOf(element) === "initial")) {
      if (relations.filter((relation) => relation.from === initial.id).length !== 1) errors.push(`Initial ${String(initial.id)} harus memiliki tepat satu transisi keluar.`);
    }
  }
  return errors;
}

const PAD = 12;
const CUBE = 14;
const GAP = 48;
const CHILD_PAD = 24;

export interface StructuralTextSection {
  kind: "stereotype" | "title" | "attributes" | "operations";
  lines: string[];
  fontSize: number;
  height: number;
  bold: boolean;
}

/** Shared measured compartments, with no line-count cap or ellipsis. */
export function structuralTextSections(node: DiagramNode, width = node.width): StructuralTextSection[] {
  const inset = node.type === "device" || node.type === "execution" ? CUBE : node.type === "component" ? 28 : node.type === "artifact" ? 14 : 0;
  const available = Math.max(24, width - PAD * 2 - inset);
  const sections: StructuralTextSection[] = [];
  const add = (kind: StructuralTextSection["kind"], values: string[], fontSize: number, bold = false, minHeight = 0) => {
    const lines = values.flatMap((value) => value.split(/\r?\n/).flatMap((line) => wrapToWidth(line, available, fontSize, true, bold) ?? []));
    sections.push({ kind, lines, fontSize, bold, height: Math.max(minHeight, lines.length * fontSize * 1.2 + (kind === "stereotype" ? 8 : PAD * 2)) });
  };
  if (node.stereotype) add("stereotype", [`\u00ab${node.stereotype}\u00bb`], 16);
  else if (node.type === "device" || node.type === "execution") add("stereotype", [node.type === "device" ? "\u00abdevice\u00bb" : "\u00abexecutionEnvironment\u00bb"], 16);
  add("title", [node.text], ["initial", "final", "interface"].includes(node.type) ? 17 : 20, true);
  if (node.type === "class" || node.type === "entity" || node.attributes?.length) add("attributes", node.attributes ?? [], 16, false, 28);
  if (node.type === "class" || node.operations?.length) add("operations", node.operations ?? [], 16, false, 28);
  return sections;
}

function nodeSize(node: DiagramNode): { width: number; height: number } {
  const compact = ["initial", "final", "interface"].includes(node.type);
  const inset = node.type === "device" || node.type === "execution" ? CUBE : node.type === "component" ? 28 : node.type === "artifact" ? 14 : 0;
  const labels = [node.text, node.stereotype ?? "", ...(node.attributes ?? []), ...(node.operations ?? [])];
  if (!node.stereotype && (node.type === "device" || node.type === "execution")) labels.push(node.type === "device" ? "\u00abdevice\u00bb" : "\u00abexecutionEnvironment\u00bb");
  const desired = Math.max(...labels.flatMap((label, i) => label.split(/\r?\n/).map((line) => measureText(line, i === 0 ? 20 : 16, i === 0))));
  const width = Math.ceil(Math.max(compact ? 72 : 160, Math.min(compact ? 220 : 300, desired + PAD * 2 + inset)));
  const content = structuralTextSections(node, width).reduce((sum, section) => sum + section.height, 0);
  return { width, height: Math.ceil(content + (compact ? 32 : node.type === "device" || node.type === "execution" ? CUBE : 0)) };
}

export function structureToDiagram(spec: StructureSpec, type: StructuralDiagramType): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const errors = structuralSpecErrors(spec, type);
  if (errors.length) throw new Error(errors.join("\n"));
  const nodes: DiagramNode[] = (spec.elements ?? []).map((element) => ({
    id: element.id, type: element.kind ?? ELEMENT_KINDS[type][0], text: element.name, lines: [element.name],
    attributes: element.attributes ? [...element.attributes] : undefined,
    operations: element.operations ? [...element.operations] : undefined,
    stereotype: element.stereotype, parentId: element.parent,
    x: 0, y: 0, width: 0, height: 0,
  }));
  const edges: DiagramEdge[] = (spec.relations ?? []).map((relation, index) => ({
    id: `structure-edge-${index + 1}`, fromId: relation.from, toId: relation.to, label: relation.label,
    relation: relation.kind ?? DEFAULT_RELATION[type], fromCardinality: relation.fromCardinality, toCardinality: relation.toCardinality,
    dashed: relation.kind === "dependency" || relation.kind === "realization" || (relation.kind === undefined && DEFAULT_RELATION[type] === "dependency"),
  }));
  return { nodes: layoutStructure(nodes, edges, type), edges };
}

/** Relation-aware grid; cycles (including state self-transitions) never block layout. */
export function layoutStructure(nodes: DiagramNode[], edges: DiagramEdge[], type: StructuralDiagramType): DiagramNode[] {
  const gap = type === "erd" ? GAP * 2 : GAP;
  const result = nodes.map((node) => ({ ...node, ...nodeSize(node), offsetX: 0, offsetY: 0 }));
  const byId = new Map(result.map((node) => [node.id, node]));
  if (byId.size !== result.length) throw new Error("Layout memerlukan ID elemen unik.");
  const children = new Map<string | undefined, DiagramNode[]>();
  for (const node of result) {
    if (node.parentId !== undefined && (!node.parentId || type !== "deployment" || !byId.has(node.parentId))) throw new Error("Parent layout tidak valid.");
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const ordered = (siblings: DiagramNode[]) => {
    const ids = new Set(siblings.map((node) => node.id));
    const adjacent = new Map<string, string[]>();
    const incoming = new Set<string>();
    for (const edge of edges) {
      const reverse = edge.relation === "inheritance" || edge.relation === "realization";
      const from = reverse ? edge.toId : edge.fromId, to = reverse ? edge.fromId : edge.toId;
      if (from === to || !ids.has(from) || !ids.has(to)) continue;
      adjacent.set(from, [...(adjacent.get(from) ?? []), to]);
      incoming.add(to);
    }
    const starts = type === "state" ? siblings.filter((node) => node.type === "initial") : siblings.filter((node) => !incoming.has(node.id));
    const queue = [...starts, ...siblings];
    const seen = new Set<string>();
    const sorted: DiagramNode[] = [];
    const visit = (node: DiagramNode) => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      sorted.push(node);
      for (const id of adjacent.get(node.id) ?? []) visit(byId.get(id)!);
    };
    queue.forEach(visit);
    return type === "state" ? [...sorted.filter((node) => node.type !== "final"), ...sorted.filter((node) => node.type === "final")] : sorted;
  };
  const grid = (siblings: DiagramNode[], x: number, y: number) => {
    const sorted = ordered(siblings);
    const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
    const widths = Array.from({ length: columns }, (_, column) => Math.max(0, ...sorted.filter((_, i) => i % columns === column).map((node) => node.width)));
    let cursorY = y;
    for (let start = 0; start < sorted.length; start += columns) {
      const row = sorted.slice(start, start + columns);
      const height = Math.max(...row.map((node) => node.height));
      let cursorX = x;
      row.forEach((node, column) => {
        node.x = cursorX + (widths[column] - node.width) / 2;
        node.y = cursorY + (height - node.height) / 2;
        cursorX += widths[column] + gap;
      });
      cursorY += height + gap;
    }
    return { width: widths.reduce((sum, width) => sum + width, 0) + Math.max(0, columns - 1) * gap, height: Math.max(0, cursorY - y - gap) };
  };
  const visiting = new Set<string>(), measured = new Set<string>();
  const sizeContainer = (node: DiagramNode) => {
    if (visiting.has(node.id)) throw new Error("Siklus containment pada layout.");
    if (measured.has(node.id)) return;
    visiting.add(node.id);
    const nested = children.get(node.id) ?? [];
    nested.forEach(sizeContainer);
    if (nested.length) {
      if (!["device", "execution"].includes(node.type) || nested.some((child) => node.type === "execution" && child.type === "device")) throw new Error("Hierarki containment layout tidak valid.");
      const area = grid(nested, 0, 0);
      node.width = Math.max(node.width, area.width + CHILD_PAD * 2 + CUBE);
      node.height = Math.ceil(CUBE + structuralTextSections(node).reduce((sum, section) => sum + section.height, 0) + CHILD_PAD * 2 + area.height);
    }
    visiting.delete(node.id);
    measured.add(node.id);
  };
  result.forEach(sizeContainer);
  grid(children.get(undefined) ?? [], 32, 32);
  const placeChildren = (node: DiagramNode) => {
    const nested = children.get(node.id) ?? [];
    const header = CUBE + structuralTextSections(node).reduce((sum, section) => sum + section.height, 0);
    grid(nested, node.x + CHILD_PAD, node.y + header + CHILD_PAD);
    nested.forEach(placeChildren);
  };
  (children.get(undefined) ?? []).forEach(placeChildren);
  return result;
}

/** Paint deployment containers before descendants without mutating caller order. */
export function orderStructureNodes(nodes: DiagramNode[]): DiagramNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depth = (node: DiagramNode) => {
    const seen = new Set<string>([node.id]);
    let value = 0, parent = node.parentId ? byId.get(node.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      value++;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return value;
  };
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}

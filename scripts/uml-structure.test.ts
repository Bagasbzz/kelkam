import assert from "node:assert/strict";
import test from "node:test";
import type { DiagramNode } from "../src/lib/types/diagram.ts";
import { isStructuralType, layoutStructure, orderStructureNodes, STRUCTURAL_TYPES, structuralSpecErrors, structuralTextSections, structureToDiagram, type StructureSpec } from "../src/lib/uml/structure.ts";
import { isStructuralNode, structuralShapes } from "../src/lib/uml/structure-shapes.ts";
import { measureText } from "../src/lib/uml/text-fit.ts";

const overlaps = (a: DiagramNode, b: DiagramNode) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const classSpec: StructureSpec = {
  elements: [
    { id: "user", name: "User", attributes: ["+ id: UUID", "+ email: string"], operations: ["+ login(password: string): Session"], stereotype: "entity" },
    { id: "admin", name: "Administrator" },
  ],
  relations: [{ from: "admin", to: "user", kind: "inheritance", label: "extends" }],
};

test("structural type guard accepts only exact supported strings", () => {
  for (const type of STRUCTURAL_TYPES) assert.equal(isStructuralType(type), true);
  for (const value of [null, {}, "flowchart", "CLASS", 1]) assert.equal(isStructuralType(value), false);
});

test("class conversion preserves compartments and explicit relation fields", () => {
  assert.deepEqual(structuralSpecErrors(classSpec, "class"), []);
  const diagram = structureToDiagram(classSpec, "class");
  assert.equal(diagram.nodes.length, 2);
  assert.equal(diagram.edges[0].relation, "inheritance");
  assert.equal(diagram.edges[0].kind, undefined);
  assert.deepEqual(diagram.nodes[0].attributes, classSpec.elements![0].attributes);
  const shapes = structuralShapes(diagram.nodes[0]);
  assert.equal(shapes.filter((shape) => shape.tag === "line").length, 2);
  assert.ok(shapes.some((shape) => shape.text === "+ id: UUID"));
  assert.ok(shapes.some((shape) => shape.text === "User"));
  assert.ok(!overlaps(diagram.nodes[0], diagram.nodes[1]));
});

test("malformed JSON, duplicate ids, dangling references and limits fail without truncation", () => {
  const malformed: unknown[] = [null, [], { elements: {} }, { elements: [null] }, { elements: [{ id: 5, name: [] }], relations: [null] }];
  for (const value of malformed) assert.ok(structuralSpecErrors(value as StructureSpec, "class").length);
  for (const spec of [
    { elements: [{ id: "a", name: "A" }, { id: "a", name: "B" }] },
    { elements: [{ id: "a", name: "A" }], relations: [{ from: "a", to: "missing" }] },
    { elements: Array.from({ length: 19 }, (_, i) => ({ id: String(i), name: `Class ${i}` })) },
    { elements: [{ id: "a", name: "A" }], relations: Array.from({ length: 37 }, () => ({ from: "a", to: "a" })) },
  ]) assert.throws(() => structureToDiagram(spec, "class"));
});

test("explicit unknown kinds and unsupported fields are rejected", () => {
  for (const kind of ["", "unknown", null]) {
    assert.ok(structuralSpecErrors({ elements: [{ id: "a", name: "A", kind }] } as StructureSpec, "class").length);
    assert.ok(structuralSpecErrors({ elements: [{ id: "a", name: "A" }], relations: [{ from: "a", to: "a", kind }] } as StructureSpec, "class").length);
  }
  assert.ok(structuralSpecErrors({ elements: [{ id: "e", name: "Entity", operations: ["save()"] }] }, "erd").length);
  assert.ok(structuralSpecErrors({ elements: [{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B" }] }, "class").length);
  assert.throws(() => structureToDiagram({ elements: [{ id: "a", name: "A", attributes: Array.from({ length: 21 }, () => "value: string") }] }, "class"));
});

test("state transitions support cycles and self transitions with initial/final constraints", () => {
  const spec: StructureSpec = {
    elements: [{ id: "i", name: "Start", kind: "initial" }, { id: "s", name: "Processing", kind: "state", operations: ["entry / begin()"] }, { id: "f", name: "End", kind: "final" }],
    relations: [{ from: "i", to: "s" }, { from: "s", to: "s", label: "retry" }, { from: "s", to: "f" }],
  };
  assert.deepEqual(structuralSpecErrors(spec, "state"), []);
  const diagram = structureToDiagram(spec, "state");
  assert.equal(diagram.edges[1].relation, "transition");
  assert.equal(structuralShapes(diagram.nodes[0]).filter((shape) => shape.tag === "circle").length, 1);
  assert.equal(structuralShapes(diagram.nodes[2]).filter((shape) => shape.tag === "circle").length, 2);
  for (const relations of [[], [...spec.relations!, { from: "f", to: "s" }], [...spec.relations!, { from: "s", to: "i" }]]) {
    assert.ok(structuralSpecErrors({ ...spec, relations }, "state").length);
  }
  assert.ok(structuralSpecErrors({ elements: [{ id: "s", name: "State" }] }, "state").length);
});

test("ERD attributes retain keys and edge cardinalities", () => {
  const diagram = structureToDiagram({
    elements: [{ id: "u", name: "User", attributes: ["PK id: UUID"] }, { id: "p", name: "Post", attributes: ["PK id: UUID", "FK userId: UUID"] }],
    relations: [{ from: "u", to: "p", fromCardinality: "1", toCardinality: "0..*" }],
  }, "erd");
  assert.equal(diagram.nodes[0].type, "entity");
  assert.equal(diagram.edges[0].fromCardinality, "1");
  assert.equal(diagram.edges[0].toCardinality, "0..*");
  assert.ok(structuralShapes(diagram.nodes[1]).some((shape) => shape.text === "FK userId: UUID"));
});

test("component tab and interface lollipop preserve their names", () => {
  const diagram = structureToDiagram({
    elements: [{ id: "c", name: "Authentication" }, { id: "i", name: "Identity API", kind: "interface" }],
    relations: [{ from: "c", to: "i", kind: "realization" }],
  }, "component");
  assert.equal(diagram.edges[0].dashed, true);
  assert.equal(structuralShapes(diagram.nodes[0]).filter((shape) => shape.tag === "rect").length, 4);
  assert.ok(structuralShapes(diagram.nodes[1]).some((shape) => shape.tag === "circle"));
  assert.ok(structuralShapes(diagram.nodes[1]).some((shape) => shape.text === "Identity API"));
});

test("deployment nests children with padding and paints parents first", () => {
  const diagram = structureToDiagram({
    elements: [
      { id: "file", name: "application.war", kind: "artifact", parent: "runtime" },
      { id: "runtime", name: "Java Runtime", kind: "execution", parent: "server" },
      { id: "other", name: "Database", kind: "device" },
      { id: "server", name: "Application Server", kind: "device", attributes: ["OS: Linux"] },
    ],
    relations: [{ from: "server", to: "other" }],
  }, "deployment");
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  for (const node of diagram.nodes.filter((node) => node.parentId)) {
    const parent = byId.get(node.parentId!)!;
    assert.ok(node.x >= parent.x + 24 && node.x + node.width <= parent.x + parent.width - 24);
    assert.ok(node.y >= parent.y + 24 && node.y + node.height <= parent.y + parent.height - 24);
  }
  assert.ok(!overlaps(byId.get("server")!, byId.get("other")!));
  assert.equal(diagram.edges[0].relation, "communication");
  const ordered = orderStructureNodes(diagram.nodes).map((node) => node.id);
  assert.ok(ordered.indexOf("server") < ordered.indexOf("runtime"));
  assert.ok(ordered.indexOf("runtime") < ordered.indexOf("file"));
  assert.deepEqual(layoutStructure(diagram.nodes, diagram.edges, "deployment"), diagram.nodes);
});

test("deployment rejects cycles, artifact containers and device inside execution", () => {
  for (const elements of [
    [{ id: "a", name: "A", kind: "device", parent: "b" }, { id: "b", name: "B", kind: "device", parent: "a" }],
    [{ id: "a", name: "A", kind: "artifact" }, { id: "b", name: "B", kind: "artifact", parent: "a" }],
    [{ id: "a", name: "A", kind: "execution" }, { id: "b", name: "B", kind: "device", parent: "a" }],
  ]) assert.throws(() => structureToDiagram({ elements } as StructureSpec, "deployment"));
});

test("deployment supports all permitted nesting levels without clipping descendants", () => {
  const diagram = structureToDiagram({ elements: Array.from({ length: 18 }, (_, i) => ({ id: String(i), name: `Device ${i}`, kind: "device" as const, parent: i ? String(i - 1) : undefined })) }, "deployment");
  assert.equal(diagram.nodes.length, 18);
  for (let i = 1; i < diagram.nodes.length; i++) {
    const parent = diagram.nodes[i - 1], node = diagram.nodes[i];
    assert.ok(node.x >= parent.x + 24 && node.x + node.width <= parent.x + parent.width - 24);
    assert.ok(node.y >= parent.y + 24 && node.y + node.height <= parent.y + parent.height - 24);
  }
  assert.deepEqual(layoutStructure(diagram.nodes, diagram.edges, "deployment"), diagram.nodes);
});

test("long text is wrapped without truncating members or overflowing measured compartments", () => {
  const name = "VeryLongClassNameWithoutAnySpaces".repeat(5);
  const attribute = "+ detailedAttributeName: " + "LongTypeName".repeat(12);
  const diagram = structureToDiagram({ elements: [{ id: "a", name, attributes: Array.from({ length: 12 }, () => attribute), operations: ["+ calculate(): Result"] }] }, "class");
  const node = diagram.nodes[0];
  const sections = structuralTextSections(node);
  assert.equal(sections.find((section) => section.kind === "title")!.lines.join(""), name);
  assert.equal(sections.find((section) => section.kind === "attributes")!.lines.join("").replace(/\s/g, ""), attribute.repeat(12).replace(/\s/g, ""));
  assert.equal(sections.reduce((sum, section) => sum + section.height, 0), node.height);
  for (const section of sections) for (const line of section.lines) assert.ok(measureText(line, section.fontSize, section.bold) <= node.width - 24);
  for (const shape of structuralShapes(node).filter((shape) => shape.tag === "text")) {
    assert.ok(Number(shape.attrs.y) > node.y && Number(shape.attrs.y) < node.y + node.height);
    assert.ok(!shape.text?.includes("\u2026"));
  }
});

test("grid preserves all 18 nodes, stays deterministic and avoids sibling overlap", () => {
  const diagram = structureToDiagram({ elements: Array.from({ length: 18 }, (_, i) => ({ id: String(i), name: `Entity ${i}`, attributes: Array.from({ length: i % 4 }, (_, j) => `attribute${j}: string`) })) }, "erd");
  assert.equal(diagram.nodes.length, 18);
  assert.deepEqual(layoutStructure(diagram.nodes, diagram.edges, "erd"), diagram.nodes);
  for (const [i, a] of diagram.nodes.entries()) for (const b of diagram.nodes.slice(i + 1)) assert.ok(!overlaps(a, b));
});

test("untrusted text is data only and unsupported nodes render no structural primitives", () => {
  const payload = '<script>alert("x")</script>';
  const node = structureToDiagram({ elements: [{ id: "safe", name: payload }] }, "class").nodes[0];
  const shapes = structuralShapes(node);
  assert.ok(shapes.some((shape) => shape.text?.includes("<script>")));
  assert.ok(shapes.every((shape) => !Object.values(shape.attrs).some((value) => String(value).includes("<script>"))));
  assert.equal(isStructuralNode(node), true);
  assert.deepEqual(structuralShapes({ ...node, type: "process" }), []);
});

import { DiagramEdge, DiagramNode } from "@/lib/types/diagram";

export type SupportedDiagramType = "flowchart" | "usecase" | "activity" | "sequence";

export interface CompactStepLike {
  id: string;
  lane?: string;
  type: string;
  text: string;
  next?: string;
  yes?: string;
  no?: string;
}

export interface CompactSpecLike {
  title?: string;
  lanes?: string[];
  steps?: CompactStepLike[];
  actors?: { id: string; name: string; side?: "left" | "right" }[];
  usecases?: { id: string; text: string; actors: string[] }[];
  participants?: { id: string; name: string }[];
  messages?: { from: string; to: string; text: string; return?: boolean }[];
}

export interface DiagramValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSpec(spec: CompactSpecLike, diagramType: SupportedDiagramType): DiagramValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (diagramType === "usecase") {
    const actors = spec.actors || [];
    const usecases = spec.usecases || [];
    if (actors.length < 1) errors.push("Diagram use case wajib punya minimal satu aktor.");
    if (usecases.length < 1) errors.push("Diagram use case wajib punya minimal satu use case.");
    usecases.forEach((usecase) => {
      if (!usecase.actors || usecase.actors.length === 0) {
        errors.push(`Use case ${usecase.text} belum terhubung ke aktor.`);
      }
    });
    return { ok: errors.length === 0, errors, warnings };
  }

  if (diagramType === "sequence") {
    const participants = spec.participants || [];
    const messages = spec.messages || [];
    if (participants.length < 2) errors.push("Sequence diagram wajib punya minimal dua participant.");
    if (participants.length > 6) errors.push("Sequence diagram maksimal enam participant agar tetap rapi.");
    if (messages.length < 3) errors.push("Sequence diagram wajib punya minimal tiga message.");
    messages.forEach((message, index) => {
      if (message.from === message.to) {
        warnings.push(`Message ke-${index + 1} mengarah ke participant yang sama.`);
      }
    });
    return { ok: errors.length === 0, errors, warnings };
  }

  const steps = spec.steps || [];
  const ids = new Set(steps.map((step) => step.id));
  const starts = steps.filter((step) => step.type === "start");
  const ends = steps.filter((step) => step.type === "end");

  if (steps.length < 4) errors.push("Diagram alur terlalu pendek. Minimal empat langkah.");
  if (steps.length > 18) warnings.push("Diagram alur terlalu panjang. Pertimbangkan pecah jadi beberapa diagram.");
  if (starts.length !== 1) errors.push("Flowchart/activity wajib punya tepat satu start.");
  if (ends.length < 1) errors.push("Flowchart/activity wajib punya minimal satu end.");

  steps.forEach((step) => {
    if (step.type === "decision") {
      if (!step.yes || !ids.has(step.yes)) errors.push(`Decision ${step.text} belum punya cabang ya yang valid.`);
      if (!step.no || !ids.has(step.no)) errors.push(`Decision ${step.text} belum punya cabang tidak yang valid.`);
    } else if (step.type !== "end") {
      if (!step.next || !ids.has(step.next)) errors.push(`Langkah ${step.text} belum punya next yang valid.`);
    }
  });

  if (diagramType === "activity") {
    const lanes = spec.lanes || [];
    if (lanes.length < 2) {
      warnings.push("Activity diagram idealnya punya minimal dua lane agar aktor dan sistem lebih jelas.");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function layoutFlowchart(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const nextById = new Map<string, DiagramEdge[]>();
  const incoming = new Set(edges.map((edge) => edge.toId));
  edges.forEach((edge) => {
    const list = nextById.get(edge.fromId) || [];
    list.push(edge);
    nextById.set(edge.fromId, list);
  });

  const roots = nodes.filter((node) => !incoming.has(node.id));
  const startNode = roots.find((node) => node.type === "start") || roots[0] || nodes[0];
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node, pinned: true, offsetX: 0, offsetY: 0 }]));
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number; column: number }> = [{ id: startNode.id, depth: 0, column: 0 }];

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    const node = nodeMap.get(current.id);
    if (!node) continue;

    node.x = 520 + current.column * 280 - node.width / 2;
    node.y = 100 + current.depth * 152;

    const outgoing = (nextById.get(current.id) || []).sort((a, b) => {
      const rank = (edge: DiagramEdge) => edge.label?.toLowerCase() === "ya" ? 0 : edge.label?.toLowerCase() === "tidak" ? 1 : 2;
      return rank(a) - rank(b);
    });

    outgoing.forEach((edge, index) => {
      const shift = edge.label?.toLowerCase() === "ya" ? 1 : edge.label?.toLowerCase() === "tidak" ? -1 : index - Math.floor(outgoing.length / 2);
      queue.push({ id: edge.toId, depth: current.depth + 1, column: current.column + shift });
    });
  }

  return Array.from(nodeMap.values());
}

function layoutActivity(nodes: DiagramNode[], edges: DiagramEdge[], lanes: string[]) {
  const laneNames = lanes.length ? lanes : Array.from(new Set(nodes.map((node) => node.lane).filter(Boolean))) as string[];
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node, pinned: true, offsetX: 0, offsetY: 0 }]));
  const nextById = new Map<string, DiagramEdge[]>();
  const incoming = new Set(edges.map((edge) => edge.toId));
  edges.forEach((edge) => {
    const list = nextById.get(edge.fromId) || [];
    list.push(edge);
    nextById.set(edge.fromId, list);
  });

  const roots = nodes.filter((node) => !incoming.has(node.id));
  const startNode = roots.find((node) => node.type === "start") || roots[0] || nodes[0];
  const queue: Array<{ id: string; depth: number }> = [{ id: startNode.id, depth: 0 }];
  const visited = new Set<string>();
  const stacks = new Map<string, number>();

  const laneIndex = (lane?: string) => {
    const index = laneNames.indexOf(lane || laneNames[0]);
    return index >= 0 ? index : 0;
  };

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    const node = nodeMap.get(current.id);
    if (!node) continue;

    const currentLane = laneIndex(node.lane);
    const key = `${current.depth}:${currentLane}`;
    const stack = stacks.get(key) || 0;
    stacks.set(key, stack + 1);

    const laneCenter = 230 + currentLane * 420;
    node.x = laneCenter - node.width / 2;
    node.y = 110 + current.depth * 150 + stack * 24;

    (nextById.get(current.id) || []).forEach((edge) => queue.push({ id: edge.toId, depth: current.depth + 1 }));
  }

  return Array.from(nodeMap.values());
}

function layoutUseCase(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const mapped = nodes.map((node) => ({ ...node, pinned: true, offsetX: 0, offsetY: 0 }));
  const usecases = mapped.filter((node) => node.type === "usecase");
  const actors = mapped.filter((node) => node.type === "actor");
  const nodeById = new Map(mapped.map((node) => [node.id, node]));

  usecases.forEach((node, index) => {
    node.x = 500 - node.width / 2;
    node.y = 130 + index * 116;
  });

  actors.forEach((node, index) => {
    const side = node.side === "right" ? "right" : "left";
    const connected = edges.filter((edge) => edge.fromId === node.id || edge.toId === node.id);
    const connectedUseCases = usecases.filter((item) => connected.some((edge) => edge.fromId === item.id || edge.toId === item.id));
    const avgY = connectedUseCases.length
      ? connectedUseCases.reduce((sum, item) => sum + ((nodeById.get(item.id)?.y || item.y) + item.height / 2), 0) / connectedUseCases.length
      : 180 + index * 120;
    node.x = side === "right" ? 860 : 140;
    node.y = avgY - node.height / 2;
  });

  return mapped;
}

function layoutSequence(nodes: DiagramNode[]) {
  const participants = nodes.filter((node) => node.type === "lifeline");
  const gap = Math.max(190, Math.floor(980 / Math.max(participants.length, 1)));
  return nodes.map((node) => {
    if (node.type !== "lifeline") return { ...node, pinned: true, offsetX: 0, offsetY: 0 };
    const index = participants.findIndex((item) => item.id === node.id);
    return {
      ...node,
      x: 110 + index * gap,
      y: 70,
      pinned: true,
      offsetX: 0,
      offsetY: 0,
    };
  });
}

export function autoLayoutDiagram(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  diagramType: SupportedDiagramType,
  lanes: string[] = [],
) {
  if (diagramType === "flowchart") return layoutFlowchart(nodes, edges);
  if (diagramType === "activity") return layoutActivity(nodes, edges, lanes);
  if (diagramType === "usecase") return layoutUseCase(nodes, edges);
  if (diagramType === "sequence") return layoutSequence(nodes);
  return nodes.map((node) => ({ ...node }));
}

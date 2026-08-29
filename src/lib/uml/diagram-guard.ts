import type { DiagramEdge, DiagramNode } from "../types/diagram";

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

const GENERIC_PROMPT_WORDS = new Set([
  "activity",
  "alur",
  "and",
  "aplikasi",
  "atau",
  "buat",
  "dalam",
  "dan",
  "dari",
  "diagram",
  "flow",
  "flowchart",
  "ini",
  "ke",
  "of",
  "pada",
  "proses",
  "sequence",
  "sistem",
  "the",
  "untuk",
  "uml",
  "use",
  "usecase",
  "yang",
]);

function normalizedDomainWords(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((word) => word.replace(/(nya|kan|an)$/i, ""))
    .filter((word) => word.length >= 4 && !GENERIC_PROMPT_WORDS.has(word));
}

function findDuplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return Array.from(duplicates);
}

function appendPromptCoverageWarning(
  warnings: string[],
  promptContext: string,
  diagramText: string,
) {
  const promptWords = Array.from(new Set(normalizedDomainWords(promptContext))).slice(0, 14);
  if (promptWords.length < 2) return;

  const diagramWords = new Set(normalizedDomainWords(diagramText));
  const matchedWords = promptWords.filter((word) => diagramWords.has(word));
  if (matchedWords.length === 0) {
    warnings.push(
      "Istilah inti dari kebutuhan pengguna belum terlihat pada judul atau elemen diagram. Periksa kembali kesesuaian konteks sebelum memakai hasil.",
    );
  }
}

export function validateSpec(spec: CompactSpecLike, diagramType: SupportedDiagramType, promptContext = ""): DiagramValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (diagramType === "usecase") {
    const actors = spec.actors || [];
    const usecases = spec.usecases || [];
    if (actors.length < 1) errors.push("Diagram use case wajib punya minimal satu aktor.");
    if (usecases.length < 1) errors.push("Diagram use case wajib punya minimal satu use case.");
    if (actors.length > 6) errors.push("Diagram use case maksimal enam aktor agar tetap terbaca.");
    if (usecases.length > 10) errors.push("Diagram use case maksimal sepuluh use case agar tetap terbaca.");

    const duplicateActorIds = findDuplicates(actors.map((actor) => actor.id));
    const duplicateUsecaseIds = findDuplicates(usecases.map((usecase) => usecase.id));
    if (duplicateActorIds.length) errors.push(`ID aktor duplikat: ${duplicateActorIds.join(", ")}.`);
    if (duplicateUsecaseIds.length) errors.push(`ID use case duplikat: ${duplicateUsecaseIds.join(", ")}.`);

    const actorIds = new Set(actors.map((actor) => actor.id));
    actors.forEach((actor, index) => {
      if (!actor.id.trim()) errors.push(`Aktor ke-${index + 1} belum punya ID.`);
      if (!actor.name.trim()) errors.push(`Aktor ke-${index + 1} belum punya nama.`);
    });
    usecases.forEach((usecase) => {
      if (!usecase.id.trim()) errors.push(`Use case ${usecase.text || "(tanpa nama)"} belum punya ID.`);
      if (!usecase.text.trim()) errors.push(`Use case ${usecase.id || "(tanpa ID)"} belum punya label.`);
      if (!usecase.actors || usecase.actors.length === 0) {
        errors.push(`Use case ${usecase.text} belum terhubung ke aktor.`);
      }
      const unknownActors = (usecase.actors || []).filter((actorId) => !actorIds.has(actorId));
      if (unknownActors.length) {
        errors.push(`Use case ${usecase.text} mengarah ke aktor yang tidak ada: ${unknownActors.join(", ")}.`);
      }
      const duplicateActors = findDuplicates(usecase.actors || []);
      if (duplicateActors.length) {
        warnings.push(`Use case ${usecase.text} memiliki relasi aktor duplikat.`);
      }
    });

    const usedActors = new Set(usecases.flatMap((usecase) => usecase.actors || []));
    actors.filter((actor) => !usedActors.has(actor.id)).forEach((actor) => {
      warnings.push(`Aktor ${actor.name} belum terhubung ke use case mana pun.`);
    });
    appendPromptCoverageWarning(
      warnings,
      promptContext,
      [spec.title, ...actors.map((actor) => actor.name), ...usecases.map((usecase) => usecase.text)].filter(Boolean).join(" "),
    );
    return { ok: errors.length === 0, errors, warnings };
  }

  if (diagramType === "sequence") {
    const participants = spec.participants || [];
    const messages = spec.messages || [];
    if (participants.length < 2) errors.push("Sequence diagram wajib punya minimal dua participant.");
    if (participants.length > 6) errors.push("Sequence diagram maksimal enam participant agar tetap rapi.");
    if (messages.length < 4) errors.push("Sequence diagram wajib punya minimal empat message agar interaksi utamanya utuh.");
    if (messages.length > 12) errors.push("Sequence diagram maksimal dua belas message agar tetap terbaca.");

    const duplicateParticipantIds = findDuplicates(participants.map((participant) => participant.id));
    if (duplicateParticipantIds.length) {
      errors.push(`ID participant duplikat: ${duplicateParticipantIds.join(", ")}.`);
    }

    const participantIds = new Set(participants.map((participant) => participant.id));
    participants.forEach((participant, index) => {
      if (!participant.id.trim()) errors.push(`Participant ke-${index + 1} belum punya ID.`);
      if (!participant.name.trim()) errors.push(`Participant ke-${index + 1} belum punya nama.`);
    });
    messages.forEach((message, index) => {
      if (!participantIds.has(message.from)) {
        errors.push(`Message ke-${index + 1} berasal dari participant yang tidak ada: ${message.from}.`);
      }
      if (!participantIds.has(message.to)) {
        errors.push(`Message ke-${index + 1} menuju participant yang tidak ada: ${message.to}.`);
      }
      if (!message.text.trim()) errors.push(`Message ke-${index + 1} belum punya label.`);
      if (message.from === message.to) {
        errors.push(`Message ke-${index + 1} tidak boleh mengarah ke participant yang sama.`);
      }
    });

    const involvedParticipants = new Set(messages.flatMap((message) => [message.from, message.to]));
    participants.filter((participant) => !involvedParticipants.has(participant.id)).forEach((participant) => {
      warnings.push(`Participant ${participant.name} belum terlibat dalam message mana pun.`);
    });
    if (messages.length >= 4 && !messages.some((message) => message.return)) {
      warnings.push("Sequence diagram belum menunjukkan respons atau return dari proses.");
    }
    appendPromptCoverageWarning(
      warnings,
      promptContext,
      [spec.title, ...participants.map((participant) => participant.name), ...messages.map((message) => message.text)].filter(Boolean).join(" "),
    );
    return { ok: errors.length === 0, errors, warnings };
  }

  const steps = spec.steps || [];
  const duplicateStepIds = findDuplicates(steps.map((step) => step.id));
  if (duplicateStepIds.length) errors.push(`ID langkah duplikat: ${duplicateStepIds.join(", ")}.`);
  const ids = new Set(steps.map((step) => step.id));
  const stepMap = new Map(steps.map((step) => [step.id, step]));
  const starts = steps.filter((step) => step.type === "start");
  const ends = steps.filter((step) => step.type === "end");

  if (steps.length < 4) errors.push("Diagram alur terlalu pendek. Minimal empat langkah.");
  if (steps.length > 18) errors.push("Diagram alur terlalu panjang. Pecah menjadi beberapa diagram agar tetap terbaca.");
  if (starts.length !== 1) errors.push("Flowchart/activity wajib punya tepat satu start.");
  if (ends.length < 1) errors.push("Flowchart/activity wajib punya minimal satu end.");

  const incomingCounts = new Map<string, number>();
  steps.forEach((step, index) => {
    if (!step.id.trim()) errors.push(`Langkah ke-${index + 1} belum punya ID.`);
    if (!step.text.trim()) errors.push(`Langkah ${step.id || `ke-${index + 1}`} belum punya label.`);
    if (step.type === "start" && !step.next) {
      errors.push("Start wajib langsung menuju langkah berikutnya.");
    }

    if (step.type === "decision") {
      if (!step.yes || !ids.has(step.yes)) errors.push(`Decision ${step.text} belum punya cabang ya yang valid.`);
      if (!step.no || !ids.has(step.no)) errors.push(`Decision ${step.text} belum punya cabang tidak yang valid.`);
      if (step.yes && step.no && step.yes === step.no) errors.push(`Decision ${step.text} tidak boleh punya cabang ya dan tidak ke langkah yang sama.`);
      if (!/[?]$/.test(step.text) && !/apakah|valid|tersedia|sesuai|cukup|berhasil/i.test(step.text)) {
        warnings.push(`Decision ${step.text} sebaiknya berupa pertanyaan yang eksplisit.`);
      }
    } else if (step.type === "end") {
      if (step.next || step.yes || step.no) {
        errors.push(`End ${step.text} tidak boleh punya koneksi keluar.`);
      }
    } else if (step.type !== "end") {
      if (!step.next || !ids.has(step.next)) errors.push(`Langkah ${step.text} belum punya next yang valid.`);
    }

    if (step.next === step.id || step.yes === step.id || step.no === step.id) {
      errors.push(`Langkah ${step.text} tidak boleh mengarah ke dirinya sendiri.`);
    }

    [step.next, step.yes, step.no].filter(Boolean).forEach((target) => {
      if (!target || !ids.has(target)) return;
      incomingCounts.set(target, (incomingCounts.get(target) || 0) + 1);
    });
  });

  const start = starts[0];
  if (start) {
    if ((incomingCounts.get(start.id) || 0) > 0) {
      errors.push("Start tidak boleh memiliki koneksi masuk.");
    }

    const reachable = new Set<string>();
    const queue = [start.id];
    let guard = 0;

    while (queue.length && guard < steps.length * 6) {
      const currentId = queue.shift();
      if (!currentId || reachable.has(currentId)) continue;
      reachable.add(currentId);
      const current = stepMap.get(currentId);
      if (!current) continue;

      [current.next, current.yes, current.no].filter(Boolean).forEach((target) => {
        if (target && ids.has(target)) queue.push(target);
      });
      guard += 1;
    }

    const unreachable = steps.filter((step) => !reachable.has(step.id));
    if (unreachable.length) {
      errors.push(`Ada langkah yang tidak terhubung dari start: ${unreachable.slice(0, 3).map((step) => step.text).join(", ")}.`);
    }

    const reachesEnd = (fromId: string, seen = new Set<string>(), depth = 0): boolean => {
      if (depth > steps.length + 2 || seen.has(fromId)) return false;
      const current = stepMap.get(fromId);
      if (!current) return false;
      if (current.type === "end") return true;
      const nextSeen = new Set(seen);
      nextSeen.add(fromId);
      const targets = [current.next, current.yes, current.no].filter(Boolean) as string[];
      return targets.some((target) => reachesEnd(target, nextSeen, depth + 1));
    };

    steps.filter((step) => reachable.has(step.id) && step.type !== "end").forEach((step) => {
      if (!reachesEnd(step.id)) {
        errors.push(`Langkah ${step.text} tidak memiliki jalur menuju akhir proses.`);
      }
    });
  }

  if (diagramType === "activity") {
    const lanes = spec.lanes || [];
    if (lanes.length < 2) {
      errors.push("Activity diagram wajib punya minimal dua lane agar tanggung jawab aktor dan sistem jelas.");
    }
    if (lanes.length > 5) errors.push("Activity diagram maksimal lima lane agar tetap terbaca.");
    const duplicateLanes = findDuplicates(lanes);
    if (duplicateLanes.length) errors.push(`Nama lane duplikat: ${duplicateLanes.join(", ")}.`);
    const knownLanes = new Set(lanes);
    steps.forEach((step) => {
      if (!step.lane || !knownLanes.has(step.lane)) {
        errors.push(`Langkah ${step.text} belum ditempatkan pada lane yang valid.`);
      }
    });

    const normalizedPrompt = promptContext.toLowerCase();
    const stepText = steps.map((step) => step.text.toLowerCase()).join(" ");
    if (/login|masuk|autentikasi/.test(normalizedPrompt)) {
      if (!/username|password|kredensial|login/.test(stepText)) warnings.push("Alur login sebaiknya memuat langkah input kredensial atau aksi login yang jelas.");
      if (!/valid|verifikasi|cek/.test(stepText)) warnings.push("Alur login sebaiknya memuat proses validasi kredensial oleh sistem.");
      if (!/dashboard|beranda|sesi|akses/.test(stepText)) warnings.push("Alur login sebaiknya menunjukkan hasil akhir seperti sesi aktif atau dashboard.");
    }
  }

  const duplicateLabels = findDuplicates(
    steps.map((step) => step.text.trim().toLowerCase()).filter(Boolean),
  );
  if (duplicateLabels.length) {
    warnings.push("Ada label langkah yang berulang; pastikan setiap simbol mewakili aksi yang berbeda.");
  }
  appendPromptCoverageWarning(
    warnings,
    promptContext,
    [spec.title, ...(spec.lanes || []), ...steps.map((step) => step.text)].filter(Boolean).join(" "),
  );

  return { ok: errors.length === 0, errors, warnings };
}

export function validateDiagramData(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  diagramType: SupportedDiagramType,
): DiagramValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const duplicateNodeIds = findDuplicates(nodes.map((node) => node.id));
  const duplicateEdgeIds = findDuplicates(edges.map((edge) => edge.id));

  if (duplicateNodeIds.length) errors.push(`ID node render duplikat: ${duplicateNodeIds.join(", ")}.`);
  if (duplicateEdgeIds.length) errors.push(`ID edge render duplikat: ${duplicateEdgeIds.join(", ")}.`);

  nodes.forEach((node) => {
    const coordinates = [node.x, node.y, node.width, node.height];
    if (coordinates.some((value) => !Number.isFinite(value))) {
      errors.push(`Node ${node.text || node.id} memiliki koordinat atau ukuran yang tidak valid.`);
    }
    if (node.width <= 0 || node.height <= 0) {
      errors.push(`Node ${node.text || node.id} memiliki ukuran nol atau negatif.`);
    }
    if (node.x < 0 || node.y < 0) {
      warnings.push(`Node ${node.text || node.id} berada di luar area kanvas positif.`);
    }
  });

  const edgePairs = new Set<string>();
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.fromId)) errors.push(`Edge ${edge.id} berasal dari node yang tidak ada: ${edge.fromId}.`);
    if (!nodeIds.has(edge.toId)) errors.push(`Edge ${edge.id} menuju node yang tidak ada: ${edge.toId}.`);
    if (edge.fromId === edge.toId) errors.push(`Edge ${edge.id} tidak boleh menghubungkan node ke dirinya sendiri.`);
    const pair = `${edge.fromId}->${edge.toId}:${(edge.label || "").trim().toLowerCase()}`;
    if (edgePairs.has(pair)) warnings.push(`Relasi render duplikat ditemukan: ${edge.fromId} ke ${edge.toId}.`);
    edgePairs.add(pair);
  });

  if (diagramType !== "sequence") {
    const collisionPadding = diagramType === "usecase" ? 10 : 16;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const overlaps = (
          left.x + left.width + collisionPadding > right.x
          && right.x + right.width + collisionPadding > left.x
          && left.y + left.height + collisionPadding > right.y
          && right.y + right.height + collisionPadding > left.y
        );
        if (overlaps) {
          warnings.push(`Node ${left.text} dan ${right.text} berpotensi bertumpuk.`);
        }
      }
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
      const rank = (edge: DiagramEdge) => {
        const label = edge.label?.toLowerCase();
        if (label === "ya" || label === "yes") return 0;
        if (label === "tidak" || label === "no") return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });

    outgoing.forEach((edge, index) => {
      const label = edge.label?.toLowerCase();
      const shift = label === "ya" || label === "yes"
        ? 1
        : label === "tidak" || label === "no"
          ? -1
          : index - Math.floor(outgoing.length / 2);
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
  const queue: Array<{ id: string; depth: number; bias: number }> = [{ id: startNode.id, depth: 0, bias: 0 }];
  const placed = new Set<string>();
  const stacks = new Map<string, number>();

  const laneIndex = (lane?: string) => {
    const index = laneNames.indexOf(lane || laneNames[0]);
    return index >= 0 ? index : 0;
  };

  while (queue.length) {
    const current = queue.shift();
    if (!current || placed.has(current.id)) continue;
    placed.add(current.id);
    const node = nodeMap.get(current.id);
    if (!node) continue;

    const currentLane = laneIndex(node.lane);
    const key = `${current.depth}:${currentLane}:${Math.max(-2, Math.min(2, current.bias))}`;
    const stack = stacks.get(key) || 0;
    stacks.set(key, stack + 1);

    const laneCenter = 230 + currentLane * 420;
    const branchShift = Math.max(-120, Math.min(120, current.bias * 110));
    node.x = laneCenter + branchShift - node.width / 2;
    node.y = 110 + current.depth * 150 + stack * 28;

    const outgoing = (nextById.get(current.id) || []).sort((a, b) => {
      const labelA = a.label?.toLowerCase();
      const labelB = b.label?.toLowerCase();
      const rank = (label?: string) => label === "ya" || label === "yes" ? 0 : label === "tidak" || label === "no" ? 1 : 2;
      return rank(labelA) - rank(labelB);
    });

    outgoing.forEach((edge, index) => {
      const label = edge.label?.toLowerCase();
      const nextBias = label === "ya" || label === "yes"
        ? current.bias + 1
        : label === "tidak" || label === "no"
          ? current.bias - 1
          : current.bias + index - Math.floor(outgoing.length / 2);
      queue.push({ id: edge.toId, depth: current.depth + 1, bias: Math.max(-1, Math.min(1, nextBias)) });
    });
  }

  return Array.from(nodeMap.values());
}

function layoutUseCase(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const mapped = nodes.map((node) => ({ ...node, pinned: true, offsetX: 0, offsetY: 0 }));
  const usecases = mapped.filter((node) => node.type === "usecase");
  const actors = mapped.filter((node) => node.type === "actor");
  const nodeById = new Map(mapped.map((node) => [node.id, node]));

  let nextUsecaseY = 130;
  usecases.forEach((node) => {
    node.x = 500 - node.width / 2;
    node.y = nextUsecaseY;
    nextUsecaseY += node.height + 44;
  });

  const desiredActorPositions = actors.map((node, index) => {
    const side = node.side === "right" ? "right" : "left";
    const connected = edges.filter((edge) => edge.fromId === node.id || edge.toId === node.id);
    const connectedUseCases = usecases.filter((item) => connected.some((edge) => edge.fromId === item.id || edge.toId === item.id));
    const avgY = connectedUseCases.length
      ? connectedUseCases.reduce((sum, item) => sum + ((nodeById.get(item.id)?.y || item.y) + item.height / 2), 0) / connectedUseCases.length
      : 180 + index * 120;
    return { node, side, desiredY: Math.max(100, avgY - node.height / 2) };
  });

  (["left", "right"] as const).forEach((side) => {
    let cursorY = 100;
    desiredActorPositions
      .filter((item) => item.side === side)
      .sort((left, right) => left.desiredY - right.desiredY)
      .forEach(({ node, desiredY }) => {
        node.x = side === "right" ? 870 : 90;
        node.y = Math.max(desiredY, cursorY);
        cursorY = node.y + node.height + 32;
      });
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

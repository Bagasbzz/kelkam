export type NodeType =
  | 'start' | 'end' | 'process' | 'decision' | 'actor' | 'usecase' | 'system' | 'activity' | 'fork' | 'join' | 'lifeline'
  // Elemen pendukung sequence diagram (posisinya mengikuti lifeline di attachTo).
  | 'activation' | 'fragment' | 'note' | 'ref'
  | 'class' | 'state' | 'initial' | 'final' | 'entity' | 'component' | 'interface' | 'device' | 'execution' | 'artifact';

export type RelationKind = 'association' | 'inheritance' | 'realization' | 'aggregation' | 'composition' | 'dependency' | 'transition' | 'communication';

/** Jenis participant sequence (notasi UML / Robustness). */
export type ParticipantKind = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database';

/** Jenis pesan sequence. */
export type MessageKind = 'sync' | 'async' | 'return' | 'create' | 'destroy';

/** Operator combined fragment. */
export type FragmentKind = 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical';

export interface FragmentOperand {
  /** Guard, mis. "[saldo cukup]" (tanpa kurung pun boleh). */
  guard: string;
  /** y garis pemisah operand (operand pertama = tepi atas fragment). */
  y: number;
}

export interface DiagramNode {
  id: string;
  type: NodeType;
  text: string;
  lines: string[];
  lane?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  yes?: string;
  no?: string;
  // Use Case specific
  side?: 'left' | 'right' | 'center';
  offsetX?: number;
  offsetY?: number;
  // Manual interaction
  pinned?: boolean;
  // Sequence specific
  /** Lifeline: bentuk kepala participant. */
  participantKind?: ParticipantKind;
  /** Lifeline: dibuat oleh pesan «create» (kepala tidak di baris atas). */
  created?: boolean;
  /** Lifeline: diakhiri tanda X (destroy) di ujung bawah garis. */
  destroyed?: boolean;
  /** activation/note/ref/fragment: lifeline yang ditempeli (x ikut lifeline saat dirapikan). */
  attachTo?: string[];
  /** activation: tingkat bersarang (0 = bar pertama). */
  depth?: number;
  /** fragment: jenis operator (alt/opt/loop/…) */
  fragmentKind?: FragmentKind;
  /** fragment: operand + guard; operand ke-2 dst. digambar dengan garis putus-putus. */
  operands?: FragmentOperand[];
  attributes?: string[];
  operations?: string[];
  stereotype?: string;
  parentId?: string;
}

export interface DiagramEdge {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  dashed?: boolean;
  // Direction hint: which side the edge exits from on the source node
  direction?: 'right' | 'left' | 'bottom' | 'straight';
  // Sequence diagram message height
  y?: number;
  /** Jenis pesan sequence; kosong = sync (atau return bila dashed). */
  kind?: MessageKind;
  relation?: RelationKind;
  fromCardinality?: string;
  toCardinality?: string;
}

export const DIAGRAM_TYPES = ['flowchart', 'usecase', 'sequence', 'activity', 'class', 'state', 'erd', 'component', 'deployment'] as const;
export type DiagramType = typeof DIAGRAM_TYPES[number];
export const isDiagramType = (value: unknown): value is DiagramType => typeof value === 'string' && (DIAGRAM_TYPES as readonly string[]).includes(value);

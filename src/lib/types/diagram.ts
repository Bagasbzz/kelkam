export type NodeType = 'start' | 'end' | 'process' | 'decision' | 'actor' | 'usecase' | 'system' | 'activity' | 'fork' | 'join';

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
}

export interface DiagramEdge {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  dashed?: boolean;
  // Direction hint: which side the edge exits from on the source node
  direction?: 'right' | 'left' | 'bottom' | 'straight';
}

export type DiagramType = 'flowchart' | 'usecase' | 'class' | 'sequence' | 'activity' | 'state';

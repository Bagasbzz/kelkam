import React from 'react';
import { DiagramEdge, DiagramNode } from '@/lib/types/diagram';
import { routeEdge, type PlacedLabel } from '@/lib/uml/edge-route';
import { messageKind } from '@/lib/uml/sequence';
import {
  EDGE_DASH,
  EDGE_DASHED_STROKE,
  EDGE_STROKE,
  EDGE_STROKE_WIDTH,
  FONT_FAMILY,
  LABEL_BORDER,
} from '@/lib/uml/theme';

interface EdgeProps {
  edge: DiagramEdge;
  fromNode: DiagramNode;
  toNode: DiagramNode;
  nodes?: DiagramNode[];
}

interface EdgeLabelProps {
  edge: DiagramEdge;
  fromNode: DiagramNode;
  toNode: DiagramNode;
  nodes?: DiagramNode[];
}

function LabelBox({ label }: { label: PlacedLabel }) {
  const firstY = -((label.lines.length - 1) * label.lineHeight) / 2;
  return (
    <g transform={`translate(${label.x}, ${label.y})`} style={{ pointerEvents: 'none' }}>
      <rect
        x={-label.width / 2}
        y={-label.height / 2}
        width={label.width}
        height={label.height}
        fill="white"
        rx={3}
        opacity={0.98}
        stroke={LABEL_BORDER}
        strokeWidth="1"
      />
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontSize: `${label.fontSize}px`,
          fontWeight: label.fontWeight,
          fill: EDGE_STROKE,
          fontFamily: FONT_FAMILY,
          letterSpacing: 0,
        }}
      >
        {label.lines.map((line, index) => (
          <tspan key={index} x={0} dy={index === 0 ? firstY : label.lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/**
 * Garis edge. Routing dihitung oleh edge-route.ts (sama dengan render-svg.ts)
 * supaya tampilan editor = gambar di laporan. Marker panah didefinisikan sekali
 * di DiagramCanvas.
 */
const Edge: React.FC<EdgeProps> = ({ edge, fromNode, toNode, nodes }) => {
  const route = routeEdge(edge, fromNode, toNode, nodes);
  const dashed = Boolean(edge.dashed) || ['return', 'create'].includes(messageKind(edge)) || ['dependency', 'realization'].includes(edge.relation ?? '');
  return (
    <g className="edge-group">
      <path d={route.path} fill="none" stroke="transparent" strokeWidth="12" />
      <path
        d={route.path}
        fill="none"
        stroke={dashed ? EDGE_DASHED_STROKE : EDGE_STROKE}
        strokeWidth={EDGE_STROKE_WIDTH}
        strokeDasharray={dashed ? EDGE_DASH : 'none'}
        markerStart={route.startMarker ? `url(#${route.startMarker})` : undefined}
        markerEnd={route.endMarker === 'none' ? undefined : `url(#${route.endMarker === 'inheritance' ? 'inheritance' : route.marker === 'open' ? 'arrowhead-open' : dashed ? 'arrowhead-dashed' : 'arrowhead'})`}
      />
    </g>
  );
};

/** Label edge, dirender di atas node (urutan sama dengan render-svg.ts). */
export const EdgeLabel: React.FC<EdgeLabelProps> = ({ edge, fromNode, toNode, nodes }) => {
  const { label, cardinalities } = routeEdge(edge, fromNode, toNode, nodes);
  return <g>{label && <LabelBox label={label} />}{cardinalities?.map((c, i) => <text key={i} x={c.x} y={c.y} textAnchor="middle" fill={EDGE_STROKE} fontSize={15} fontFamily={FONT_FAMILY} stroke="white" strokeWidth={4} paintOrder="stroke">{c.text}</text>)}</g>;
};

export default Edge;

import React from 'react';
import { DiagramEdge, DiagramNode } from '@/lib/types/diagram';

interface EdgeProps {
  edge: DiagramEdge;
  fromNode: DiagramNode;
  toNode: DiagramNode;
}

const PRIMARY_STROKE = '#334155';
const DASHED_STROKE = '#94a3b8';
const GRID_STEP = 4;

function snap(value: number) {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function getExitPoint(node: DiagramNode, side: 'right' | 'left' | 'bottom' | 'top' | 'center') {
  const x = node.x + (node.offsetX || 0);
  const y = node.y + (node.offsetY || 0);
  const cx = x + node.width / 2;
  const cy = y + node.height / 2;

  switch (side) {
    case 'right':
      return { x: x + node.width, y: cy };
    case 'left':
      return { x, y: cy };
    case 'bottom':
      return { x: cx, y: y + node.height };
    case 'top':
      return { x: cx, y };
    default:
      return { x: cx, y: cy };
  }
}

function renderLabel(label: string, x: number, y: number, prominent = false) {
  const width = prominent ? 168 : Math.max(54, Math.min(116, label.length * 7.2 + 18));
  const height = 20;
  return (
    <g transform={`translate(${snap(x)}, ${snap(y)})`}>
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        fill="white"
        rx={3}
        opacity={0.98}
        stroke="#cbd5e1"
        strokeWidth="1"
      />
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontSize: '11px',
          fontWeight: prominent ? 700 : 600,
          fill: '#334155',
          fontFamily: 'Inter, sans-serif',
          letterSpacing: 0,
        }}
      >
        {label}
      </text>
    </g>
  );
}

const Edge: React.FC<EdgeProps> = ({ edge, fromNode, toNode }) => {
  const isUseCase =
    fromNode.type === 'actor' ||
    toNode.type === 'actor' ||
    fromNode.type === 'usecase' ||
    toNode.type === 'usecase';

  let pathData = '';
  let labelX = 0;
  let labelY = 0;

  if (fromNode.type === 'lifeline' && toNode.type === 'lifeline' && typeof edge.y === 'number') {
    const fromCenterX = snap(fromNode.x + (fromNode.offsetX || 0) + fromNode.width / 2);
    const toCenterX = snap(toNode.x + (toNode.offsetX || 0) + toNode.width / 2);
    const y = snap(edge.y);
    pathData = `M ${fromCenterX},${y} H ${toCenterX}`;
    labelX = (fromCenterX + toCenterX) / 2;
    labelY = y - 14;

    const strokeColor = edge.dashed ? DASHED_STROKE : PRIMARY_STROKE;
    const markerId = edge.dashed ? 'arrowhead-dashed' : 'arrowhead';

    return (
      <g className="edge-group">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={PRIMARY_STROKE} />
          </marker>
          <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={DASHED_STROKE} />
          </marker>
        </defs>
        <path d={pathData} fill="none" stroke="transparent" strokeWidth="14" />
        <path
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.4"
          strokeDasharray={edge.dashed ? '6,5' : 'none'}
          markerEnd={`url(#${markerId})`}
        />
        {edge.label ? renderLabel(edge.label, labelX, labelY, true) : null}
      </g>
    );
  }

  if (isUseCase) {
    const fx = snap(fromNode.x + (fromNode.offsetX || 0) + fromNode.width / 2);
    const fy = snap(fromNode.y + (fromNode.offsetY || 0) + fromNode.height / 2);
    const tx = snap(toNode.x + (toNode.offsetX || 0) + toNode.width / 2);
    const ty = snap(toNode.y + (toNode.offsetY || 0) + toNode.height / 2);
    pathData = `M ${fx},${fy} L ${tx},${ty}`;
    labelX = (fx + tx) / 2;
    labelY = (fy + ty) / 2 - 12;
  } else {
    const dir = edge.direction;
    const fromBottom = getExitPoint(fromNode, 'bottom');
    const toTop = getExitPoint(toNode, 'top');
    const fromRight = getExitPoint(fromNode, 'right');
    const fromLeft = getExitPoint(fromNode, 'left');
    const toLeft = getExitPoint(toNode, 'left');
    const toRight = getExitPoint(toNode, 'right');

    const x1 = snap(fromBottom.x);
    const y1 = snap(fromBottom.y);
    const x2 = snap(toTop.x);
    const y2 = snap(toTop.y);

    const upwardOrLoop = y2 <= y1 + 24;

    if (dir === 'right') {
      const startX = snap(fromRight.x);
      const startY = snap(fromRight.y);
      const endX = snap((toNode.x + (toNode.offsetX || 0)) < startX ? toTop.x : toLeft.x);
      const endY = snap((toNode.x + (toNode.offsetX || 0)) < startX ? toTop.y : toLeft.y);
      const bendX = snap(startX + Math.max(48, Math.min(96, Math.abs(endX - startX) / 2)));

      pathData = `M ${startX},${startY} H ${bendX} V ${endY} H ${endX}`;
      labelX = (startX + bendX) / 2;
      labelY = startY - 12;
    } else if (dir === 'left') {
      const startX = snap(fromLeft.x);
      const startY = snap(fromLeft.y);
      const endX = snap((toNode.x + (toNode.offsetX || 0) + toNode.width) > startX ? toTop.x : toRight.x);
      const endY = snap((toNode.x + (toNode.offsetX || 0) + toNode.width) > startX ? toTop.y : toRight.y);
      const bendX = snap(startX - Math.max(48, Math.min(96, Math.abs(endX - startX) / 2)));

      pathData = `M ${startX},${startY} H ${bendX} V ${endY} H ${endX}`;
      labelX = (startX + bendX) / 2;
      labelY = startY - 12;
    } else if (upwardOrLoop) {
      const horizontalGap = Math.abs(x2 - x1);
      const routeX = snap(Math.max(x1, x2) + Math.max(92, Math.min(148, horizontalGap / 2 + 48)));
      const departureY = snap(y1 + 28);
      const approachY = snap(y2 - 24);

      pathData = `M ${x1},${y1} V ${departureY} H ${routeX} V ${approachY} H ${x2} V ${y2}`;
      labelX = routeX + 8;
      labelY = (departureY + approachY) / 2;
    } else if (Math.abs(x1 - x2) <= 8) {
      pathData = `M ${x1},${y1} V ${y2}`;
      labelX = x1 + 10;
      labelY = y1 + (y2 - y1) / 2;
    } else {
      const midY = snap(y1 + (y2 - y1) / 2);
      pathData = `M ${x1},${y1} V ${midY} H ${x2} V ${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = midY - 12;
    }
  }

  const strokeColor = edge.dashed ? DASHED_STROKE : PRIMARY_STROKE;
  const markerId = edge.dashed ? 'arrowhead-dashed' : 'arrowhead';

  return (
    <g className="edge-group">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill={PRIMARY_STROKE} />
        </marker>
        <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill={DASHED_STROKE} />
        </marker>
      </defs>

      <path d={pathData} fill="none" stroke="transparent" strokeWidth="12" />

      <path
        d={pathData}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2.4"
        strokeDasharray={edge.dashed ? '5,5' : 'none'}
        markerEnd={`url(#${markerId})`}
      />

      {edge.label ? renderLabel(edge.label, labelX, labelY) : null}
    </g>
  );
};

export default Edge;

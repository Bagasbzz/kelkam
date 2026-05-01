import React from 'react';
import { DiagramEdge, DiagramNode } from '@/lib/types/diagram';

interface EdgeProps {
  edge: DiagramEdge;
  fromNode: DiagramNode;
  toNode: DiagramNode;
}

function getExitPoint(node: DiagramNode, side: 'right' | 'left' | 'bottom' | 'top' | 'center') {
  const x = node.x + (node.offsetX || 0);
  const y = node.y + (node.offsetY || 0);
  const cx = x + node.width / 2;
  const cy = y + node.height / 2;

  switch (side) {
    case 'right':  return { x: x + node.width, y: cy };
    case 'left':   return { x: x,               y: cy };
    case 'bottom': return { x: cx,               y: y + node.height };
    case 'top':    return { x: cx,               y: y };
    default:       return { x: cx,               y: cy };
  }
}

const Edge: React.FC<EdgeProps> = ({ edge, fromNode, toNode }) => {
  const isUseCase =
    fromNode.type === 'actor' || toNode.type === 'actor' ||
    fromNode.type === 'usecase' || toNode.type === 'usecase';

  let pathData = '';
  let labelX = 0;
  let labelY = 0;

  if (isUseCase) {
    const fx = fromNode.x + (fromNode.offsetX || 0) + fromNode.width / 2;
    const fy = fromNode.y + (fromNode.offsetY || 0) + fromNode.height / 2;
    const tx = toNode.x + (toNode.offsetX || 0) + toNode.width / 2;
    const ty = toNode.y + (toNode.offsetY || 0) + toNode.height / 2;
    pathData = `M ${fx},${fy} L ${tx},${ty}`;
    labelX = (fx + tx) / 2;
    labelY = (fy + ty) / 2;
  } else {
    const dir = edge.direction;

    const fromBottom = getExitPoint(fromNode, 'bottom');
    const toTop = getExitPoint(toNode, 'top');

    const fY = fromNode.y + (fromNode.offsetY || 0);
    const tY = toNode.y + (toNode.offsetY || 0);
    const isLoopBack = tY <= fY + 20;

    if (dir === 'right') {
      const fromRight = getExitPoint(fromNode, 'right');
      const toTopPt = getExitPoint(toNode, 'top');
      const bendX = Math.max(fromRight.x + 40, toTopPt.x);
      pathData = `M ${fromRight.x},${fromRight.y} H ${bendX} V ${toTopPt.y} H ${toTopPt.x} V ${toTopPt.y}`;
      labelX = fromRight.x + 25;
      labelY = fromRight.y - 12;

    } else if (dir === 'left') {
      const fromLeft = getExitPoint(fromNode, 'left');
      const toTopPt = getExitPoint(toNode, 'top');
      const bendX = Math.min(fromLeft.x - 40, toTopPt.x);
      pathData = `M ${fromLeft.x},${fromLeft.y} H ${bendX} V ${toTopPt.y} H ${toTopPt.x} V ${toTopPt.y}`;
      labelX = fromLeft.x - 25;
      labelY = fromLeft.y - 12;

    } else if (isLoopBack) {
      const loopOffset = 180;
      const x1 = fromBottom.x;
      const y1 = fromBottom.y;
      const x2 = toTop.x;
      const y2 = toTop.y;
      const outerX = Math.max(x1, x2) + loopOffset;
      pathData = `M ${x1},${y1} V ${y1 + 30} H ${outerX} V ${y2 - 20} H ${x2} V ${y2}`;
      labelX = outerX + 5;
      labelY = (y1 + y2) / 2;

    } else {
      const x1 = fromBottom.x;
      const y1 = fromBottom.y;
      const x2 = toTop.x;
      const y2 = toTop.y;
      const midY = y1 + (y2 - y1) / 2;

      if (Math.abs(x1 - x2) < 4) {
        pathData = `M ${x1},${y1} V ${y2}`;
      } else {
        pathData = `M ${x1},${y1} V ${midY} H ${x2} V ${y2}`;
      }
      labelX = (x1 + x2) / 2 + 5;
      labelY = midY;
    }
  }

  const strokeColor = edge.dashed ? '#94a3b8' : '#64748b';
  const markerId = edge.dashed ? 'arrowhead-dashed' : 'arrowhead';

  return (
    <g className="edge-group">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
        </marker>
        <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
        </marker>
      </defs>

      <path d={pathData} fill="none" stroke="transparent" strokeWidth="12" />

      <path
        d={pathData}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.8"
        strokeDasharray={edge.dashed ? '5,5' : 'none'}
        markerEnd={`url(#${markerId})`}
      />

      {edge.label && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <rect x={-22} y={-10} width={44} height={20} fill="white" rx={4} opacity={0.92}
            stroke="#e2e8f0" strokeWidth="1" />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: '11px', fontWeight: 700, fill: '#475569', fontFamily: 'Inter, sans-serif' }}
          >
            {edge.label}
          </text>
        </g>
      )}
    </g>
  );
};

export default Edge;

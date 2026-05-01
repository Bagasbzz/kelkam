import React from 'react';
import { DiagramNode } from '@/lib/types/diagram';

interface NodeProps {
  node: DiagramNode;
  isSelected?: boolean;
  isConnectSource?: boolean;
  onClick?: () => void;
  onDragStart?: (id: string, e: React.PointerEvent | React.MouseEvent) => void;
}


const HANDLE_SIZE = 7;

const Node: React.FC<NodeProps> = ({ node, isSelected, isConnectSource, onClick, onDragStart }) => {
  const { type, width, height } = node;

  const curX = node.x + (node.offsetX || 0);
  const curY = node.y + (node.offsetY || 0);

  const borderColor = isConnectSource
    ? '#f59e0b'
    : isSelected
    ? '#4f46e5'
    : '#1e293b';

  const borderWidth = isSelected || isConnectSource ? 2.5 : 1.5;

  const renderShape = () => {
    switch (type) {
      case 'start':
        return (
          <ellipse
            cx={curX + width / 2}
            cy={curY + height / 2}
            rx={width / 2}
            ry={height / 2}
            fill="white"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
      case 'end':
        return (
          <ellipse
            cx={curX + width / 2}
            cy={curY + height / 2}
            rx={width / 2}
            ry={height / 2}
            fill="#1e293b"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
      case 'process':
        return (
          <rect
            x={curX}
            y={curY}
            width={width}
            height={height}
            rx={4}
            fill="white"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
      case 'activity':
        return (
          <rect
            x={curX}
            y={curY}
            width={width}
            height={height}
            rx={20}
            fill="white"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
      case 'fork':
      case 'join':
        return (
          <rect
            x={curX}
            y={curY}
            width={width}
            height={height}
            fill="#1e293b"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
      case 'actor': {
        const centerX = curX + width / 2;
        const headR = 12;
        return (
          <g style={{ fill: 'none', stroke: borderColor, strokeWidth: borderWidth }}>
            <circle cx={centerX} cy={curY + headR} r={headR} />
            <line x1={centerX} y1={curY + headR * 2} x2={centerX} y2={curY + 50} />
            <line x1={centerX - 20} y1={curY + 30} x2={centerX + 20} y2={curY + 30} />
            <line x1={centerX} y1={curY + 50} x2={centerX - 15} y2={curY + 75} />
            <line x1={centerX} y1={curY + 50} x2={centerX + 15} y2={curY + 75} />
            {/* Invisible hit area */}
            <rect x={curX} y={curY} width={width} height={height} fill="transparent" stroke="none" />
          </g>
        );
      }
      case 'usecase':
        return (
          <ellipse
            cx={curX + width / 2}
            cy={curY + height / 2}
            rx={width / 2}
            ry={height / 2}
            fill="white"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
      case 'decision': {
        const halfW = width / 2;
        const halfH = height / 2;
        const points = `${curX + halfW},${curY} ${curX + width},${curY + halfH} ${curX + halfW},${curY + height} ${curX},${curY + halfH}`;
        return (
          <polygon
            points={points}
            fill="white"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
      }
      default:
        return null;
    }
  };

  const LINE_HEIGHT = 20;
  const totalTextHeight = (node.lines.length - 1) * LINE_HEIGHT;
  const startY = curY + height / 2 - totalTextHeight / 2;
  
  let textY = startY;
  if (type === 'actor' || type === 'fork' || type === 'join') {
    textY = curY + height + 15;
  }

  const resizeHandles = isSelected && type !== 'actor' ? [
    { cx: curX, cy: curY, cursor: 'nw-resize' },
    { cx: curX + width, cy: curY, cursor: 'ne-resize' },
    { cx: curX, cy: curY + height, cursor: 'sw-resize' },
    { cx: curX + width, cy: curY + height, cursor: 'se-resize' },
  ] : [];

  return (
    <g
      className="node-group"
      style={{ cursor: 'grab', touchAction: 'none' }}
      onPointerDown={(e) => {
        if ((e.target as Element).classList.contains('resize-handle')) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        onDragStart?.(node.id, e);
      }}
      onClick={(e) => {

        e.stopPropagation();
        onClick?.();
      }}
    >
      {renderShape()}

      <text
        x={curX + width / 2}
        y={textY}
        textAnchor="middle"
        dominantBaseline={type === 'actor' ? 'hanging' : 'middle'}
        style={{
          pointerEvents: 'none',
          fontSize: '13px',
          fontWeight: type === 'actor' ? '600' : '500',
          fill: '#1e293b',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        {node.lines.map((line, index) => (
          <tspan key={index} x={curX + width / 2} dy={index === 0 ? 0 : LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>

      {resizeHandles.map((h, i) => (
        <circle
          key={i}
          className="resize-handle"
          cx={h.cx}
          cy={h.cy}
          r={HANDLE_SIZE}
          fill="#4f46e5"
          stroke="white"
          strokeWidth={2}
          style={{ cursor: h.cursor }}
          data-corner={i}
          data-nodeid={node.id}
        />
      ))}
    </g>
  );

};

export default Node;

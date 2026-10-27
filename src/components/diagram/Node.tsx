import React, { useMemo } from 'react';
import { DiagramNode } from '@/lib/types/diagram';
import { layoutNodeText } from '@/lib/uml/text-fit';
import { isSequenceNode } from '@/lib/uml/sequence';
import { sequenceShapes } from '@/lib/uml/sequence-shapes';
import { isStructuralNode, structuralShapes } from '@/lib/uml/structure-shapes';
import {
  FONT_FAMILY,
  INK,
  NODE_STROKE_WIDTH,
} from '@/lib/uml/theme';

interface NodeProps {
  node: DiagramNode;
  isSelected?: boolean;
  isConnectSource?: boolean;
  onClick?: () => void;
  onDragStart?: (id: string, e: React.PointerEvent | React.MouseEvent) => void;
  /** Plafon font seragam diagram (dari diagramFontCap). */
  fontCap?: number;
}


const HANDLE_SIZE = 7;

const Node: React.FC<NodeProps> = ({ node, isSelected, isConnectSource, onClick, onDragStart, fontCap }) => {
  const { type, width, height } = node;

  const curX = node.x + (node.offsetX || 0);
  const curY = node.y + (node.offsetY || 0);

  const borderColor = isConnectSource
    ? '#f59e0b'
    : isSelected
    ? '#4f46e5'
    : INK;

  const borderWidth = isSelected || isConnectSource ? 2.5 : NODE_STROKE_WIDTH;

  const renderShape = () => {
    if (isSequenceNode(node)) return sequenceShapes(node, borderColor, borderWidth).map((shape, i) => React.createElement(shape.tag, { ...shape.attrs, key: i }, shape.text));
    if (isStructuralNode(node)) return structuralShapes(node, borderColor, borderWidth).map((shape, i) => React.createElement(shape.tag, { ...shape.attrs, key: i }, shape.text));
    switch (type) {
      case 'start':
      case 'end':
        // Terminator (Mulai/Selesai): satu oval bergaris tunggal. Ukuran oval
        // dihitung dari panjang label (lihat terminatorSize) supaya teks tidak keluar.
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
      case 'process':
      case 'system':
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
            fill={INK}
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

  // Auto-fit: font terbesar yang muat di dalam bentuk, wrap ulang sesuai lebar
  // bentuk (oval/ketupat menyempit di atas-bawah). Ukuran node tidak berubah.
  const textLayout = useMemo(
    () => layoutNodeText({ type, text: node.text, lines: node.lines, width, height }, curX, curY, fontCap),
    [type, node.text, node.lines, width, height, curX, curY, fontCap],
  );

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
      {type === 'lifeline' && <rect x={curX} y={curY} width={width} height={height} fill="transparent" stroke="none" />}

      {!isSequenceNode(node) && !isStructuralNode(node) && <text
        x={curX + width / 2}
        y={textLayout.firstLineY}
        textAnchor="middle"
        dominantBaseline={textLayout.baseline}
        style={{
          pointerEvents: 'none',
          fontSize: `${textLayout.fontSize}px`,
          fontWeight: textLayout.fontWeight,
          fill: INK,
          fontFamily: FONT_FAMILY,
        }}
      >
        {textLayout.lines.map((line, index) => (
          <tspan key={index} x={curX + width / 2} dy={index === 0 ? 0 : textLayout.lineHeight}>
            {line}
          </tspan>
        ))}
      </text>}

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


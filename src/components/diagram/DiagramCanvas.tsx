import React, { useRef, useState, useCallback, useMemo } from 'react';
import { DiagramNode, DiagramEdge } from '@/lib/types/diagram';
import { diagramFontCap, laneTitleFont } from '@/lib/uml/text-fit';
import {
  ARROW,
  EDGE_DASHED_STROKE,
  EDGE_STROKE,
  FONT_FAMILY,
  INK,
  LANE_FILL_EVEN,
  LANE_FILL_ODD,
  LANE_HEADER_FILL,
  LANE_HEADER_HEIGHT,
  LANE_START_X,
  LANE_STROKE,
  LANE_STROKE_WIDTH,
  LANE_TOP_Y,
  resolveLaneWidth,
} from '@/lib/uml/theme';
import Node from './Node';
import Edge, { EdgeLabel } from './Edge';

interface DiagramCanvasProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selectedNodeId?: string | null;
  connectMode?: boolean;
  connectFromId?: string | null;
  onNodeClick?: (id: string) => void;
  onNodeDragStart?: (id: string, e: React.PointerEvent | React.MouseEvent) => void;
  onNodeDrag?: (id: string, newX: number, newY: number) => void;
  onNodeResizeStart?: (id: string) => void;
  onNodeResize?: (id: string, newWidth: number, newHeight: number) => void;

  onZoomChange?: (delta: number) => void;
  zoomLevel: number;
  canvasWidth?: number;
  canvasHeight?: number;
  lanes?: string[];
  /** Lebar lane tersimpan (meta.laneWidth). Kosong → dideteksi dari posisi node (diagram lama = 420). */
  laneWidth?: number;
}



const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  connectMode,
  connectFromId,
  onNodeClick,
  onNodeDragStart,
  onNodeDrag,
  onNodeResizeStart,
  onNodeResize,


  zoomLevel,
  onZoomChange,
  canvasWidth = 2500,
  canvasHeight = 2000,
  lanes = [],
  laneWidth: savedLaneWidth,
}) => {

  const scale = zoomLevel / 100;
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  const activePointers = useRef(new Map<number, React.PointerEvent>());
  const lastPinchDist = useRef<number | null>(null);
  const lastPanPoint = useRef<{ x: number, y: number } | null>(null);

  const dragging = useRef<{
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startNodeX: number;
    startNodeY: number;
  } | null>(null);

  const resizing = useRef<{
    nodeId: string;
    corner: number;
    startMouseX: number;
    startMouseY: number;
    startW: number;
    startH: number;
    startX: number;
    startY: number;
  } | null>(null);

  const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const visibleLanes = lanes.length ? lanes : Array.from(new Set(nodes.map((node) => node.lane).filter(Boolean))) as string[];
  const laneWidth = resolveLaneWidth(nodes, visibleLanes, savedLaneWidth);
  const laneHeight = Math.max(canvasHeight - 80, 900, ...nodes.map((node) => node.y + node.height + 80));
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  // Plafon font seragam: dihitung dari teks & ukuran saja (bukan posisi) → tidak
  // dihitung ulang saat drag.
  const fontKey = nodes.map((n) => `${n.type}|${n.width}|${n.height}|${n.text}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fontCap = useMemo(() => diagramFontCap(nodes), [fontKey]);

  const getSvgPoint = useCallback((e: React.MouseEvent | React.PointerEvent | MouseEvent | PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;

    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }, [scale]);

  const handleNodeDragStart = useCallback((nodeId: string, e: React.MouseEvent | React.PointerEvent) => {
    if (connectMode) return;

    e.stopPropagation();
    e.preventDefault();

    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const pt = getSvgPoint(e);
    dragging.current = {
      nodeId,
      startMouseX: pt.x,
      startMouseY: pt.y,
      startNodeX: node.x,
      startNodeY: node.y,
    };
    onNodeDragStart?.(nodeId, e);
  }, [connectMode, nodes, getSvgPoint, onNodeDragStart]);


  const handleResizeStart = useCallback((nodeId: string, corner: number, e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();

    e.preventDefault();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const pt = getSvgPoint(e);
    resizing.current = {
      nodeId,
      corner,
      startMouseX: pt.x,
      startMouseY: pt.y,
      startW: node.width,
      startH: node.height,
      startX: node.x,
      startY: node.y,
    };
    onNodeResizeStart?.(nodeId);
  }, [nodes, getSvgPoint, onNodeResizeStart]);


  const handleSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const pt = getSvgPoint(e);

    if (dragging.current) {
      const { startMouseX, startMouseY, startNodeX, startNodeY } = dragging.current;
      const dx = pt.x - startMouseX;
      const dy = pt.y - startMouseY;
      onNodeDrag?.(dragging.current.nodeId, startNodeX + dx, startNodeY + dy);
    }


    if (resizing.current) {
      const { nodeId, corner, startMouseX, startMouseY, startW, startH } = resizing.current;
      const dx = pt.x - startMouseX;
      const dy = pt.y - startMouseY;

      let newW = startW;
      let newH = startH;
      if (corner === 1 || corner === 3) newW = Math.max(80, startW + dx);
      if (corner === 0 || corner === 2) newW = Math.max(80, startW - dx);
      if (corner === 2 || corner === 3) newH = Math.max(40, startH + dy);
      if (corner === 0 || corner === 1) newH = Math.max(40, startH - dy);
      onNodeResize?.(nodeId, newW, newH);
    }

    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, e);

      if (!dragging.current && !resizing.current && !connectMode) {
        if (activePointers.current.size === 1) {
          if (lastPanPoint.current && wrapperRef.current) {
            const dx = e.clientX - lastPanPoint.current.x;
            const dy = e.clientY - lastPanPoint.current.y;
            wrapperRef.current.scrollBy(-dx, -dy);
            lastPanPoint.current = { x: e.clientX, y: e.clientY };
          }
        } else if (activePointers.current.size === 2) {
          const pts = Array.from(activePointers.current.values());
          const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
          const midX = (pts[0].clientX + pts[1].clientX) / 2;
          const midY = (pts[0].clientY + pts[1].clientY) / 2;

          if (lastPinchDist.current !== null && onZoomChange) {
            const deltaDist = dist - lastPinchDist.current;
            if (Math.abs(deltaDist) > 5) {
              onZoomChange(deltaDist > 0 ? 5 : -5);
              lastPinchDist.current = dist;
            }
          }

          if (lastPanPoint.current && wrapperRef.current) {
            const dx = midX - lastPanPoint.current.x;
            const dy = midY - lastPanPoint.current.y;
            wrapperRef.current.scrollBy(-dx, -dy);
            lastPanPoint.current = { x: midX, y: midY };
          }
        }
      }
    }

    if (connectMode && connectFromId) {
      const fromNode = nodes.find(n => n.id === connectFromId);
      if (fromNode) {
        setRubberBand({
          x1: fromNode.x + fromNode.width / 2,
          y1: fromNode.y + fromNode.height / 2,
          x2: pt.x,
          y2: pt.y,
        });
      }
    } else {
      setRubberBand(null);
    }
  }, [nodes, onNodeDrag, onNodeResize, connectMode, connectFromId, getSvgPoint, onZoomChange]);


  const handleSvgPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragging.current = null;
    resizing.current = null;

    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      lastPinchDist.current = null;
    }
    if (activePointers.current.size === 1) {
      const pt = Array.from(activePointers.current.values())[0];
      lastPanPoint.current = { x: pt.clientX, y: pt.clientY };
    } else {
      lastPanPoint.current = null;
    }
  }, []);

  const handleNodePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as SVGElement;

    if (target.classList.contains('resize-handle')) {
      const corner = parseInt(target.getAttribute('data-corner') || '0', 10);
      const nodeId = target.getAttribute('data-nodeid') || '';
      handleResizeStart(nodeId, corner, e);
      return;
    }
    
    (target as Element).setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, e);

    if (activePointers.current.size === 1) {
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
    } else if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      lastPinchDist.current = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      lastPanPoint.current = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2
      };
    }
  }, [handleResizeStart]);

  return (
    <div ref={wrapperRef} className="canvas-wrapper" style={{ overflow: 'auto', width: '100%', height: '100%', touchAction: 'none' }}>
      <svg

        ref={svgRef}
        id="diagram-svg"
        width={canvasWidth * scale}
        height={canvasHeight * scale}
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        className="diagram-svg"

        style={{ display: 'block', userSelect: 'none' }}
        onPointerMove={handleSvgPointerMove}

        onPointerUp={handleSvgPointerUp}
        onPointerLeave={handleSvgPointerUp}
        onPointerDown={handleNodePointerDown}
      >

        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" strokeWidth="1" />
          </pattern>
          <marker id="arrowhead" markerWidth={ARROW.width} markerHeight={ARROW.height} refX={ARROW.refX} refY={ARROW.refY} orient="auto">
            <polygon points={ARROW.points} fill={EDGE_STROKE} />
          </marker>
          <marker id="arrowhead-dashed" markerWidth={ARROW.width} markerHeight={ARROW.height} refX={ARROW.refX} refY={ARROW.refY} orient="auto">
            <polygon points={ARROW.points} fill={EDGE_DASHED_STROKE} />
          </marker>
          <marker id="arrowhead-connect" markerWidth={ARROW.width} markerHeight={ARROW.height} refX={ARROW.refX} refY={ARROW.refY} orient="auto">
            <polygon points={ARROW.points} fill="#f59e0b" />
          </marker>
        </defs>

        <rect width="5000" height="5000" fill="url(#grid)" />

        <g>
          {visibleLanes.length > 0 && (
            <g className="swimlanes" style={{ pointerEvents: 'none' }}>
              {visibleLanes.map((lane, index) => {
                const x = LANE_START_X + index * laneWidth;
                return (
                  <g key={lane}>
                    <rect
                      x={x}
                      y={LANE_TOP_Y}
                      width={laneWidth}
                      height={laneHeight}
                      fill={index % 2 === 0 ? LANE_FILL_EVEN : LANE_FILL_ODD}
                      stroke={LANE_STROKE}
                      strokeWidth={LANE_STROKE_WIDTH}
                    />
                    <rect
                      x={x}
                      y={LANE_TOP_Y}
                      width={laneWidth}
                      height={LANE_HEADER_HEIGHT}
                      fill={LANE_HEADER_FILL}
                      stroke={LANE_STROKE}
                      strokeWidth={LANE_STROKE_WIDTH}
                    />
                    <text
                      x={x + laneWidth / 2}
                      y={LANE_TOP_Y + LANE_HEADER_HEIGHT / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={INK}
                      fontSize={laneTitleFont(lane, laneWidth)}
                      fontWeight="700"
                      fontFamily={FONT_FAMILY}
                    >
                      {lane}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {edges.map((edge) => {
            const fromNode = nodeById.get(edge.fromId);
            const toNode = nodeById.get(edge.toId);
            if (fromNode && toNode) {
              return <Edge key={edge.id} edge={edge} fromNode={fromNode} toNode={toNode} />;
            }
            return null;
          })}

          {connectMode && rubberBand && (
            <line
              x1={rubberBand.x1}
              y1={rubberBand.y1}
              x2={rubberBand.x2}
              y2={rubberBand.y2}
              stroke="#f59e0b"
              strokeWidth="2"
              strokeDasharray="6,4"
              markerEnd="url(#arrowhead-connect)"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {nodes.map((node) => (
            <Node
              key={node.id}
              node={node}
              isSelected={node.id === selectedNodeId}
              isConnectSource={node.id === connectFromId}
              onClick={() => onNodeClick?.(node.id)}
              onDragStart={handleNodeDragStart}
              fontCap={fontCap}
            />
          ))}

          {/* Label edge di atas node (sama dengan render-svg) agar tidak tertutup bentuk. */}
          {edges.map((edge) => {
            const fromNode = nodeById.get(edge.fromId);
            const toNode = nodeById.get(edge.toId);
            return fromNode && toNode && edge.label
              ? <EdgeLabel key={`label-${edge.id}`} edge={edge} fromNode={fromNode} toNode={toNode} />
              : null;
          })}
        </g>
      </svg>
    </div>
  );
};

export default DiagramCanvas;


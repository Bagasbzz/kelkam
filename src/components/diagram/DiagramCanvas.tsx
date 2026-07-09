import React, { useRef, useState, useCallback } from 'react';
import { DiagramNode, DiagramEdge } from '@/lib/types/diagram';
import Node from './Node';
import Edge from './Edge';

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
  const laneWidth = 420;
  const laneStartX = 20;
  const laneHeaderHeight = 52;
  const laneHeight = Math.max(canvasHeight - 80, 900, ...nodes.map((node) => node.y + node.height + 80));

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
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
          </marker>
          <marker id="arrowhead-connect" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
          </marker>
        </defs>

        <rect width="5000" height="5000" fill="url(#grid)" />

        <g transform={`scale(${scale})`}>
          {visibleLanes.length > 0 && (
            <g className="swimlanes" style={{ pointerEvents: 'none' }}>
              {visibleLanes.map((lane, index) => {
                const x = laneStartX + index * laneWidth;
                return (
                  <g key={lane}>
                    <rect
                      x={x}
                      y={24}
                      width={laneWidth}
                      height={laneHeight}
                      fill={index % 2 === 0 ? '#ffffff' : '#f8fafc'}
                      stroke="#cbd5e1"
                      strokeWidth="1.5"
                    />
                    <rect
                      x={x}
                      y={24}
                      width={laneWidth}
                      height={laneHeaderHeight}
                      fill="#eef2ff"
                      stroke="#cbd5e1"
                      strokeWidth="1.5"
                    />
                    <text
                      x={x + laneWidth / 2}
                      y={56}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#3730a3"
                      fontSize="18"
                      fontWeight="700"
                    >
                      {lane}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {edges.map((edge) => {
            const fromNode = nodes.find((n) => n.id === edge.fromId);
            const toNode = nodes.find((n) => n.id === edge.toId);
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
            />
          ))}
        </g>
      </svg>
    </div>
  );
};

export default DiagramCanvas;

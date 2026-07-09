'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { DiagramNode, DiagramEdge, NodeType, DiagramType } from '@/lib/types/diagram';
import DiagramCanvas from '@/components/diagram/DiagramCanvas';
import styles from './uml.module.css';
import { Hand, Zap, CheckCircle2, Square, Sparkles, BrainCircuit, X } from 'lucide-react';

interface DiagramMeta {
  title?: string;
  lanes: string[];
  reportDiagramId?: string;
  reportContext?: {
    reportTitle?: string;
    topic?: string;
    projectType?: string;
    course?: string;
    citationStyle?: string;
    sources?: { title: string; preview: string }[];
  };
}

export default function UMLBuilder() {
  const [diagramType, setDiagramType] = useState<DiagramType>('flowchart');
  const [nodes, setNodes] = useState<DiagramNode[]>([]);
  const [edges, setEdges] = useState<DiagramEdge[]>([]);
  const [newNodeType, setNewNodeType] = useState<NodeType>('process');
  const [newNodeText, setNewNodeText] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [branchType, setBranchType] = useState<'main' | 'yes' | 'no'>('main');
  const [isConnectingExisting, setIsConnectingExisting] = useState(false);
  const [targetNodeId, setTargetNodeId] = useState<string>('');
  const [history, setHistory] = useState<{ nodes: DiagramNode[]; edges: DiagramEdge[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ nodes: DiagramNode[]; edges: DiagramEdge[] }[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(100);

  const [nodeSide, setNodeSide] = useState<'left' | 'right' | 'center'>('left');
  const [isDashed, setIsDashed] = useState(false);
  const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);
  const [layoutMode, setLayoutMode] = useState<'top-bottom' | 'side-by-side'>('top-bottom');
  const [sidebarWidth, setSidebarWidth] = useState(380);

  const [isResizing, setIsResizing] = useState(false);


  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiClarification, setAiClarification] = useState('');
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [diagramMeta, setDiagramMeta] = useState<DiagramMeta>({ lanes: [] });
  const loadedPrefillRef = useRef(false);

  const wrapText = useCallback((text: string, maxCharsPerLine: number) => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      if (currentLine.length + words[i].length + 1 <= maxCharsPerLine) {
        currentLine += ' ' + words[i];
      } else {
        lines.push(currentLine);
        currentLine = words[i];
      }
    }
    lines.push(currentLine);
    if (lines.length > 5) {
      const truncated = lines.slice(0, 5);
      truncated[4] = truncated[4].substring(0, maxCharsPerLine - 3) + '...';
      return truncated;
    }
    return lines;
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const saveToHistory = useCallback(() => {
    setHistory((prev) => [...prev, { nodes: [...nodes], edges: [...edges] }]);
    setRedoStack([]);
  }, [nodes, edges]);

  const handleGenerateAI = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setIsGeneratingAI(true);
    setToast('AI is thinking...');
    try {
      const existingSummary = nodes.length > 0 ? {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodes: nodes.slice(0, 12).map((n) => ({ id: n.id, type: n.type, text: n.text })),
      } : null;

      const res = await fetch('/api/ai/generate-uml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, diagramType, existingSummary, reportContext: diagramMeta.reportContext })
      });
      const data = await res.json();
      if (data.needsClarification) {
        setAiClarification(data.clarification || 'Tambahkan detail alur, aktor, dan kondisi penting yang harus masuk diagram.');
        showToast('AI needs one clarification first.');
        return;
      }

      if (data.success && data.data) {
        saveToHistory();
        setAiClarification('');
        const returnedLanes = Array.isArray(data.data.lanes) ? data.data.lanes : Array.isArray(data.spec?.lanes) ? data.spec.lanes : [];
        const CHARS_PER_LINE = diagramType === 'usecase' || diagramType === 'sequence' ? 18 : 20;
        const LINE_HEIGHT = 24;
        const PADDING_V = 40;
        const MAX_WIDTH = 250;

        const generatedNodes = (data.data.nodes || []).map((n: any) => {
          const text = n.text || '';
          const lines = wrapText(text, CHARS_PER_LINE);
          let nodeHeight = 60;
          let finalWidth = 120;

          if (n.type === 'actor') {
            nodeHeight = 80; finalWidth = 60;
          } else if (n.type === 'fork' || n.type === 'join') {
            nodeHeight = 10; finalWidth = 120;
          } else if (n.type === 'lifeline') {
            const longestLine = Math.max(...lines.map((l: string) => l.length), 1);
            finalWidth = Math.max(130, Math.min(210, longestLine * 9 + 52));
            nodeHeight = Math.max(420, typeof n.height === 'number' ? n.height : 420);
          } else if (n.type === 'usecase') {
            const longestLine = Math.max(...lines.map((l: string) => l.length), 1);
            finalWidth = Math.max(140, longestLine * 9 + 60);
            nodeHeight = Math.max(70, lines.length * LINE_HEIGHT + 35);
          } else if (n.type === 'decision') {
            const longestLine = Math.max(...lines.map((l: string) => l.length), 1);
            finalWidth = Math.max(160, longestLine * 11 + 70);
            nodeHeight = Math.max(100, lines.length * LINE_HEIGHT + 60);
            if (lines.length > 2) finalWidth = Math.min(MAX_WIDTH + 60, finalWidth);
          } else {
            nodeHeight = Math.max(60, lines.length * LINE_HEIGHT + PADDING_V);
            finalWidth = lines.length > 1 ? MAX_WIDTH : Math.min(MAX_WIDTH, Math.max(120, text.length * 10 + 40));
          }

          return {
            ...n,
            lines,
            width: finalWidth,
            height: nodeHeight,
            x: typeof n.x === 'number' ? n.x : 500,
            y: typeof n.y === 'number' ? n.y : 100,
            lane: n.lane,
            pinned: Boolean(n.pinned)
          };
        });
        setNodes(generatedNodes);
        setEdges(data.data.edges || []);
        setDiagramMeta((prev) => ({
          ...prev,
          title: data.data.title || data.spec?.title || prev.title,
          lanes: returnedLanes,
        }));
        setAiPrompt('');
        setIsAiModalOpen(false);
        showToast('AI diagram generated successfully!');
      } else {
        showToast(data.error || 'Failed to generate diagram.');
      }
    } catch (e) {
      showToast('Error connecting to AI.');
    } finally {
      setIsGeneratingAI(false);
    }
  }, [aiPrompt, diagramMeta.reportContext, diagramType, edges.length, nodes, saveToHistory, showToast, wrapText]);

  const handleNudge = useCallback((id: string, dx: number, dy: number) => {
    setNodes(prev => prev.map(n => n.id === id ? {
      ...n,
      offsetX: (n.offsetX || 0) + dx,
      offsetY: (n.offsetY || 0) + dy
    } : n));
  }, []);

  // --- Layout Engine ---
  useEffect(() => {
    if (diagramType === 'flowchart' || diagramType === 'activity') {
      setNodes(prev => {
        const newNodes = [...prev];
        let hasChanges = false;
        const roots = newNodes.filter(n => !edges.some(e => e.toId === n.id));
        if (roots.length === 0 && newNodes.length > 0) roots.push(newNodes[0]);

        const X_START = 500;
        const Y_START = 100;
        const Y_SPACING = 160;
        const X_SPACING = 280;
        const visited = new Set<string>();

        const processNode = (nodeId: string, depth: number, xOffset: number) => {
          if (visited.has(nodeId)) return;
          visited.add(nodeId);

          const idx = newNodes.findIndex(n => n.id === nodeId);
          if (idx === -1) return;
          const node = newNodes[idx];

          if (!node.pinned) {
            const targetX = X_START + xOffset - (node.width / 2);
            const targetY = Y_START + depth * Y_SPACING;
            if (node.x !== targetX || node.y !== targetY) {
              newNodes[idx] = { ...node, x: targetX, y: targetY };
              hasChanges = true;
            }
          }

          const outgoing = edges.filter(e => e.fromId === nodeId);
          if (node.type === 'decision') {
            const yesEdge = outgoing.find(e => e.label === 'YES' || e.direction === 'right' || e.toId === node.yes);
            const noEdge  = outgoing.find(e => e.label === 'NO'  || e.direction === 'left'  || e.toId === node.no);
            const mainEdge = outgoing.find(e => e !== yesEdge && e !== noEdge);
            
            if (yesEdge) processNode(yesEdge.toId, depth + 1, xOffset + X_SPACING);
            if (noEdge) processNode(noEdge.toId, depth + 1, xOffset - X_SPACING);
            if (mainEdge) processNode(mainEdge.toId, depth + 1, xOffset);
          } else if (node.type === 'fork') {
            const outCount = outgoing.length;
            outgoing.forEach((e, i) => {
              const childXOffset = xOffset + (i - (outCount - 1) / 2) * X_SPACING;
              processNode(e.toId, depth + 1, childXOffset);
            });
          } else if (node.type === 'join') {
            const firstOut = outgoing[0];
            if (firstOut) processNode(firstOut.toId, depth + 1, xOffset);
          } else {
            const outCount = outgoing.length;
            outgoing.forEach((e, i) => {
              const childXOffset = xOffset + (i - (outCount - 1) / 2) * X_SPACING;
              processNode(e.toId, depth + 1, childXOffset);
            });
          }
        };

        roots.forEach((root, idx) => processNode(root.id, 0, idx * 500));
        return hasChanges ? newNodes : prev;
      });
    } else if (diagramType === 'usecase') {
      const useCases = nodes.filter(n => n.type === 'usecase');
      const actors = nodes.filter(n => n.type === 'actor');

      setNodes(prev => prev.map(node => {
        if (node.pinned) return node;
        let newX = node.x;
        let newY = node.y;

        if (node.type === 'usecase') {
          const index = useCases.findIndex(u => u.id === node.id);
          newX = 500 - (node.width / 2);
          newY = 150 + index * 120;
        }

        if (newX !== node.x || newY !== node.y) {
          return { ...node, x: newX, y: newY };
        }
        return node;
      }));

      setNodes(prev => {
        const currentUseCases = prev.filter(n => n.type === 'usecase');
        return prev.map(node => {
          if (node.pinned) return node;
          if (node.type === 'actor') {
            const connectedEdges = edges.filter(e => e.fromId === node.id || e.toId === node.id);
            const connectedUseCases = currentUseCases.filter(u =>
              connectedEdges.some(e => e.fromId === u.id || e.toId === u.id)
            );

            let newX = node.side === 'left' ? 150 : 850;
            let newY = node.y;

            if (connectedUseCases.length > 0) {
              const avgY = connectedUseCases.reduce((sum, u) => sum + u.y + u.height/2, 0) / connectedUseCases.length;
              newY = avgY - node.height / 2;
            } else {
              const actorsOnSameSide = actors.filter(a => a.side === node.side);
              const index = actorsOnSameSide.findIndex(a => a.id === node.id);
              newY = 150 + index * 150;
            }

            if (newX !== node.x || newY !== node.y) {
              return { ...node, x: newX, y: newY };
            }
          }
          return node;
        });
      });
    }
  }, [nodes, edges, diagramType]);

  useEffect(() => {
    if (!localStorage.getItem('uml-onboarding-seen')) {
      setShowOnboarding(true);
    }
  }, []);

  useEffect(() => {
    const prefill = localStorage.getItem('uml-ai-prefill');
    if (!prefill) return;

    try {
      const parsed = JSON.parse(prefill);
      if (parsed.prompt) setAiPrompt(parsed.prompt);
      if (parsed.diagramType && ['flowchart', 'usecase', 'activity', 'sequence'].includes(parsed.diagramType)) {
        setDiagramType(parsed.diagramType);
      }
      loadedPrefillRef.current = true;
      const restoredNodes = Array.isArray(parsed.diagramData?.nodes) ? parsed.diagramData.nodes : [];
      const restoredEdges = Array.isArray(parsed.diagramData?.edges) ? parsed.diagramData.edges : [];
      setNodes(restoredNodes);
      setEdges(restoredEdges);
      setSelectedNodeId(null);
      const restoredLanes = Array.isArray(parsed.diagramData?.meta?.lanes)
        ? parsed.diagramData.meta.lanes
        : Array.from(new Set(restoredNodes.map((node: DiagramNode) => node.lane).filter(Boolean))) as string[];
      setDiagramMeta({
        title: parsed.diagramData?.meta?.title || parsed.title,
        lanes: restoredLanes,
        reportDiagramId: parsed.reportDiagramId,
        reportContext: parsed.reportContext,
      });
      setIsAiModalOpen(restoredNodes.length === 0);
      setAiClarification('');
      localStorage.removeItem('uml-ai-prefill');
    } catch (error) {
      console.error('Failed to load UML prefill:', error);
      localStorage.removeItem('uml-ai-prefill');
    }
  }, []);

  const handleToggleActorSelection = useCallback((actorId: string) => {
    setSelectedActorIds(prev =>
      prev.includes(actorId) ? prev.filter(id => id !== actorId) : [...prev, actorId]
    );
  }, []);

  const handleNodeDragStart = useCallback((id: string) => {
    saveToHistory();
  }, [saveToHistory]);

  const handleNodeDrag = useCallback((id: string, newX: number, newY: number) => {
    setNodes(prev => prev.map(n =>
      n.id === id ? { ...n, x: Math.max(0, newX), y: Math.max(0, newY), pinned: true } : n
    ));
  }, []);

  const handleNodeResizeStart = useCallback((id: string) => {
    saveToHistory();
  }, [saveToHistory]);

  const handleNodeResize = useCallback((id: string, newWidth: number, newHeight: number) => {
    setNodes(prev => prev.map(n => {


      if (n.id !== id) return n;
      const CHARS_PER_LINE = Math.max(10, Math.floor(newWidth / 9));
      const words = n.text.split(' ');
      const lines: string[] = [];
      let currentLine = words[0] || '';
      for (let i = 1; i < words.length; i++) {
        if (currentLine.length + words[i].length + 1 <= CHARS_PER_LINE) {
          currentLine += ' ' + words[i];
        } else {
          lines.push(currentLine);
          currentLine = words[i];
        }
      }
      lines.push(currentLine);
      return { ...n, width: newWidth, height: newHeight, lines, pinned: true };
    }));
  }, []);

  const handleNodeClick = useCallback((id: string) => {
    if (connectMode) {
      if (!connectFromId) {
        setConnectFromId(id);
        showToast('Now click a target node to connect');
      } else {
        if (connectFromId !== id) {
          saveToHistory();
          const newEdge: DiagramEdge = {
            id: `edge-${Date.now()}`,
            fromId: connectFromId,
            toId: id,
            dashed: isDashed,
          };
          setEdges(prev => [...prev, newEdge]);
          showToast('Connection created!');
        }
        setConnectFromId(null);
        setConnectMode(false);
      }
    } else {
      setSelectedNodeId(prev => prev === id ? null : id);
    }
  }, [connectMode, connectFromId, isDashed, showToast, saveToHistory]);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth > 200 && newWidth < 600) setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  const stopResizing = useCallback(() => setIsResizing(false), []);
  const startResizing = useCallback((e: React.MouseEvent) => { setIsResizing(true); e.preventDefault(); }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  useEffect(() => {
    if (diagramType === 'usecase') {
      setNewNodeType('actor');
      setParentId('');
    } else if (diagramType === 'flowchart') {
      setNewNodeType('process');
      setParentId('');
    } else if (diagramType === 'activity') {
      setNewNodeType('activity');
      setParentId('');
    } else if (diagramType === 'sequence') {
      setNewNodeType('lifeline');
      setParentId('');
    }
  }, [diagramType]);

  const [projects, setProjects] = useState<Record<DiagramType, { nodes: DiagramNode[]; edges: DiagramEdge[] }>>({
    flowchart: { nodes: [], edges: [] },
    usecase: { nodes: [], edges: [] },
    class: { nodes: [], edges: [] },
    sequence: { nodes: [], edges: [] },
    activity: { nodes: [], edges: [] },
    state: { nodes: [], edges: [] },
  });

  const STORAGE_KEY = 'uml-diagram-projects-v2';

  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.projects) setProjects(parsed.projects);
        if (!loadedPrefillRef.current && parsed.activeType) setDiagramType(parsed.activeType);
        if (parsed.zoomLevel) setZoomLevel(parsed.zoomLevel);
        const active = parsed.projects[parsed.activeType || 'flowchart'];
        if (!loadedPrefillRef.current && active) {
          setNodes(active.nodes || []);
          setEdges(active.edges || []);
        }
      } catch (e) {
        console.error('Failed to load projects:', e);
      }
    }
  }, []);

  useEffect(() => {
    setProjects(prev => ({ ...prev, [diagramType]: { nodes, edges } }));
  }, [nodes, edges, diagramType]);

  const handleSwitchDiagram = useCallback((newType: DiagramType) => {
    saveToHistory();
    setHistory([]);
    setRedoStack([]);
    setParentId('');
    const target = projects[newType];
    setNodes(target.nodes);
    setEdges(target.edges);
    setDiagramType(newType);
    setSelectedNodeId(null);
    setDiagramMeta((prev) => ({ ...prev, lanes: Array.from(new Set((target.nodes || []).map((node) => node.lane).filter(Boolean))) as string[] }));
  }, [saveToHistory, projects]);

  const handleApproveToReport = useCallback(() => {
    if (!diagramMeta.reportDiagramId) {
      showToast('Diagram ini belum tersambung ke Laporan Builder.');
      return;
    }
    if (!nodes.length || !edges.length) {
      showToast('Generate atau buat diagram dulu sebelum approve.');
      return;
    }

    const reportKey = 'report_builder_project_v1';
    const saved = localStorage.getItem(reportKey);
    if (!saved) {
      showToast('Data laporan belum ditemukan.');
      return;
    }

    try {
      const project = JSON.parse(saved);
      const updatedProject = {
        ...project,
        diagrams: (project.diagrams || []).map((diagram: any) => {
          if (diagram.id !== diagramMeta.reportDiagramId) return diagram;
          return {
            ...diagram,
            status: 'approved',
            approvedAt: new Date().toISOString(),
            caption: diagram.caption || diagram.title,
            diagramData: {
              nodes,
              edges,
              meta: {
                ...diagramMeta,
                title: diagramMeta.title || diagram.title,
                lanes: diagramMeta.lanes.length ? diagramMeta.lanes : Array.from(new Set(nodes.map((node) => node.lane).filter(Boolean))),
                diagramType,
              },
            },
          };
        }),
      };
      localStorage.setItem(reportKey, JSON.stringify(updatedProject));
      showToast('Diagram approved dan masuk ke Laporan Builder.');
    } catch (error) {
      console.error('Failed to approve diagram to report:', error);
      showToast('Gagal menyimpan diagram ke laporan.');
    }
  }, [diagramMeta, diagramType, edges, nodes, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const data = JSON.stringify({ projects, activeType: diagramType, zoomLevel });
      localStorage.setItem(STORAGE_KEY, data);
    }, 1000);
    return () => clearTimeout(timer);
  }, [projects, diagramType, zoomLevel]);

  const handleSaveProject = useCallback(() => {
    const dataObj = { projects, activeType: diagramType, zoomLevel };
    const dataStr = JSON.stringify(dataObj);
    
    // Save internally
    localStorage.setItem(STORAGE_KEY, dataStr);
    
    // Trigger native file download
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uml-flow-${diagramType}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Project downloaded to device! ✅');
  }, [projects, diagramType, zoomLevel, showToast]);


  const handleClearProject = useCallback(() => {
    if (confirm(`Clear ${diagramType.toUpperCase()} diagram?`)) {
      saveToHistory();
      setNodes([]);
      setEdges([]);
      setParentId('');
      setProjects(prev => ({ ...prev, [diagramType]: { nodes: [], edges: [] } }));
    }
  }, [diagramType, saveToHistory]);


  const handleUpdateNode = useCallback((id: string, newText: string) => {
    saveToHistory();
    const MAX_WIDTH = 200;
    const CHARS_PER_LINE = 20;
    const LINE_HEIGHT = 24;
    const PADDING_V = 40;
    const lines = wrapText(newText, CHARS_PER_LINE);
    const nodeHeight = Math.max(60, lines.length * LINE_HEIGHT + PADDING_V);
    const finalWidth = lines.length > 1 ? MAX_WIDTH : Math.min(MAX_WIDTH, Math.max(120, newText.length * 10 + 40));

    setNodes(prev => prev.map(n => {
      if (n.id === id) return { ...n, text: newText, lines, width: finalWidth, height: nodeHeight };
      return n;
    }));
  }, [saveToHistory, wrapText]);

  const handleDeleteNode = useCallback((id: string) => {
    saveToHistory();
    const incomingEdges = edges.filter(e => e.toId === id);
    const outgoingEdges = edges.filter(e => e.fromId === id);
    const newEdges: DiagramEdge[] = [];
    incomingEdges.forEach(incoming => {
      outgoingEdges.forEach(outgoing => {
        const alreadyExists = edges.some(e => e.fromId === incoming.fromId && e.toId === outgoing.toId);
        if (!alreadyExists) {
          newEdges.push({
            id: `edge-reconnect-${Date.now()}-${Math.random()}`,
            fromId: incoming.fromId,
            toId: outgoing.toId,
            label: outgoing.label || incoming.label
          });
        }
      });
    });
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => [...prev.filter(e => e.fromId !== id && e.toId !== id), ...newEdges]);
    setSelectedNodeId(null);
  }, [saveToHistory, edges]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const lastHistory = history[history.length - 1];
    setRedoStack(prev => [...prev, { nodes: [...nodes], edges: [...edges] }]);
    setNodes(lastHistory.nodes);
    setEdges(lastHistory.edges);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, nodes, edges]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextRedo = redoStack[redoStack.length - 1];
    setHistory(prev => [...prev, { nodes: [...nodes], edges: [...edges] }]);
    setNodes(nextRedo.nodes);
    setEdges(nextRedo.edges);
    setRedoStack(prev => prev.slice(0, -1));
  }, [redoStack, nodes, edges]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) handleDeleteNode(selectedNodeId);
      } else if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setConnectMode(false);
        setConnectFromId(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) handleRedo(); else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, handleUndo, handleRedo, handleDeleteNode]);

  const adjustZoom = useCallback((delta: number) => {
    setZoomLevel(prev => Math.min(200, Math.max(25, prev + delta)));
  }, []);

  const handleDownload = useCallback(() => {
    const svg = document.getElementById('diagram-svg');
    if (!svg || nodes.length === 0) {
      showToast('No elements to export. Add elements first.');
      return;
    }
    const padding = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(node => {
      minX = Math.min(minX, node.x); minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width); maxY = Math.max(maxY, node.y + node.height);
    });
    minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    let width = maxX - minX;
    const height = maxY - minY;

    // Enforce minimum width so that narrow top-down diagrams are aesthetically centered
    const MIN_WIDTH = 800;
    if (width < MIN_WIDTH) {
      const extra = (MIN_WIDTH - width) / 2;
      minX -= extra;
      width = MIN_WIDTH;
    }

    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svg);
    const styleBlock = `<style>.diagram-svg{background:white;font-family:'Inter',sans-serif;}.node-shape{fill:white;stroke:#1e293b;stroke-width:1.5px;}.node-text{font-size:13px;font-weight:500;fill:#1e293b;}.connector-line{stroke:#64748b;stroke-width:2px;fill:none;}rect[fill="url(#grid)"]{display:none;}</style>`;
    source = source.replace('>', `>${styleBlock}`);
    source = source.replace(/viewBox="[^"]+"/, `viewBox="${minX} ${minY} ${width} ${height}"`);
    source = source.replace(/width="[^"]+"/, `width="${width}"`);
    source = source.replace(/height="[^"]+"/, `height="${height}"`);
    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
    
    const downloadImage = new Image();
    downloadImage.onload = () => {
      const scale = 2;
      const MAX_PART_HEIGHT = 2000; // Slice image if taller than 2000px CSS space
      const numParts = Math.ceil(height / MAX_PART_HEIGHT);

      for (let i = 0; i < numParts; i++) {
        const partHeight = Math.min(MAX_PART_HEIGHT, height - i * MAX_PART_HEIGHT);
        const canvas = document.createElement("canvas");
        
        canvas.width = width * scale; 
        canvas.height = partHeight * scale;
        
        const context = canvas.getContext("2d");
        if (context) {
          context.fillStyle = "white";
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          context.drawImage(
            downloadImage, 
            0, 
            -(i * MAX_PART_HEIGHT * scale), 
            width * scale, 
            height * scale
          );
          
          const pngUrl = canvas.toDataURL("image/png");
          const downloadLink = document.createElement("a");
          downloadLink.href = pngUrl;
          const partSuffix = numParts > 1 ? `-part${i + 1}` : '';
          downloadLink.download = `diagram-${diagramType}-${new Date().toISOString().slice(0, 10)}${partSuffix}.png`;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
        }
      }
      if (numParts > 1) {
        showToast(`Diagram was long, automatically saved as ${numParts} separate image parts.`);
      } else {
        showToast('Diagram exported as PNG! ✅');
      }
    };

    downloadImage.src = svgUrl;
  }, [nodes, diagramType, showToast]);



  const handleAddStep = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    saveToHistory();

    const newNodeId = `node-${Date.now()}`;
    const actualParentId = parentId || (nodes.length > 0 ? nodes[nodes.length - 1].id : '');
    const parentNode = nodes.find(n => n.id === actualParentId);

    if (isConnectingExisting) {
      if (!targetNodeId || !parentNode) return;
      const newEdge: DiagramEdge = {
        id: `edge-${Date.now()}`,
        fromId: parentNode.id,
        toId: targetNodeId,
        label: ((diagramType === 'flowchart' || diagramType === 'activity') && branchType !== 'main') ? branchType.toUpperCase() : undefined,
        dashed: (diagramType === 'usecase') ? isDashed : false
      };
      setEdges((prev) => [...prev, newEdge]);
      setIsConnectingExisting(false);
      return;
    }

    if (!newNodeText.trim()) return;

    const MAX_WIDTH = 250;
    const CHARS_PER_LINE = diagramType === 'usecase' || diagramType === 'sequence' ? 18 : 20;
    const LINE_HEIGHT = 24;
    const PADDING_V = 40;

    const lines = wrapText(newNodeText, CHARS_PER_LINE);
    let nodeHeight = 60;
    let finalWidth = 120;

    if (newNodeType === 'actor') {
      nodeHeight = 80; finalWidth = 60;
    } else if (newNodeType === 'fork' || newNodeType === 'join') {
      nodeHeight = 10; finalWidth = 120;
    } else if (newNodeType === 'lifeline') {
      const longestLine = Math.max(...lines.map(l => l.length));
      finalWidth = Math.max(130, Math.min(210, longestLine * 9 + 52));
      nodeHeight = 520;
    } else if (newNodeType === 'usecase') {
      const longestLine = Math.max(...lines.map(l => l.length));
      finalWidth = Math.max(140, longestLine * 9 + 60);
      nodeHeight = Math.max(70, lines.length * LINE_HEIGHT + 35);
    } else if (newNodeType === 'decision') {
      const longestLine = Math.max(...lines.map(l => l.length));
      finalWidth = Math.max(160, longestLine * 11 + 70);
      nodeHeight = Math.max(100, lines.length * LINE_HEIGHT + 60);
      if (lines.length > 2) finalWidth = Math.min(MAX_WIDTH + 60, finalWidth);
    } else {
      nodeHeight = Math.max(60, lines.length * LINE_HEIGHT + PADDING_V);
      finalWidth = lines.length > 1 ? MAX_WIDTH : Math.min(MAX_WIDTH, Math.max(120, newNodeText.length * 10 + 40));
    }


    const newNode: DiagramNode = {
      id: newNodeId, type: newNodeType, text: newNodeText, lines,
      x: 500, y: 100, width: finalWidth, height: nodeHeight,
      side: diagramType === 'usecase' ? nodeSide : undefined,
      pinned: diagramType === 'sequence' ? true : undefined
    };

    const newNodes = [...nodes, newNode];
    const newEdges = [...edges];

    if (diagramType === 'usecase') {
      if (newNodeType === 'usecase' && selectedActorIds.length > 0) {
        selectedActorIds.forEach(actorId => {
          newEdges.push({ id: `edge-${Date.now()}-${actorId}`, fromId: actorId, toId: newNodeId, dashed: isDashed });
        });
        setSelectedActorIds([]);
      }
    } else if (parentNode) {
      let edgeDirection: 'right' | 'left' | 'bottom' | 'straight' | undefined;
      if (parentNode.type === 'decision') {
        if (branchType === 'yes') edgeDirection = 'right';
        else if (branchType === 'no') edgeDirection = 'left';
        else edgeDirection = 'bottom';
      }
      newEdges.push({
        id: `edge-${Date.now()}`,
        fromId: parentNode.id,
        toId: newNode.id,
        label: ((diagramType === 'flowchart' || diagramType === 'activity') && branchType !== 'main') ? branchType.toUpperCase() : undefined,
        direction: edgeDirection,
        dashed: false
      });
      if ((diagramType === 'flowchart' || diagramType === 'activity') && parentNode.type === 'decision') {
        const pIdx = newNodes.findIndex(n => n.id === parentNode.id);
        if (pIdx !== -1) {
          if (branchType === 'yes') newNodes[pIdx] = { ...newNodes[pIdx], yes: newNode.id };
          if (branchType === 'no') newNodes[pIdx] = { ...newNodes[pIdx], no: newNode.id };
        }
      }
    }

    setNodes(newNodes);
    setEdges(newEdges);
    setNewNodeText('');
    setParentId(newNodeId);
    setBranchType('main');
  }, [saveToHistory, parentId, nodes, isConnectingExisting, targetNodeId, diagramType, branchType, isDashed, newNodeText, newNodeType, nodeSide, selectedActorIds, wrapText, edges]);

  // Icons
  const IconUndo = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>;
  const IconRedo = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>;
  const IconDownload = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
  const IconSave = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
  const IconLayout = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>;

  const propertiesPanelContent = selectedNodeId ? (
    <>
      <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4f46e5' }} />
        Element Properties
      </h3>
      
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div className={styles.inputGroup} style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
          <label>Label Text</label>
          <input
            type="text"
            value={nodes.find(n => n.id === selectedNodeId)?.text || ''}
            onChange={(e) => handleUpdateNode(selectedNodeId, e.target.value)}
            style={{ width: '100%', height: '36px' }}
          />
        </div>

        <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
          <label>Position Nudge</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gap: '4px', justifyContent: 'flex-start' }}>
            <div />
            <button className={styles.umlBtn} style={{ padding: '0', height: '36px', justifyContent: 'center', fontSize: '1rem' }} onClick={() => handleNudge(selectedNodeId, 0, -10)} title="Up">▲</button>
            <div />
            <button className={styles.umlBtn} style={{ padding: '0', height: '36px', justifyContent: 'center', fontSize: '1rem' }} onClick={() => handleNudge(selectedNodeId, -10, 0)} title="Left">◀</button>
            <button className={styles.umlBtn} style={{ padding: '0', height: '36px', justifyContent: 'center', fontSize: '1rem' }} onClick={() => handleNudge(selectedNodeId, 0, 10)} title="Down">▼</button>
            <button className={styles.umlBtn} style={{ padding: '0', height: '36px', justifyContent: 'center', fontSize: '1rem' }} onClick={() => handleNudge(selectedNodeId, 10, 0)} title="Right">▶</button>
          </div>
        </div>
      </div>


      <div style={{ marginTop: '1rem', display: 'flex', gap: '8px' }}>
        <button className={`${styles.umlBtn} ${styles.danger}`} style={{ flex: 1 }} onClick={() => handleDeleteNode(selectedNodeId)}>Delete selected element</button>
      </div>

      {nodes.find(n => n.id === selectedNodeId)?.type === 'decision' && (
        <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', marginTop: '1rem', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' }}>Branch Targets</div>
          
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '0.65rem', color: '#16a34a' }}>YES Branch</label>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexDirection: 'column' }}>
              <select
                value={edges.find(ed => ed.fromId === selectedNodeId && ed.label === 'YES')?.toId || ''}
                onChange={(e) => {
                  const targetId = e.target.value;
                  const currentDir = edges.find(ed => ed.fromId === selectedNodeId && ed.label === 'YES')?.direction || 'right';
                  saveToHistory();
                  setNodes(prev => prev.map(n => n.id === selectedNodeId ? { ...n, yes: targetId || undefined } : n));
                  setEdges(prev => {
                    const existing = prev.find(ed => ed.fromId === selectedNodeId && ed.label === 'YES');
                    if (existing) return prev.map(ed => (ed.id === existing.id ? { ...ed, toId: targetId } : ed));
                    if (!targetId) return prev;
                    return [...prev, { id: `edge-${Date.now()}`, fromId: selectedNodeId, toId: targetId, label: 'YES', direction: currentDir }];
                  });
                }}
                style={{ flex: 2, fontSize: '0.75rem', height: '30px' }}
              >
                <option value="">(none)</option>
                {nodes.map((n, i) => n.id !== selectedNodeId ? <option key={n.id} value={n.id}>[{i + 1}] {n.text}</option> : null)}
              </select>
              <select
                value={edges.find(ed => ed.fromId === selectedNodeId && ed.label === 'YES')?.direction || 'right'}
                onChange={(e) => {
                  const dir = e.target.value as 'left' | 'right' | 'bottom';
                  saveToHistory();
                  setEdges(prev => prev.map(ed => (ed.fromId === selectedNodeId && ed.label === 'YES') ? { ...ed, direction: dir } : ed));
                }}
                style={{ flex: 1, fontSize: '0.75rem', height: '30px' }}
              >
                <option value="right">Right</option>
                <option value="left">Left</option>
                <option value="bottom">Default</option>
              </select>
            </div>
          </div>
          
          <div>
            <label style={{ fontSize: '0.65rem', color: '#dc2626' }}>NO Branch</label>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexDirection: 'column' }}>
              <select
                value={edges.find(ed => ed.fromId === selectedNodeId && ed.label === 'NO')?.toId || ''}
                onChange={(e) => {
                  const targetId = e.target.value;
                  const currentDir = edges.find(ed => ed.fromId === selectedNodeId && ed.label === 'NO')?.direction || 'left';
                  saveToHistory();
                  setNodes(prev => prev.map(n => n.id === selectedNodeId ? { ...n, no: targetId || undefined } : n));
                  setEdges(prev => {
                    const existing = prev.find(ed => ed.fromId === selectedNodeId && ed.label === 'NO');
                    if (existing) return prev.map(ed => (ed.id === existing.id ? { ...ed, toId: targetId } : ed));
                    if (!targetId) return prev;
                    return [...prev, { id: `edge-${Date.now()}`, fromId: selectedNodeId, toId: targetId, label: 'NO', direction: currentDir }];
                  });
                }}
                style={{ flex: 2, fontSize: '0.75rem', height: '30px' }}
              >
                <option value="">(none)</option>
                {nodes.map((n, i) => n.id !== selectedNodeId ? <option key={n.id} value={n.id}>[{i + 1}] {n.text}</option> : null)}
              </select>
              <select
                value={edges.find(ed => ed.fromId === selectedNodeId && ed.label === 'NO')?.direction || 'left'}
                onChange={(e) => {
                  const dir = e.target.value as 'left' | 'right' | 'bottom';
                  saveToHistory();
                  setEdges(prev => prev.map(ed => (ed.fromId === selectedNodeId && ed.label === 'NO') ? { ...ed, direction: dir } : ed));
                }}
                style={{ flex: 1, fontSize: '0.75rem', height: '30px' }}
              >
                <option value="right">Right</option>
                <option value="left">Left</option>
                <option value="bottom">Default</option>
              </select>
            </div>
          </div>

        </div>
      )}
    </>
  ) : null;


  return (
    <div className={styles.umlPage}>


      <main className={`${styles.mainContainer} ${layoutMode === 'side-by-side' ? styles.sideBySide : ''}`}>

        <div className={styles.controlsCard} style={layoutMode === 'side-by-side' ? { width: `${sidebarWidth}px`, minWidth: '300px' } : {}}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: layoutMode === 'side-by-side' ? '1rem' : '0' }}>
            <div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0 }}>UML Flow Studio</h1>
              {layoutMode === 'side-by-side' && <p style={{ color: '#64748b', fontSize: '0.75rem', margin: 0, marginTop: '4px' }}>Professional automated diagramming platform.</p>}
            </div>
          </header>



          {showOnboarding && (
            <div style={{ background: 'linear-gradient(to right, #eef2ff, #e0e7ff)', border: '1px solid #c7d2fe', borderRadius: '12px', padding: '12px 16px', fontSize: '0.85rem', color: '#3730a3', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}><Sparkles size={16} /> Cara Pakai:</strong>
                <button onClick={() => { setShowOnboarding(false); localStorage.setItem('uml-onboarding-seen', '1'); }} style={{ background: 'white', border: '1px solid #c7d2fe', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6366f1' }}><X size={14} /></button>
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.5 }}>
                <li>Pilih mode diagram (Flowchart, Use Case).</li>
                <li>Ketik nama kotak, lalu klik <strong>Add Element</strong>.</li>
                <li>Atau tekan tombol <strong>AI (✨)</strong> di pojok kanan bawah untuk buat otomatis!</li>
              </ul>
            </div>
          )}

          {connectMode && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '8px 14px', fontSize: '0.8rem', color: '#92400e', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={16} /> <strong>Connect Mode</strong> — {connectFromId ? 'Click a target element.' : 'Click the source element.'}
            </div>
          )}

          {toast && (
            <div style={{ background: '#1e293b', color: 'white', borderRadius: '8px', padding: '8px 14px', fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={16} /> {toast}
            </div>
          )}

          {/* Toolbar */}
          <div className={styles.toolbarRow}>
            <div className={styles.buttonGroup}>
              <button className={styles.umlBtn} onClick={handleUndo} disabled={history.length === 0}><IconUndo /> Undo</button>
              <button className={styles.umlBtn} onClick={handleRedo} disabled={redoStack.length === 0}><IconRedo /> Redo</button>
              <div style={{ width: '1px', height: '18px', background: '#e2e8f0', margin: '0 4px' }} />
              <button className={styles.umlBtn} onClick={() => adjustZoom(-10)}>-</button>
              <span style={{ fontSize: '0.8125rem', fontWeight: '700', minWidth: '35px', textAlign: 'center' }}>{zoomLevel}%</span>
              <button className={styles.umlBtn} onClick={() => adjustZoom(10)}>+</button>
              <button className={styles.umlBtn} onClick={() => setZoomLevel(100)} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}>Reset</button>
            </div>

            <div className={styles.buttonGroup} style={{ marginTop: '0.5rem' }}>
              <button className={`${styles.umlBtn} ${styles.primary}`} onClick={handleSaveProject}><IconSave /> Save</button>
              <button className={styles.umlBtn} onClick={handleDownload}><IconDownload /> PNG</button>
              <div style={{ width: '1px', height: '18px', background: '#e2e8f0', margin: '0 4px' }} />
              <button className={`${styles.umlBtn} ${styles.danger}`} onClick={handleClearProject}>Clear</button>

              <div style={{ width: '1px', height: '18px', background: '#e2e8f0', margin: '0 4px' }} />
              <button
                className={styles.umlBtn}
                onClick={() => { setConnectMode(m => !m); setConnectFromId(null); }}
                style={{ background: connectMode ? '#fff7ed' : 'white', borderColor: connectMode ? '#ea580c' : '#e2e8f0', color: connectMode ? '#c2410c' : undefined, display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {connectMode ? <><Square size={14} /> Stop Connect</> : <><Zap size={14} /> Connect</>}
              </button>
              <div style={{ width: '1px', height: '18px', background: '#e2e8f0', margin: '0 4px' }} />
              <button
                className={styles.umlBtn}
                onClick={() => setLayoutMode(layoutMode === 'top-bottom' ? 'side-by-side' : 'top-bottom')}
                style={{ background: layoutMode === 'side-by-side' ? '#f1f5f9' : 'white' }}
              >
                <IconLayout /> {layoutMode === 'side-by-side' ? 'Standard' : 'Sidebar'}
              </button>
            </div>
          </div>


          {/* Config Row */}
          <div className={styles.formRow}>
            <div className={styles.inputGroup}>
              <label>Diagram Mode</label>
              <select value={diagramType} onChange={(e) => handleSwitchDiagram(e.target.value as DiagramType)}>
                <option value="flowchart">Flowchart</option>
                <option value="usecase">Use Case Diagram</option>
                <option value="activity">Activity Diagram</option>
                <option value="sequence">Sequence Diagram</option>
                <optgroup label="— Coming Soon —">
                  <option value="class" disabled>Class Diagram (soon)</option>
                  <option value="state" disabled>State Diagram (soon)</option>
                </optgroup>
              </select>
            </div>

            <div className={styles.inputGroup}>
              <label>{(diagramType === 'flowchart' || diagramType === 'activity') ? 'Continue From' : diagramType === 'sequence' ? 'Participant' : 'Target Actor'}</label>
              {(diagramType === 'flowchart' || diagramType === 'activity') ? (
                <select value={parentId} onChange={(e) => { saveToHistory(); setParentId(e.target.value); }}>
                  <option value="">(Last Symbol)</option>
                  {nodes.map((n, i) => <option key={n.id} value={n.id}>[{i + 1}] {n.text.substring(0, 30)}</option>)}
                </select>
              ) : diagramType === 'sequence' ? (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', padding: '5px', border: '1px solid #e2e8f0', borderRadius: '4px', background: 'white', minHeight: '36px' }}>
                  {nodes.filter(n => n.type === 'lifeline').map((participant, i) => (
                    <span key={participant.id} style={{ padding: '4px 8px', borderRadius: '999px', background: '#f1f5f9', color: '#475569', fontSize: '0.7rem', fontWeight: 800 }}>[{i + 1}] {participant.text}</span>
                  ))}
                  {nodes.filter(n => n.type === 'lifeline').length === 0 && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Belum ada participant</span>}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', padding: '5px', border: '1px solid #e2e8f0', borderRadius: '4px', background: 'white', minHeight: '36px' }}>
                  {nodes.filter(n => n.type === 'actor').map(actor => (
                    <button
                      key={actor.id}
                      className={`${styles.umlBtn} ${selectedActorIds.includes(actor.id) ? styles.primary : ''}`}
                      onClick={() => handleToggleActorSelection(actor.id)}
                      style={{ padding: '2px 8px', fontSize: '0.7rem', height: 'auto' }}
                    >
                      {actor.text}
                    </button>
                  ))}
                  {nodes.filter(n => n.type === 'actor').length === 0 && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>No Actors</span>}
                </div>
              )}
            </div>

            <div className={styles.inputGroup}>
              <label>Symbol Type</label>
              <select value={newNodeType} onChange={(e) => setNewNodeType(e.target.value as NodeType)}>
                {diagramType === 'flowchart' ? (
                  <>
                    <option value="process">Process (Box)</option>
                    <option value="decision">Decision (Diamond)</option>
                    <option value="start">Start (Oval)</option>
                    <option value="end">End (Oval)</option>
                  </>
                ) : diagramType === 'activity' ? (
                  <>
                    <option value="activity">Activity (Rounded)</option>
                    <option value="decision">Decision/Merge (Diamond)</option>
                    <option value="fork">Fork (Split)</option>
                    <option value="join">Join (Merge)</option>
                    <option value="start">Initial Node (Circle)</option>
                    <option value="end">Final Node (Circle)</option>
                  </>
                ) : diagramType === 'sequence' ? (
                  <>
                    <option value="lifeline">Participant / Lifeline</option>
                  </>
                ) : (
                  <>
                    <option value="actor">Actor (Figure)</option>
                    <option value="usecase">Use Case (Oval)</option>
                  </>
                )}
              </select>
            </div>


            {diagramType === 'usecase' && (
              <div className={styles.inputGroup}>
                <label>Position / Style</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select value={nodeSide} onChange={(e) => setNodeSide(e.target.value as 'left' | 'right' | 'center')} style={{ flex: 1 }}>
                    <option value="left">Left Side</option>
                    <option value="right">Right Side</option>
                  </select>
                  <button className={styles.umlBtn} onClick={() => setIsDashed(!isDashed)} style={{ background: isDashed ? '#f1f5f9' : 'white', borderColor: isDashed ? '#4f46e5' : '#e2e8f0' }}>
                    {isDashed ? 'Solid' : 'Dashed'}
                  </button>
                </div>
              </div>
            )}

            <div className={styles.inputGroup} style={{ flex: 2, minWidth: '300px', maxWidth: '600px' }}>
              <label>Element Label</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>

                <input
                  type="text"
                  value={newNodeText}
                  onChange={(e) => setNewNodeText(e.target.value.slice(0, 80))}
                  placeholder="Type text here... (max 80 chars)"
                  maxLength={80}
                  style={{ flex: 1, minWidth: '200px' }}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddStep(e)}
                />
                <button className={`${styles.umlBtn} ${styles.primary}`} onClick={handleAddStep} style={{ padding: '0 1.25rem', whiteSpace: 'nowrap' }}>Add Element</button>

              </div>
            </div>
          </div>


          {/* Properties Panel (Integrated into Sidebar) */}
          {layoutMode === 'side-by-side' && propertiesPanelContent && (
            <div className={styles.desktopOnly} style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '2px solid #f1f5f9' }}>
               {propertiesPanelContent}
            </div>
          )}



          {layoutMode === 'side-by-side' && (
            <footer style={{ marginTop: 'auto', padding: '1rem 0', color: '#94a3b8', fontSize: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
              UML Flow Studio • Professional Edition
            </footer>
          )}
        </div>


        {layoutMode === 'side-by-side' && (
          <div className={styles.resizer} onMouseDown={startResizing} />
        )}

        <div 
          className={styles.canvasContainer} 
          onClick={(e) => {
            if (e.target === e.currentTarget || (e.target as Element).id === 'diagram-svg') {
              setSelectedNodeId(null);
            }
          }}
        >

          <DiagramCanvas
            nodes={nodes}
            edges={edges}
            lanes={diagramMeta.lanes}
            onNodeClick={handleNodeClick}
            onNodeDragStart={handleNodeDragStart}
            onNodeDrag={handleNodeDrag}
            onNodeResizeStart={handleNodeResizeStart}
            onNodeResize={handleNodeResize}
            connectMode={connectMode}

            connectFromId={connectFromId}
            selectedNodeId={selectedNodeId}
            zoomLevel={zoomLevel}
            onZoomChange={adjustZoom}
          />

        </div>


        {propertiesPanelContent && (
          <div className={`${styles.controlsCard} ${layoutMode === 'side-by-side' ? styles.mobileOnly : ''}`} style={{ marginTop: '1rem', width: '100%', maxWidth: '1000px', margin: '1rem auto 0 auto' }}>
            {propertiesPanelContent}
          </div>
        )}

        {layoutMode === 'top-bottom' && (

          <footer style={{ marginTop: '2rem', padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
            UML Flow Studio • Professional Diagram Studio
          </footer>
        )}

      </main>

      {/* AI Floating Button */}
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 100, display: 'flex', alignItems: 'center', gap: '12px' }}>
        {diagramMeta.reportDiagramId && (
          <button
            onClick={handleApproveToReport}
            disabled={nodes.length === 0 || edges.length === 0}
            style={{
              height: '44px',
              borderRadius: '999px',
              border: '1px solid #bbf7d0',
              background: nodes.length && edges.length ? '#16a34a' : '#94a3b8',
              color: 'white',
              padding: '0 16px',
              fontSize: '0.82rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: nodes.length && edges.length ? 'pointer' : 'not-allowed',
              boxShadow: '0 4px 14px rgba(22, 163, 74, 0.24)'
            }}
            title="Setujui diagram dan masukkan ke Laporan Builder"
          >
            <CheckCircle2 size={18} /> Approve ke Laporan
          </button>
        )}
        <div style={{ background: 'white', padding: '8px 16px', borderRadius: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', fontSize: '0.85rem', fontWeight: 700, color: '#4f46e5', border: '1px solid #e0e7ff', animation: 'bounce 2s infinite' }}>
          Mau gampang? Pake AI aja 👉
        </div>
        <button
          onClick={() => {
            setAiClarification('');
            setIsAiModalOpen(true);
          }}
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            color: 'white',
            border: 'none',
            boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(79, 70, 229, 0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(79, 70, 229, 0.4)'; }}
          title="Bikin Diagram Otomatis dengan AI"
        >
          <Sparkles size={32} />
        </button>
      </div>

      {/* AI Modal */}
      {isAiModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 200,
          padding: '1rem'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '500px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden'
          }}>
            <div style={{
              background: 'linear-gradient(145deg, #f8fafc, #f1f5f9)',
              padding: '1rem 1.5rem',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#4f46e5', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} />
                AI UML Assistant
              </h3>
              <button 
                onClick={() => setIsAiModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px', display: 'flex' }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '1.5rem' }}>
              <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '1rem', lineHeight: 1.5 }}>
                Gambarkan alur proses yang Anda inginkan (contoh: "buatkan alur login", atau "tambahkan node lupa password di flow yang ada"), AI akan merancang atau memodifikasi diagram Anda secara otomatis.
              </p>

              {aiClarification && (
                <div style={{
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  color: '#9a3412',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  lineHeight: 1.5,
                  marginBottom: '1rem'
                }}>
                  {aiClarification}
                </div>
              )}
              
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Deskripsikan diagram atau perubahan yang Anda inginkan..."
                disabled={isGeneratingAI}
                style={{ 
                  width: '100%', 
                  minHeight: '100px', 
                  padding: '12px', 
                  fontSize: '0.9rem', 
                  borderRadius: '8px', 
                  border: '1px solid #cbd5e1', 
                  resize: 'vertical',
                  marginBottom: '1rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => e.target.style.borderColor = '#6366f1'}
                onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
              />
              
              <button 
                onClick={handleGenerateAI}
                disabled={isGeneratingAI || !aiPrompt.trim()}
                style={{ 
                  background: isGeneratingAI ? '#94a3b8' : 'linear-gradient(to right, #4f46e5, #7c3aed)', 
                  border: 'none', 
                  color: 'white', 
                  padding: '0 1.5rem', 
                  width: '100%', 
                  height: '44px', 
                  borderRadius: '8px',
                  fontSize: '0.95rem',
                  fontWeight: 600, 
                  display: 'flex', 
                  justifyContent: 'center', 
                  alignItems: 'center', 
                  gap: '8px',
                  cursor: (isGeneratingAI || !aiPrompt.trim()) ? 'not-allowed' : 'pointer'
                }}
              >
                {isGeneratingAI ? <><BrainCircuit size={18} /> Mikirin Diagram...</> : <><Sparkles size={18} /> Generate / Update Diagram</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


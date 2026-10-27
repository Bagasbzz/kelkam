'use client';

import { useState } from 'react';
import type { DiagramEdge, DiagramNode, RelationKind } from '@/lib/types/diagram';
import { layoutStructure, structuralSpecErrors, structureToDiagram, type StructuralDiagramType, type StructureSpec } from '@/lib/uml/structure';

interface Props {
  diagramType: StructuralDiagramType;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  onChange: (nodes: DiagramNode[], edges: DiagramEdge[]) => void;
  onError: (message: string) => void;
}

export default function StructureControls({ diagramType, nodes, edges, onChange, onError }: Props) {
  const [name, setName] = useState('');
  const [attributes, setAttributes] = useState('');
  const [operations, setOperations] = useState('');
  const [kind, setKind] = useState('');
  const [parent, setParent] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [relation, setRelation] = useState<RelationKind>('association');
  const [label, setLabel] = useState('');
  const [fromCardinality, setFromCardinality] = useState('1');
  const [toCardinality, setToCardinality] = useState('0..*');
  const kinds = diagramType === 'class' ? ['class'] : diagramType === 'state' ? ['initial', 'state', 'final'] : diagramType === 'erd' ? ['entity'] : diagramType === 'component' ? ['component', 'interface'] : ['device', 'execution', 'artifact'];
  const selectedKind = kinds.includes(kind) ? kind : kinds[0];
  const spec = (): StructureSpec => ({ elements: nodes.map((n) => ({ id: n.id, name: n.text, kind: n.type as NonNullable<StructureSpec['elements']>[number]['kind'], attributes: n.attributes, operations: n.operations, stereotype: n.stereotype, parent: n.parentId })), relations: edges.map((e) => ({ from: e.fromId, to: e.toId, kind: e.relation, label: e.label, fromCardinality: e.fromCardinality, toCardinality: e.toCardinality })) });
  const addElement = () => {
    let number = 1;
    while (nodes.some((n) => n.id === `element-${number}`)) number += 1;
    const value = spec();
    value.elements = [...(value.elements ?? []), { id: `element-${number}`, name: name.trim() || (selectedKind === 'initial' ? 'Mulai' : selectedKind === 'final' ? 'Selesai' : ''), kind: selectedKind as NonNullable<StructureSpec['elements']>[number]['kind'], attributes: attributes.split('\n').filter(Boolean), operations: operations.split('\n').filter(Boolean), parent: parent || undefined }];
    // State boleh belum lengkap saat dirakit; validasi penuh berjalan saat persetujuan.
    if (!value.elements[value.elements.length - 1].name) { onError('Isi nama elemen.'); return; }
    if (value.elements.length > 18) { onError('Maksimal 18 elemen per diagram.'); return; }
    if (diagramType === 'state' && selectedKind === 'initial' && nodes.some((n) => n.type === 'initial')) { onError('Diagram state hanya boleh memiliki satu initial.'); return; }
    try {
      if (diagramType === 'state') {
        const n: DiagramNode = { id: `element-${number}`, type: selectedKind as DiagramNode['type'], text: value.elements[value.elements.length - 1].name, lines: [], x: 0, y: 0, width: selectedKind === 'state' ? 180 : 32, height: selectedKind === 'state' ? 64 : 32, pinned: true };
        onChange(layoutStructure([...nodes, n], edges, diagramType), edges);
      } else {
        const errors = structuralSpecErrors(value, diagramType);
        if (errors.length) { onError(errors[0]); return; }
        const result = structureToDiagram(value, diagramType);
        onChange(result.nodes, result.edges);
      }
      setName(''); setAttributes(''); setOperations('');
    } catch (error) { onError(error instanceof Error ? error.message : 'Elemen tidak valid.'); }
  };
  const addRelation = () => {
    const source = from || nodes[0]?.id, target = to || nodes[1]?.id || source;
    if (!source || !target) { onError('Tambahkan elemen lebih dulu.'); return; }
    const selectedRelation = diagramType === 'state' ? 'transition' : diagramType === 'erd' ? 'association' : relation;
    const allowed = diagramType === 'class' ? ['association', 'inheritance', 'realization', 'aggregation', 'composition', 'dependency'] : diagramType === 'component' ? ['association', 'dependency', 'realization'] : diagramType === 'deployment' ? ['association', 'dependency', 'communication'] : [selectedRelation];
    if (!allowed.includes(selectedRelation)) { onError('Pilih jenis relasi yang sesuai tipe diagram.'); return; }
    const next: DiagramEdge[] = [...edges, { id: `relation-${edges.length + 1}-${source}-${target}`, fromId: source, toId: target, label: label || undefined, relation: selectedRelation, fromCardinality: diagramType === 'erd' ? fromCardinality : undefined, toCardinality: diagramType === 'erd' ? toCardinality : undefined }];
    if (next.length > 36) { onError('Maksimal 36 relasi.'); return; }
    if (diagramType === 'state' && (nodes.find((n) => n.id === source)?.type === 'final' || nodes.find((n) => n.id === target)?.type === 'initial')) { onError('Final tidak boleh memiliki transisi keluar dan initial tidak boleh punya transisi masuk.'); return; }
    if (diagramType === 'state' && nodes.find((n) => n.id === source)?.type === 'initial' && edges.some((e) => e.fromId === source)) { onError('Initial hanya boleh memiliki satu transisi keluar.'); return; }
    if (diagramType !== 'state') {
      const errors = structuralSpecErrors({ ...spec(), relations: next.map((e) => ({ from: e.fromId, to: e.toId, kind: e.relation, label: e.label, fromCardinality: e.fromCardinality, toCardinality: e.toCardinality })) }, diagramType);
      if (errors.length) { onError(errors[0]); return; }
    }
    onChange(nodes, next);
  };
  const options = nodes.map((n) => <option key={n.id} value={n.id}>{n.text}</option>);
  return <section aria-label="Editor diagram struktural" style={{ display: 'grid', gap: 8, width: '100%', minWidth: 0 }}>
    <label>Simbol<select value={selectedKind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
    <label>Nama<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
    {['class', 'erd'].includes(diagramType) && <label>Atribut (satu per baris, ERD gunakan PK/FK)<textarea value={attributes} maxLength={2000} onChange={(e) => setAttributes(e.target.value)} /></label>}
    {diagramType === 'class' && <label>Operasi (satu per baris)<textarea value={operations} maxLength={2000} onChange={(e) => setOperations(e.target.value)} /></label>}
    {diagramType === 'deployment' && <label>Container<select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Tanpa container</option>{nodes.filter((n) => ['device', 'execution'].includes(n.type)).map((n) => <option key={n.id} value={n.id}>{n.text}</option>)}</select></label>}
    <button type="button" onClick={addElement}>Tambah Elemen</button>
    <label>Relasi Dari<select value={from || nodes[0]?.id || ''} onChange={(e) => setFrom(e.target.value)}>{options}</select></label>
    <label>Relasi Ke<select value={to || nodes[1]?.id || nodes[0]?.id || ''} onChange={(e) => setTo(e.target.value)}>{options}</select></label>
    {!['state', 'erd'].includes(diagramType) && <label>Notasi Relasi<select value={relation} onChange={(e) => setRelation(e.target.value as RelationKind)}>{(diagramType === 'class' ? ['association', 'inheritance', 'realization', 'aggregation', 'composition', 'dependency'] : diagramType === 'component' ? ['association', 'dependency', 'realization'] : ['association', 'dependency', 'communication']).map((r) => <option key={r}>{r}</option>)}</select></label>}
    <label>Label Relasi<input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></label>
    {diagramType === 'erd' && <><label>Kardinalitas Asal<input value={fromCardinality} maxLength={20} onChange={(e) => setFromCardinality(e.target.value)} /></label><label>Kardinalitas Tujuan<input value={toCardinality} maxLength={20} onChange={(e) => setToCardinality(e.target.value)} /></label></>}
    <button type="button" onClick={addRelation}>Tambah Relasi</button>
    {edges.map((e) => <div key={e.id} style={{ display: 'flex', gap: 8 }}><span>{nodes.find((n) => n.id === e.fromId)?.text} → {nodes.find((n) => n.id === e.toId)?.text} ({e.relation})</span><button type="button" onClick={() => onChange(nodes, edges.filter((item) => item.id !== e.id))}>Hapus Relasi</button></div>)}
  </section>;
}

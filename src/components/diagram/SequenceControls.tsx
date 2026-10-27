'use client';

import { useState } from 'react';
import type { DiagramEdge, DiagramNode, FragmentKind, MessageKind, ParticipantKind } from '@/lib/types/diagram';
import { diagramToSequenceSpec, FRAGMENT_KINDS, MESSAGE_KINDS, PARTICIPANT_KINDS, sequenceSpecErrors, sequenceToDiagram } from '@/lib/uml/sequence';

interface Props {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  onChange: (nodes: DiagramNode[], edges: DiagramEdge[]) => void;
  onError: (message: string) => void;
}

export default function SequenceControls({ nodes, edges, onChange, onError }: Props) {
  const [symbol, setSymbol] = useState('message');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MessageKind>('sync');
  const [participantKind, setParticipantKind] = useState<ParticipantKind>('participant');
  const [fragmentKind, setFragmentKind] = useState<FragmentKind>('alt');
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState(2);
  const [split, setSplit] = useState(2);
  const [depth, setDepth] = useState(0);
  const [guard, setGuard] = useState('kondisi');
  const [elseGuard, setElseGuard] = useState('kondisi lain');
  const participants = nodes.filter((n) => n.type === 'lifeline');
  const source = fromId || participants[0]?.id || '';
  const target = toId || participants[1]?.id || source;
  const add = () => {
    const spec = diagramToSequenceSpec(nodes, edges);
    if (symbol === 'participant') {
      if (!text.trim()) { onError('Isi nama participant.'); return; }
      let number = 1;
      while (nodes.some((n) => n.id === `participant-${number}`)) number += 1;
      spec.participants = [...(spec.participants ?? []), { id: `participant-${number}`, name: text.trim(), kind: participantKind }];
      if (spec.participants.length > 6) { onError('Maksimal enam participant.'); return; }
    } else if (symbol === 'message') {
      if (!source || !target || !text.trim()) { onError('Pilih asal, tujuan, dan isi label pesan.'); return; }
      spec.messages = [...(spec.messages ?? []), { from: source, to: target, text: text.trim(), kind }];
      if (spec.messages.length > 12) { onError('Maksimal dua belas pesan per diagram.'); return; }
    } else if (symbol === 'activation') {
      spec.activations = [...(spec.activations ?? []), { participant: source, from: first, to: last, depth }];
    } else if (symbol === 'fragment') {
      const operands = [{ from: first, guard }];
      if (fragmentKind === 'alt') operands.push({ from: split, guard: elseGuard });
      spec.fragments = [...(spec.fragments ?? []), { kind: fragmentKind, from: first, to: last, operands }];
    } else {
      spec.notes = [...(spec.notes ?? []), { kind: symbol === 'ref' ? 'ref' : 'note', text: text.trim(), after: first, participants: [...new Set([source, target].filter(Boolean))] }];
    }
    const errors = sequenceSpecErrors(spec);
    if (errors.length) { onError(errors[0]); return; }
    const result = sequenceToDiagram(spec);
    onChange(result.nodes, result.edges);
    setText('');
  };
  const participantOptions = participants.map((p) => <option key={p.id} value={p.id}>{p.text}</option>);
  return (
    <section aria-label="Editor simbol sequence" style={{ display: 'grid', gap: 8, marginTop: 16, minWidth: 0, width: '100%' }}>
      <label>Simbol Sequence<select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
        <option value="participant">Participant</option><option value="message">Pesan</option><option value="activation">Activation</option><option value="fragment">Fragment</option><option value="note">Catatan</option><option value="ref">Referensi Interaksi</option>
      </select></label>
      {symbol !== 'participant' && <label>Participant Asal<select value={source} onChange={(e) => setFromId(e.target.value)}>{participantOptions}</select></label>}
      {['message', 'note', 'ref'].includes(symbol) && <label>Participant Tujuan<select value={target} onChange={(e) => setToId(e.target.value)}>{participantOptions}</select></label>}
      {symbol === 'participant' && <label>Bentuk Kepala<select value={participantKind} onChange={(e) => setParticipantKind(e.target.value as ParticipantKind)}>{PARTICIPANT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>}
      {symbol === 'message' && <label>Jenis Pesan<select value={kind} onChange={(e) => setKind(e.target.value as MessageKind)}>{MESSAGE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>}
      {['activation', 'fragment', 'note', 'ref'].includes(symbol) && <label>{['note', 'ref'].includes(symbol) ? 'Setelah Pesan (0 = sebelum pertama)' : 'Dari Pesan'}<input type="number" min={symbol === 'note' || symbol === 'ref' ? 0 : 1} max={edges.length} value={first} onChange={(e) => setFirst(Number(e.target.value))} /></label>}
      {['activation', 'fragment'].includes(symbol) && <label>Sampai Pesan<input type="number" min={1} max={edges.length} value={last} onChange={(e) => setLast(Number(e.target.value))} /></label>}
      {symbol === 'activation' && <label>Tingkat Bersarang<input type="number" min={0} max={5} value={depth} onChange={(e) => setDepth(Number(e.target.value))} /></label>}
      {symbol === 'fragment' && <>
        <label>Operator<select value={fragmentKind} onChange={(e) => setFragmentKind(e.target.value as FragmentKind)}>{FRAGMENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label>Kondisi<input value={guard} maxLength={100} onChange={(e) => setGuard(e.target.value)} /></label>
        {fragmentKind === 'alt' && <><label>Pesan Awal Cabang Lain<input type="number" min={first + 1} max={last} value={split} onChange={(e) => setSplit(Number(e.target.value))} /></label><label>Kondisi Cabang Lain<input value={elseGuard} maxLength={100} onChange={(e) => setElseGuard(e.target.value)} /></label></>}
      </>}
      {!['activation', 'fragment'].includes(symbol) && <label>Label<input value={text} maxLength={120} onChange={(e) => setText(e.target.value)} /></label>}
      <button type="button" onClick={add}>Tambah Simbol Sequence</button>
      <small>Perubahan struktur merapikan ulang diagram. Untuk self-message pilih asal dan tujuan yang sama.</small>
      {edges.map((edge, i) => <label key={edge.id}>Pesan {i + 1}<input value={edge.label ?? ''} maxLength={120} onChange={(e) => onChange(nodes, edges.map((item) => item.id === edge.id ? { ...item, label: e.target.value } : item))} /></label>)}
    </section>
  );
}

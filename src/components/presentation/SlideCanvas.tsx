"use client";

import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { adjustSlideElement, constrainBounds, renderSlideSvg, SLIDE_HEIGHT, SLIDE_WIDTH, type Bounds } from "@/lib/presentation/layout";
import { sceneFor } from "@/lib/presentation/design";
import type { PresentationDeck, PresentationSlide } from "@/lib/presentation/model";
import styles from "./presentation.module.css";

export type EditTarget = "title" | "eyebrow" | "body-0" | "body-1" | "body-2" | "body-3" | "art";
export const TARGET_LABELS: Record<EditTarget, string> = { title: "Judul", eyebrow: "Label", "body-0": "Teks 1", "body-1": "Teks 2", "body-2": "Teks 3", "body-3": "Teks 4", art: "Gambar" };

export function setObjectBounds(slide: PresentationSlide, target: EditTarget, bounds: Bounds): PresentationSlide {
  return adjustSlideElement(slide, target, bounds);
}

export default function SlideCanvas({ deck, index, disabled, selected, onSelect, onChange }: {
  deck: PresentationDeck; index: number; disabled: boolean; selected: EditTarget | null;
  onSelect: (target: EditTarget) => void; onChange: (slide: PresentationSlide) => void;
}) {
  const slide = deck.slides[index];
  const scene = sceneFor(deck, index, slide);
  const svg = renderSlideSvg(scene);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointer: number; target: EditTarget; mode: "move" | "resize"; origin: Bounds; left: number; top: number; width: number; height: number; startX: number; startY: number } | null>(null);
  const [draft, setDraft] = useState<{ target: EditTarget; bounds: Bounds } | null>(null);
  const pendingBounds = useRef<{ target: EditTarget; bounds: Bounds } | null>(null);
  const elements = scene.elements.filter((element) => element.editKey);

  function begin(event: PointerEvent<HTMLButtonElement>, target: EditTarget, bounds: Bounds, mode: "move" | "resize") {
    onSelect(target);
    if (disabled || !surface.current) return;
    const rect = surface.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, target, mode, origin: bounds, left: rect.left, top: rect.top, width: rect.width, height: rect.height, startX: event.clientX, startY: event.clientY };
    pendingBounds.current = { target, bounds }; setDraft({ target, bounds });
  }

  function moved(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = (event.clientX - current.startX) / current.width * SLIDE_WIDTH;
    const dy = (event.clientY - current.startY) / current.height * SLIDE_HEIGHT;
    const next = { target: current.target, bounds: constrainBounds(current.mode === "move"
      ? { ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy }
      : { ...current.origin, w: Math.min(SLIDE_WIDTH - current.origin.x, current.origin.w + dx), h: Math.min(SLIDE_HEIGHT - current.origin.y, current.origin.h + dy) }) };
    pendingBounds.current = next; setDraft(next);
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    const pending = pendingBounds.current;
    const changed = pending && (["x", "y", "w", "h"] as const).some((key) => Math.abs(pending.bounds[key] - current.origin[key]) > 0.0001);
    if (pending && changed && !disabled && !cancelled) onChange(setObjectBounds(slide, pending.target, pending.bounds));
    pendingBounds.current = null;
    setDraft(null);
  }

  function keyMove(event: KeyboardEvent<HTMLButtonElement>, target: EditTarget, bounds: Bounds) {
    if (disabled) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = arrows[event.key as keyof typeof arrows];
    if (!delta) return;
    event.preventDefault(); const step = event.shiftKey ? 0.2 : 0.05;
    onChange(setObjectBounds(slide, target, { ...bounds, x: bounds.x + delta[0] * step, y: bounds.y + delta[1] * step }));
  }

  const previewSlide = draft ? setObjectBounds(slide, draft.target, draft.bounds) : slide;
  const previewSvg = draft ? renderSlideSvg(sceneFor(deck, index, previewSlide)) : svg;
  return <div className={styles.canvasWrap} ref={surface}>
    <div className={styles.preview} role="img" aria-label={`Slide ${index + 1}: ${slide.title}`} dangerouslySetInnerHTML={{ __html: previewSvg }} />
    {elements.map((element) => {
      const target = element.editKey as EditTarget;
      const bounds = draft?.target === target ? draft.bounds : element;
      return <div key={target} className={`${styles.objectBox} ${selected === target ? styles.selectedObject : ""}`} style={{ left: `${bounds.x / SLIDE_WIDTH * 100}%`, top: `${bounds.y / SLIDE_HEIGHT * 100}%`, width: `${bounds.w / SLIDE_WIDTH * 100}%`, height: `${bounds.h / SLIDE_HEIGHT * 100}%` }}>
        <button aria-label={`Pilih dan geser ${TARGET_LABELS[target]}`} className={styles.objectHit} aria-pressed={selected === target} onFocus={() => onSelect(target)} onClick={() => onSelect(target)} onPointerDown={(e) => begin(e, target, element, "move")} onPointerMove={moved} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)} onLostPointerCapture={(e) => finish(e, true)} onKeyDown={(e) => keyMove(e, target, element)} />
        {selected === target && !disabled && <button aria-label={`Ubah ukuran ${TARGET_LABELS[target]}`} className={styles.resizeHandle} onPointerDown={(e) => begin(e, target, element, "resize")} onPointerMove={moved} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)} onLostPointerCapture={(e) => finish(e, true)} />}
      </div>;
    })}
  </div>;
}

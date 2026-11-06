"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Maximize2, X } from "lucide-react";
import { layoutSlide, renderSlideSvg } from "@/lib/presentation/layout";
import type { PresentationDeck } from "@/lib/presentation/model";
import styles from "./presentation.module.css";

export default function SlidePlayer({ deck, initialIndex, onClose }: { deck: PresentationDeck; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const container = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const visibleIndex = Math.min(index, deck.slides.length - 1);
  const slide = deck.slides[visibleIndex];
  const motion = slide.visual?.motion || "none";
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container.current?.focus();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(event.key)) { event.preventDefault(); setIndex((value) => Math.min(deck.slides.length - 1, value + 1)); }
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); }
      if (event.key === "Tab" && container.current) {
        const items = Array.from(container.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = current < 0 ? (event.shiftKey ? items.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + items.length) % items.length;
        event.preventDefault(); items[next]?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", key); previousFocus.current?.focus(); };
  }, [deck.slides.length]);
  return <div className={styles.player} ref={container} role="dialog" aria-modal="true" aria-label="Tayangan presentasi" tabIndex={-1}>
    <div className={styles.playerTop}><span>{deck.title}</span><button onClick={() => { const result = container.current?.requestFullscreen?.(); result?.catch(() => {}); }}><Maximize2 size={17} /> Layar penuh</button><button onClick={onClose} aria-label="Tutup tayangan"><X size={22} /></button></div>
    <div className={styles.playerStage}>
      <div key={slide.id} className={`${styles.playerSlide} ${styles.motionPreview}`} data-motion={motion} role="img" aria-label={`Slide ${visibleIndex + 1}: ${slide.title}`} dangerouslySetInnerHTML={{ __html: renderSlideSvg(layoutSlide(slide, deck.theme, visibleIndex, deck.slides.length, deck.artDirection, deck.palette)) }} />
    </div>
    <div className={styles.playerBottom}><button disabled={!visibleIndex} onClick={() => setIndex((value) => Math.max(0, Math.min(value, deck.slides.length - 1) - 1))}><ArrowLeft size={20} /> Sebelumnya</button><span aria-live="polite">{visibleIndex + 1} / {deck.slides.length}</span><button disabled={visibleIndex === deck.slides.length - 1} onClick={() => setIndex((value) => Math.min(deck.slides.length - 1, value + 1))}>Berikutnya <ArrowRight size={20} /></button></div>
    <p className={styles.playerNote}>Tayangan web. Transisi PPTX dapat berbeda; periksa melalui Slide Show di PowerPoint.</p>
  </div>;
}

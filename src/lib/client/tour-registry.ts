"use client";
/**
 * Registri panduan halaman aktif. GuidedTour mendaftarkan dirinya di sini, lalu Navbar menampilkan tombol
 * "Cara pakai?" di tempat yang tidak menutupi isi halaman (desktop: di navbar; HP/tablet: di menu).
 * Sebelumnya tombol melayang di pojok kanan bawah dan menutupi tombol kirim chat di HP.
 */
import { useSyncExternalStore } from "react";

export interface ActiveTour { label: string; start: () => void }

// Tumpukan: panduan yang terakhir dipasang (mis. panduan editor di dalam halaman) yang aktif.
let stack: ActiveTour[] = [];
let current: ActiveTour | null = null;
const listeners = new Set<() => void>();
const emit = () => { current = stack.at(-1) ?? null; listeners.forEach((listener) => listener()); };

export function registerTour(tour: ActiveTour) {
  stack = [...stack, tour];
  emit();
  return () => { stack = stack.filter((item) => item !== tour); emit(); };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useActiveTour(): ActiveTour | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

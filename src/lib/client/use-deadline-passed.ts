"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Apakah deadline (ISO string) sudah lewat.
 *
 * Waktu adalah "external system", jadi dipakai `useSyncExternalStore`:
 *   - server snapshot selalu `false` → tidak ada hydration mismatch;
 *   - client subscribe ke interval `tickMs` supaya label berubah otomatis
 *     saat deadline terlewati tanpa reload;
 *   - tidak ada `Date.now()` saat render maupun `setState` di effect
 *     (lolos aturan react-hooks/purity & set-state-in-effect).
 */
export function useDeadlinePassed(deadlineIso: string, tickMs = 30_000): boolean {
  const deadlineMs = new Date(deadlineIso).getTime();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (Number.isNaN(deadlineMs)) return () => {};
      const id = setInterval(onStoreChange, tickMs);
      return () => clearInterval(id);
    },
    [deadlineMs, tickMs],
  );

  const getSnapshot = useCallback(
    () => !Number.isNaN(deadlineMs) && deadlineMs < Date.now(),
    [deadlineMs],
  );

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

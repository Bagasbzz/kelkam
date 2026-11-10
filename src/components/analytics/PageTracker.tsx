"use client";

/** Kirim satu catatan kunjungan setiap kali halaman berganti (Tahap 3 analitik). */
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PageTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/api")) return;
    void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pathname }), keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  }, [pathname]);
  return null;
}

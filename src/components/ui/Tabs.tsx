/**
 * src/components/ui/Tabs.tsx
 * -----------------------------------------------------------------------------
 * Lightweight tab primitive, internal state only (controlled via `value`
 * optional + onValueChange callback).
 *
 * Komponen yang sering salah baca: Tabs HIDDEN cuma `display: none`,
 * bukan unmount. Kalau butuh unmount (untuk reset internal state),
 * pakai `<TabPanel>` style dengan conditional render di caller.
 *
 * Usage:
 *   <Tabs defaultValue="pdf" onValueChange={setActive}>
 *     <TabsList>
 *       <TabsTrigger value="pdf">PDF</TabsTrigger>
 *       <TabsTrigger value="docx">DOCX</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="pdf"><PDFPanel /></TabsContent>
 *     <TabsContent value="docx"><DOCXPanel /></TabsContent>
 *   </Tabs>
 * -----------------------------------------------------------------------------
 */

"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface TabsContextValue {
  active: string;
  set: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs.* harus di-render di dalam <Tabs>.");
  return ctx;
}

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultValue, value, onValueChange, children, className = "" }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const active = value ?? internal;
  const set = (v: string) => {
    if (value === undefined) setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ active, set }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export function TabsTrigger({ value, children, icon, disabled }: TabsTriggerProps) {
  const ctx = useTabs();
  const active = ctx.active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`tabpanel-${value}`}
      disabled={disabled}
      onClick={() => ctx.set(value)}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
          : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className = "" }: TabsContentProps) {
  const ctx = useTabs();
  if (ctx.active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}
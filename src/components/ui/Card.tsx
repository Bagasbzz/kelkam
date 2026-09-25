/**
 * src/components/ui/Card.tsx
 * -----------------------------------------------------------------------------
 * Container card dengan rounded yang konsisten.
 *
 * Variants:
 *   - default   : putih solid + border halus + shadow. Untuk content card.
 *   - glass     : semi-transparan + blur. Untuk overlay / hero card.
 *   - borderless: flat, tanpa border/shadow. Untuk nested card di dalam card lain.
 *
 * Padding: none (untuk custom layout) | sm (4) | md (8) | lg (12).
 * Border-radius dibikin generous (rounded-[2.5rem]) supaya visual lebih "soft".
 * -----------------------------------------------------------------------------
 */

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "glass" | "borderless";
  padding?: "none" | "sm" | "md" | "lg";
}

const BASE = "rounded-[2.5rem] transition-all overflow-hidden";

const VARIANTS: Record<NonNullable<CardProps["variant"]>, string> = {
  default: "bg-white border border-slate-200 shadow-2xl shadow-slate-200/40",
  glass: "bg-white/80 backdrop-blur-md border border-white/20 shadow-xl",
  borderless: "bg-slate-50 border-transparent shadow-none",
};

const PADDINGS: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "p-0",
  sm: "p-4",
  md: "p-8",
  lg: "p-12",
};

export default function Card({
  children,
  className = "",
  variant = "default",
  padding = "md",
}: CardProps) {
  return (
    <div className={`${BASE} ${VARIANTS[variant]} ${PADDINGS[padding]} ${className}`}>
      {children}
    </div>
  );
}
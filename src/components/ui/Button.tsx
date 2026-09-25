/**
 * src/components/ui/Button.tsx
 * -----------------------------------------------------------------------------
 * Button primitive — konsisten dengan design system keluhkampus.
 *
 * Design tokens:
 *   - Color base: slate-* (sesuai layout.tsx & Navbar).
 *   - Brand: blue-600 (primary), indigo-600 (secondary).
 *   - Danger: red-600 solid + white text.
 *
 * Variants:
 *   - primary  : solid blue-600, untuk CTA utama.
 *   - secondary: solid indigo-600, untuk CTA sekunder (jarang dipakai).
 *   - outline  : putih + border slate-200, untuk aksi yang tidak destructive.
 *   - danger   : solid red-600, untuk aksi destruktif (hapus, kick, dll).
 *   - ghost    : transparan, untuk aksi ringan (close, link-like).
 *   - dark     : solid slate-900, untuk hero / high-contrast.
 *
 * Sizes: sm | md | lg | xl.
 * Icon prop: lucide-react icon, otomatis di-shrink & margin-right kalau ada children.
 * isLoading: spinner muncul di kiri, button jadi disabled.
 * -----------------------------------------------------------------------------
 */

import type { ButtonHTMLAttributes } from "react";
import { Loader2, type LucideIcon } from "lucide-react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost" | "dark";
  size?: "sm" | "md" | "lg" | "xl";
  icon?: LucideIcon;
  isLoading?: boolean;
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-500/20",
  secondary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-500/20",
  outline: "bg-white border-2 border-slate-200 text-slate-900 hover:border-blue-200 hover:bg-slate-50",
  danger: "bg-red-600 hover:bg-red-700 text-white shadow-xl shadow-red-500/20",
  ghost: "bg-transparent text-slate-400 hover:text-slate-900 hover:bg-slate-100 uppercase tracking-widest text-xs",
  dark: "bg-slate-900 hover:bg-black text-white shadow-xl shadow-slate-200",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-4 py-2 text-xs rounded-xl",
  md: "px-6 py-3 rounded-xl",
  lg: "px-8 py-4 rounded-2xl",
  xl: "px-10 py-5 rounded-3xl text-lg",
};

const BASE_STYLES =
  "inline-flex items-center justify-center font-bold transition-all active:scale-95 disabled:opacity-20 disabled:active:scale-100 disabled:cursor-not-allowed";

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  isLoading,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${BASE_STYLES} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <Loader2 className={`w-5 h-5 animate-spin ${children ? "mr-2" : ""}`} aria-hidden />
      ) : Icon ? (
        <Icon className={`w-5 h-5 ${children ? "mr-2" : ""}`} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
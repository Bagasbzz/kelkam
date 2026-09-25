/**
 * src/components/ui/BrandIcons.tsx
 * -----------------------------------------------------------------------------
 * Icon set custom untuk keluhkampus. Style: line/outline 1.5px dengan rounded
 * caps, stroke-linecap="round" stroke-linejoin="round". Pakai currentColor
 * supaya bisa diwarnai via class Tailwind seperti Lucide.
 *
 * Semua icon 24x24 viewBox (konsisten dengan Lucide). Default stroke-width
 * 1.5, bisa di-override lewat prop `strokeWidth`.
 *
 * Daftar icon:
 *   - LogoKK      : logo utama — graduation cap + speech bubble corner
 *   - IconBrain   : buat /studio (AI thinking)
 *   - IconChart   : buat /dashboard (laporan/chart)
 *   - IconCheck   : buat /tugas (checklist/submitted)
 *   - IconWrench  : buat /tools (utility)
 *   - IconFlow    : buat /uml-builder (flow/loop)
 *   - IconBook    : buat /data-synthesizer (data narasi)
 *   - IconSpark   : buat /ai-tools (AI sparkle)
 *   - IconType    : buat /fix-format (typography)
 *   - IconLayout  : buat /template-generator (layout)
 *   - IconPulse   : buat /tracker (tracker/pulse)
 * -----------------------------------------------------------------------------
 */

import type { ComponentType, SVGProps } from "react";

/** Tipe komponen icon — bisa dipakai untuk typed nav link list. */
export type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke"> {
  /** Default 1.5. Pakai 2 untuk emphasis. */
  strokeWidth?: number;
}

function base(props: IconProps) {
  const { strokeWidth = 1.5, className = "w-5 h-5", ...rest } = props;
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

/**
 * LogoKK — graduation cap dengan corner "speech bubble" di kanan bawah
 * (mengacu ke "keluh" = curhat mahasiswa). Simple, memorable.
 */
export function LogoKK(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z" />
      <path d="M7 11.5v4.2c0 .5.3 1 .8 1.2 1.4.7 2.8 1.1 4.2 1.1s2.8-.4 4.2-1.1c.5-.2.8-.7.8-1.2v-4.2" />
      <path d="M19 10v5.2" />
      <path d="M19 15.2c0 1 .8 1.8 1.8 1.8H21" />
    </svg>
  );
}

/** Brain circuit — buat AI Studio. */
export function IconBrain(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10v1a3 3 0 0 0 1 2.3V14a3 3 0 0 0 2 2.8V18a3 3 0 0 0 3 3 3 3 0 0 0 3-3v-1.2A3 3 0 0 0 15 14v-.7A3 3 0 0 0 16 11v-1a3 3 0 0 0-2-2.5V7a3 3 0 0 0-3-3Z" />
      <path d="M12 8v2" />
      <path d="M12 14v2" />
      <path d="M9 11h2" />
      <path d="M13 13h2" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** Bar chart — buat /dashboard. */
export function IconChart(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20V8" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </svg>
  );
}

/** Checklist — buat /tugas. */
export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

/** Wrench — buat /tools. */
export function IconWrench(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.7 6.3a4 4 0 0 1 5.3 5.3l-1.2-1.2a2 2 0 0 1-2.6 0 2 2 0 0 1 0-2.8l-1.5-1.3Z" />
      <path d="m9.7 11.3-5.4 5.4a2 2 0 1 0 2.8 2.8l5.4-5.4" />
      <path d="m12 9 3 3" />
    </svg>
  );
}

/** Flow / loop arrow — buat /uml-builder. */
export function IconFlow(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 8.5 15.5 15.5" />
      <path d="M13 4h4a2 2 0 0 1 2 2v4" />
      <path d="M11 20H7a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}

/** Open book — buat /data-synthesizer (narasi). */
export function IconBook(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5Z" />
      <path d="M19 18H6a2 2 0 0 0-2 2" />
      <path d="M8 7h8" />
      <path d="M8 11h6" />
    </svg>
  );
}

/** Sparkle — buat /ai-tools. */
export function IconSpark(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v4" />
      <path d="M12 16v4" />
      <path d="M4 12h4" />
      <path d="M16 12h4" />
      <path d="m6.3 6.3 2.8 2.8" />
      <path d="m14.9 14.9 2.8 2.8" />
      <path d="m17.7 6.3-2.8 2.8" />
      <path d="m9.1 14.9-2.8 2.8" />
    </svg>
  );
}

/** Typography / text — buat /fix-format. */
export function IconType(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 7V5h14v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  );
}

/** Layout grid — buat /template-generator. */
export function IconLayout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** Pulse / heartbeat — buat /tracker. */
export function IconPulse(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </svg>
  );
}

/** Chevron down — buat dropdown trigger. */
export function IconChevron(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Generic fallback kalau ada link yang belum dapet icon custom. */
export function IconDots(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
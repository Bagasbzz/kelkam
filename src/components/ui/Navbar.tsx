/**
 * src/components/ui/Navbar.tsx
 * -----------------------------------------------------------------------------
 * Top navigation. Karena web punya 10 halaman, navbar dipecah jadi:
 *
 *   1. PRIMARY (3 link) — yang paling sering diakses: Studio, Laporan, Tugas.
 *   2. DROPDOWN "Lainnya" — 7 utility link dikelompokkan per kategori:
 *        - Rancang (UML, Editor)
 *        - Olah Data (Data Synthesizer)
 *        - AI (AI Tools)
 *        - Utilitas (Format Fix, Tools)
 *        - Pantau (Tracker)
 *
 * Pattern: Linear / Vercel / Notion pakai pendekatan serupa — biar tetep
 * ke-scan tapi ga overcrowded. Mobile menu tetep flat list (dropdown di
 * mobile kecil susah dijangkau).
 *
 * Icon pakai BrandIcons (custom SVG line/outline) kecuali icon bawaan lucide
 * untuk hal-hal yang cuma relevan di mobile menu.
 * -----------------------------------------------------------------------------
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AuthMenu from "@/components/AuthMenu";
import {
  IconBook,
  IconBrain,
  IconChart,
  IconCheck,
  IconChevron,
  IconFlow,
  IconLayout,
  IconPulse,
  IconSpark,
  IconType,
  IconWrench,
  LogoKK,
  type IconCmp,
} from "@/components/ui/BrandIcons";

interface NavItem {
  href: string;
  label: string;
  icon: IconCmp;
}

interface NavGroup {
  /** Nama kategori buat dropdown header. */
  label: string;
  items: NavItem[];
}

const PRIMARY_LINKS: NavItem[] = [
  { href: "/studio", label: "Studio", icon: IconBrain },
  { href: "/dashboard", label: "Laporan", icon: IconChart },
  { href: "/tugas", label: "Tugas", icon: IconCheck },
];

const MORE_GROUPS: NavGroup[] = [
  {
    label: "Rancang",
    items: [
      { href: "/uml-builder", label: "UML Builder", icon: IconFlow },
      { href: "/template-generator", label: "Template Editor", icon: IconLayout },
    ],
  },
  {
    label: "Olah Data",
    items: [
      { href: "/data-synthesizer", label: "Data Synthesizer", icon: IconBook },
    ],
  },
  {
    label: "AI",
    items: [
      { href: "/ai-tools", label: "AI Tools", icon: IconSpark },
    ],
  },
  {
    label: "Utilitas",
    items: [
      { href: "/fix-format", label: "Fix Format", icon: IconType },
      { href: "/tools", label: "PDF / DOCX / Image", icon: IconWrench },
    ],
  },
  {
    label: "Pantau",
    items: [
      { href: "/tracker", label: "Tracker", icon: IconPulse },
    ],
  },
];

/** Flat list semua link — dipakai mobile menu. */
const ALL_LINKS: NavItem[] = [
  ...PRIMARY_LINKS,
  ...MORE_GROUPS.flatMap((g) => g.items),
];

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileMenuOpen]);

  // Tutup dropdown "Lainnya" kalau klik di luar atau pathname berubah.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [moreOpen]);

  const isMoreActive = MORE_GROUPS.some((g) =>
    g.items.some((i) => pathname.startsWith(i.href)),
  );

  return (
    <>
      <nav
        className={`fixed top-0 w-full z-[100] transition-all duration-300 ${
          scrolled
            ? "bg-white/80 backdrop-blur-xl border-b border-slate-200/50 shadow-sm py-3"
            : "bg-transparent py-5"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 group-hover:scale-105 transition-all">
              <LogoKK className="w-5 h-5 md:w-6 md:h-6 text-white" strokeWidth={2} />
            </div>
            <span className="font-black text-xl md:text-2xl text-slate-900 tracking-tighter">
              keluhkampus
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden xl:flex items-center gap-1 bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200/50 backdrop-blur-sm">
            {PRIMARY_LINKS.map((link) => {
              const isActive = pathname.startsWith(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                    isActive
                      ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Dropdown "Lainnya" */}
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  isMoreActive || moreOpen
                    ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                }`}
              >
                Lainnya
                <IconChevron
                  className={`w-3.5 h-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`}
                />
              </button>

              {moreOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xl shadow-2xl p-2 z-[110]"
                >
                  {MORE_GROUPS.map((group) => (
                    <div key={group.label} className="py-1">
                      <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {group.label}
                      </p>
                      {group.items.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            role="menuitem"
                            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold transition-all ${
                              isActive
                                ? "bg-blue-50 text-blue-600"
                                : "text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            <div
                              className={`p-1.5 rounded-lg ${
                                isActive ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                            </div>
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ml-auto mr-2 hidden xl:flex items-center gap-3">
            <a
              href="https://bazzcreate.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-extrabold text-slate-400 hover:text-blue-600 transition-all flex items-center gap-2 group"
            >
              <span className="opacity-60 group-hover:opacity-100 transition-opacity">by</span>
              <span className="text-slate-900 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all shadow-sm">
                Bazzcreate
              </span>
            </a>
            <AuthMenu />
          </div>

          <div className="ml-auto mr-2 xl:hidden">
            <AuthMenu />
          </div>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="xl:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
          >
            <div className="w-6 flex flex-col gap-1.5">
              <span className={`w-full h-0.5 bg-current rounded-full transition-all ${mobileMenuOpen ? "rotate-45 translate-y-2" : ""}`} />
              <span className={`w-full h-0.5 bg-current rounded-full transition-all ${mobileMenuOpen ? "opacity-0" : ""}`} />
              <span className={`w-full h-0.5 bg-current rounded-full transition-all ${mobileMenuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
            </div>
          </button>
        </div>
      </nav>

      {/* Mobile Menu Dropdown — flat list (lebih ramah sentuhan). */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[90] bg-slate-900/20 backdrop-blur-sm xl:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            id="mobile-navigation"
            aria-label="Navigasi utama"
            className="absolute top-[72px] left-4 right-4 bg-white rounded-3xl shadow-2xl border border-slate-100 p-4 flex flex-col gap-2 max-h-[calc(100vh-100px)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {ALL_LINKS.map((link) => {
              const isActive = pathname.startsWith(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-base font-bold transition-all ${
                    isActive
                      ? "bg-blue-50 text-blue-600"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <div
                    className={`p-2 rounded-xl ${
                      isActive ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
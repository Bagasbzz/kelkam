/**
 * src/components/ui/Navbar.tsx
 * -----------------------------------------------------------------------------
 * Top navigation. Karena web punya 10 halaman, navbar dipecah jadi:
 *
 *   1. PRIMARY (4 link): Laporan dan Presentasi (unggulan) paling depan, lalu Studio, Tugas.
 *   2. DROPDOWN "Lainnya", 7 utility link dikelompokkan per kategori:
 *        - Rancang (UML, Editor)
 *        - Olah Data (Data Synthesizer)
 *        - AI (AI Tools)
 *        - Utilitas (Format Fix, Tools)
 *        - Pantau (Tracker)
 *
 * Pattern: Linear / Vercel / Notion pakai pendekatan serupa, biar tetep
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
import { HelpCircle } from "lucide-react";
import AuthMenu from "@/components/AuthMenu";
import { useActiveTour } from "@/lib/client/tour-registry";
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
  // Dua fitur unggulan selalu paling depan (keputusan pemilik 2026-11-09).
  { href: "/dashboard", label: "Laporan", icon: IconChart },
  { href: "/presentasi", label: "Presentasi", icon: IconLayout },
  { href: "/studio", label: "Studio", icon: IconBrain },
  { href: "/tugas", label: "Tugas", icon: IconCheck },
];

const MORE_GROUPS: NavGroup[] = [
  {
    label: "Buat",
    items: [
      { href: "/uml-builder", label: "Diagram", icon: IconFlow },
      { href: "/template-generator", label: "Editor Dokumen", icon: IconLayout },
    ],
  },
  {
    label: "Olah Data",
    items: [
      { href: "/data-synthesizer", label: "Olah Data", icon: IconBook },
    ],
  },
  {
    label: "AI",
    items: [
      { href: "/ai-tools", label: "Alat Bantu AI", icon: IconSpark },
    ],
  },
  {
    label: "Alat lain",
    items: [
      { href: "/fix-format", label: "Rapikan Format", icon: IconType },
      { href: "/tools", label: "PDF, Word & Gambar", icon: IconWrench },
    ],
  },
  {
    label: "Pantau",
    items: [
      { href: "/tracker", label: "Pantau Progres", icon: IconPulse },
    ],
  },
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

  const tour = useActiveTour();

  return (
    <>
      <nav
        className={`fixed top-0 w-full z-[100] transition-all duration-300 ${
          scrolled
            ? "bg-white/85 backdrop-blur-xl border-b border-slate-200/50 shadow-sm py-3"
            : "bg-transparent py-4"
        }`}
      >
        <div className="max-w-7xl mx-auto px-3 min-[380px]:px-4 sm:px-6 md:px-8 flex items-center gap-2 sm:gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 sm:gap-3 group" aria-label="keluhkampus, ke beranda">
            <div className="shrink-0 p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 group-hover:scale-105 transition-all">
              <LogoKK className="w-5 h-5 md:w-6 md:h-6 text-white" strokeWidth={2} />
            </div>
            <span className="truncate font-black text-lg min-[380px]:text-xl md:text-2xl text-slate-900 tracking-tighter">
              keluhkampus
            </span>
          </Link>

          {/* Desktop Nav: mulai 1024px (laptop dengan skala tampilan 125% juga mendapat menu lengkap). */}
          <div className="hidden lg:flex items-center gap-1 bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200/50 backdrop-blur-sm ml-2 xl:ml-6">
            {PRIMARY_LINKS.map((link) => {
              const isActive = pathname.startsWith(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-2 rounded-xl text-xs xl:text-sm font-bold transition-all ${
                    isActive
                      ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
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
                className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-2 rounded-xl text-xs xl:text-sm font-bold transition-all ${
                  isMoreActive || moreOpen
                    ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
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

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {tour && (
              <button
                type="button"
                onClick={tour.start}
                aria-label={tour.label}
                title="Panduan halaman ini"
                className="hidden lg:inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <HelpCircle className="h-5 w-5" /> <span className="hidden xl:inline">{tour.label}</span>
              </button>
            )}
            <a
              href="https://bazzcreate.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden 2xl:flex text-sm font-extrabold text-slate-400 hover:text-blue-600 transition-all items-center gap-2 group"
            >
              <span className="opacity-60 group-hover:opacity-100 transition-opacity">by</span>
              <span className="text-slate-900 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all shadow-sm">
                Bazzcreate
              </span>
            </a>
            <AuthMenu />

            {/* Mobile Menu Toggle */}
            <button
              type="button"
              className="lg:hidden inline-flex h-11 w-11 items-center justify-center text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
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
        </div>
      </nav>

      {/* Menu HP/tablet: fitur utama besar, alat lain dalam grid 2 kolom agar tidak perlu banyak menggulir. */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[90] bg-slate-900/20 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            id="mobile-navigation"
            aria-label="Navigasi utama"
            className="absolute top-[72px] left-3 right-3 sm:left-auto sm:w-96 bg-white rounded-3xl shadow-2xl border border-slate-100 p-3 flex flex-col gap-1 max-h-[calc(100dvh-88px)] overflow-y-auto overscroll-contain"
            onClick={(e) => e.stopPropagation()}
          >
            {tour && (
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); tour.start(); }}
                className="mb-1 flex items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-left text-base font-bold text-white"
              >
                <HelpCircle className="h-5 w-5 shrink-0" /> {tour.label}
                <span className="ml-auto text-xs font-semibold text-slate-300">panduan halaman ini</span>
              </button>
            )}
            <p className="px-3 pt-1 pb-1 text-[11px] font-black uppercase tracking-widest text-slate-400">Fitur utama</p>
            {PRIMARY_LINKS.map((link) => {
              const isActive = pathname.startsWith(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl text-base font-bold transition-all ${
                    isActive ? "bg-blue-50 text-blue-600" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <div className={`p-2 rounded-xl ${isActive ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {link.label}
                </Link>
              );
            })}
            <p className="px-3 pt-3 pb-1 text-[11px] font-black uppercase tracking-widest text-slate-400">Alat lainnya</p>
            <div className="grid grid-cols-2 gap-1">
              {MORE_GROUPS.flatMap((g) => g.items).map((link) => {
                const isActive = pathname.startsWith(link.href);
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex min-h-12 items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold leading-tight transition-all ${
                      isActive ? "bg-blue-50 text-blue-600" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-blue-600" : "text-slate-400"}`} />
                    {link.label}
                  </Link>
                );
              })}
            </div>
            <a
              href="https://bazzcreate.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 rounded-xl px-3 py-2 text-center text-xs font-bold text-slate-400 hover:text-blue-600"
            >
              by Bazzcreate
            </a>
          </div>
        </div>
      )}
    </>
  );
}

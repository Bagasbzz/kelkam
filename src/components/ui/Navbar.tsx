"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Workflow, BookOpen, FileText, LayoutDashboard, LayoutTemplate, Sparkles, BarChart3 } from "lucide-react";
import { useState, useEffect } from "react";

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { href: "/dashboard", label: "Laporan", icon: LayoutDashboard },
    { href: "/uml-builder", label: "UML", icon: Workflow },
    { href: "/data-synthesizer", label: "Data", icon: BookOpen },
    { href: "/ai-tools", label: "AI Tools", icon: Sparkles },
    { href: "/fix-format", label: "Format", icon: FileText },
    { href: "/template-generator", label: "Editor", icon: LayoutTemplate },
    { href: "/tracker", label: "Tracker", icon: BarChart3 },
  ];

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
              <GraduationCap className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <span className="font-black text-xl md:text-2xl text-slate-900 tracking-tighter">
              keluhkampus
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden xl:flex items-center gap-1 bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200/50 backdrop-blur-sm">
            {navLinks.map((link) => {
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
          </div>

          <div className="hidden xl:flex items-center">
             <a
              href="https://bazzcreate.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-extrabold text-slate-400 hover:text-blue-600 transition-all flex items-center gap-2 group"
            >
              <span className="opacity-60 group-hover:opacity-100 transition-opacity">by</span>
              <span className="text-slate-900 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all shadow-sm">Bazzcreate</span>
            </a>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="xl:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <div className="w-6 flex flex-col gap-1.5">
              <span className={`w-full h-0.5 bg-current rounded-full transition-all ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`w-full h-0.5 bg-current rounded-full transition-all ${mobileMenuOpen ? 'opacity-0' : ''}`} />
              <span className={`w-full h-0.5 bg-current rounded-full transition-all ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </div>
          </button>
        </div>
      </nav>

      {/* Mobile Menu Dropdown */}
      <div 
        className={`fixed inset-0 z-[90] bg-slate-900/20 backdrop-blur-sm transition-opacity xl:hidden ${mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMobileMenuOpen(false)}
      >
        <div 
          className={`absolute top-[72px] left-4 right-4 bg-white rounded-3xl shadow-2xl border border-slate-100 p-4 flex flex-col gap-2 transition-transform duration-300 ${mobileMenuOpen ? 'translate-y-0 scale-100' : '-translate-y-4 scale-95'}`}
          onClick={e => e.stopPropagation()}
        >
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl text-base font-bold transition-all ${
                  isActive
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <div className={`p-2 rounded-xl ${isActive ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                   <Icon className="w-5 h-5" />
                </div>
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

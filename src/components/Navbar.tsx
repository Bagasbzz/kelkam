"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BookOpen, Sparkles, Menu, X, LayoutDashboard, FileText, LayoutTemplate, GraduationCap } from "lucide-react";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Fix Format", href: "/fix-format", icon: FileText },
    { name: "Template Generator", href: "/template-generator", icon: LayoutTemplate },
    { name: "AI Tools", href: "/ai-tools", icon: Sparkles, badge: true },
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  ];

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
        scrolled ? "bg-white/80 backdrop-blur-xl border-b border-gray-100 py-3 shadow-sm" : "bg-transparent py-5"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-gray-900">keluhkampus</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              href={link.href}
              className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-blue-600 rounded-xl hover:bg-blue-50 transition-all flex items-center gap-2 group"
            >
              {link.name}
              {link.badge && <Sparkles className="w-3.5 h-3.5 text-amber-500 group-hover:animate-pulse" />}
            </Link>
          ))}
        </div>

        {/* Mobile Menu Button */}
        <button 
          className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors shrink-0"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Nav Overlay */}
      <div 
        className={`fixed inset-0 top-[60px] md:top-[72px] bg-white z-[99] md:hidden transition-all duration-300 ease-in-out ${
          isOpen ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
        }`}
      >
        <div className="p-4 sm:p-6 space-y-2 h-[calc(100vh-60px)] overflow-y-auto bg-white">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              href={link.href}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-4 p-4 text-base sm:text-lg font-bold text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-2xl transition-all border border-transparent hover:border-blue-100"
            >
              <div className="p-2.5 bg-slate-50 rounded-xl group-hover:bg-blue-100 text-slate-400 group-hover:text-blue-600">
                <link.icon className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span className="flex-1">{link.name}</span>
              {link.badge && <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />}
            </Link>
          ))}
          
          <div className="pt-6 mt-6 border-t border-slate-100">
             <p className="text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">Powered by Bazzcreate</p>
          </div>
        </div>
      </div>
    </nav>
  );
}

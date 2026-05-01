"use client";

import Link from "next/link";
import { 
  FileText, 
  LayoutTemplate, 
  Sparkles, 
  LayoutDashboard,
  ArrowLeft,
  ArrowRight
} from "lucide-react";
import Navbar from "@/components/Navbar";

export default function DashboardHub() {
  const skripsiTools = [
    {
      title: "Auto Layout & Fix Format",
      description: "Perbaiki format Word otomatis sesuai pedoman akademik (margin, font, spasi).",
      icon: FileText,
      href: "/fix-format",
      color: "text-blue-600",
      bg: "bg-blue-50"
    },
    {
      title: "Template Generator",
      description: "Generate template skripsi lengkap dengan daftar isi dan struktur bab otomatis.",
      icon: LayoutTemplate,
      href: "/template-generator",
      color: "text-blue-600",
      bg: "bg-blue-50"
    },
    {
      title: "AI Academic Assistant",
      description: "Bantuan AI untuk memparafrase, merangkum jurnal, dan mengecek struktur tata bahasa.",
      icon: Sparkles,
      href: "/ai-tools",
      color: "text-blue-600",
      bg: "bg-blue-50"
    },
    {
      title: "Progress Tracker",
      description: "Pantau progress bab skripsi, daftar tugas, dan catatan revisi dari dosen pembimbing.",
      icon: LayoutDashboard,
      href: "/tracker", // We will move the old dashboard here
      color: "text-blue-600",
      bg: "bg-blue-50"
    }
  ];

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans">
      <Navbar />
      
      <main className="max-w-6xl mx-auto px-6 py-12 md:py-24">
        <Link 
          href="/" 
          className="inline-flex items-center text-sm font-semibold text-slate-500 hover:text-blue-600 mb-6 md:mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Kembali ke Beranda
        </Link>
        
        <div className="mb-8 md:mb-12">
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
            Skripsi Build Hub
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl leading-relaxed">
            Pilih alat bantu akademis di bawah ini untuk membantu mempermudah pengerjaan skripsimu.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 md:gap-6">
          {skripsiTools.map((tool, idx) => (
            <Link 
              key={idx} 
              href={tool.href}
              className="group flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 p-6 rounded-2xl border border-slate-200 bg-white hover:border-blue-400 hover:shadow-lg hover:shadow-blue-50 transition-all duration-300"
            >
              <div className={`shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center ${tool.bg} ${tool.color} group-hover:scale-110 transition-transform`}>
                <tool.icon className="w-6 h-6 md:w-7 md:h-7" />
              </div>
              <div className="flex-1 w-full">
                <h3 className="text-lg md:text-xl font-bold text-slate-900 mb-1 md:mb-2 flex items-center justify-between">
                  {tool.title}
                  <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-blue-600 transition-colors transform group-hover:translate-x-1" />
                </h3>
                <p className="text-slate-500 leading-relaxed text-sm">
                  {tool.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}

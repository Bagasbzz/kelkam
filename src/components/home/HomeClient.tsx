"use client";

import { ArrowRight, Bot, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  IconBook,
  IconBrain,
  IconCheck,
  IconChart,
  IconFlow,
  IconLayout,
  IconPulse,
  IconSpark,
  IconType,
  IconWrench,
  type IconCmp,
} from "@/components/ui/BrandIcons";

interface FeatureCard {
  href: string;
  title: string;
  description: string;
  icon: IconCmp;
  accent: "blue" | "indigo" | "amber" | "emerald" | "violet" | "rose";
  cta: string;
  primary?: boolean;
}

/** Dua fitur unggulan, selalu paling depan (keputusan pemilik 2026-11-09). */
const FEATURED: (FeatureCard & { learn: string; points: string[] })[] = [
  {
    href: "/dashboard",
    learn: "/fitur/laporan-ai",
    title: "Laporan AI",
    description:
      "Ngobrol dengan AI, setujui kerangka bab, lalu laporan ditulis lengkap dengan sumber jurnal dan buku asli, diagram, dan file Word rapi.",
    points: ["Sumber jurnal ber-DOI, buku ber-ISBN, skripsi", "Diagram UML dan ilustrasi otomatis", "Diaudit AI sebelum dikirim, unduh DOCX"],
    icon: IconChart,
    accent: "amber",
    cta: "Buat laporan",
    primary: true,
  },
  {
    href: "/presentasi",
    learn: "/fitur/ppt-ai",
    title: "Presentasi (PPT) AI",
    description:
      "Dari materi atau laporanmu, AI menyusun slide dengan desain yang selalu berbeda, logo kampus, dan gambar, lalu bisa diedit dan diunduh sebagai PowerPoint.",
    points: ["Desain unik setiap kali dibuat", "Logo kampus dan gambar sampul otomatis", "Diaudit AI, unduh PPTX yang bisa diedit"],
    icon: IconLayout,
    accent: "indigo",
    cta: "Buat presentasi",
    primary: true,
  },
];

const PRIMARY_FEATURES: FeatureCard[] = [
  {
    href: "/studio",
    title: "Studio",
    description:
      "Susun ide dan kerangka laporan dengan bantuan AI.",
    icon: IconBrain,
    accent: "blue",
    cta: "Buka",
    primary: true,
  },
  {
    href: "/tugas",
    title: "Tugas",
    description:
      "Kumpulkan tugas lewat token mata kuliah dan lihat urutan pengumpulan kamu.",
    icon: IconCheck,
    accent: "emerald",
    cta: "Kumpulkan tugas",
    primary: true,
  },
];

const UTILITY_FEATURES: FeatureCard[] = [
  {
    href: "/uml-builder",
    title: "Buat Diagram",
    description:
      "Flowchart, use case, dan activity diagram yang bisa langsung dipakai di laporan.",
    icon: IconFlow,
    accent: "blue",
    cta: "Buat diagram",
  },
  {
    href: "/data-synthesizer",
    title: "Olah Data",
    description:
      "Ubah hasil kuesioner, wawancara, atau observasi jadi tulisan hasil dan pembahasan.",
    icon: IconBook,
    accent: "indigo",
    cta: "Olah data",
  },
  {
    href: "/template-generator",
    title: "Editor Dokumen",
    description:
      "Tulis dokumen seperti di Word dan unduh hasilnya dengan format rapi.",
    icon: IconLayout,
    accent: "violet",
    cta: "Buka editor",
  },
  {
    href: "/ai-tools",
    title: "AI Tools",
    description:
      "Perbaiki kalimat, ringkas, atau terjemahkan tulisan dengan AI.",
    icon: IconSpark,
    accent: "rose",
    cta: "Coba",
  },
  {
    href: "/fix-format",
    title: "Rapikan Format",
    description:
      "Rapikan judul, daftar, dan spasi dokumen Word dalam satu klik.",
    icon: IconType,
    accent: "amber",
    cta: "Rapikan",
  },
  {
    href: "/tools",
    title: "Alat PDF, Word & Gambar",
    description:
      "Gabung atau pisah PDF, ubah Word ke PDF, kecilkan ukuran gambar. Semua diproses di browser.",
    icon: IconWrench,
    accent: "emerald",
    cta: "Buka alat",
  },
  {
    href: "/tracker",
    title: "Pantau Progres",
    description:
      "Catat kemajuan tugas dan kebiasaan belajar kamu.",
    icon: IconPulse,
    accent: "indigo",
    cta: "Lihat",
  },
];

const ACCENT: Record<FeatureCard["accent"], { bg: string; text: string; border: string; glow: string; btn: string }> = {
  blue: {
    bg: "from-blue-50 to-blue-100",
    text: "text-blue-600",
    border: "hover:border-blue-400",
    glow: "bg-blue-500/10",
    btn: "text-blue-600 group-hover:bg-blue-600 group-hover:text-white",
  },
  indigo: {
    bg: "from-indigo-50 to-indigo-100",
    text: "text-indigo-600",
    border: "hover:border-indigo-400",
    glow: "bg-indigo-500/10",
    btn: "text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white",
  },
  amber: {
    bg: "from-amber-50 to-amber-100",
    text: "text-amber-600",
    border: "hover:border-amber-400",
    glow: "bg-amber-500/10",
    btn: "text-amber-600 group-hover:bg-amber-600 group-hover:text-white",
  },
  emerald: {
    bg: "from-emerald-50 to-emerald-100",
    text: "text-emerald-600",
    border: "hover:border-emerald-400",
    glow: "bg-emerald-500/10",
    btn: "text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white",
  },
  violet: {
    bg: "from-violet-50 to-violet-100",
    text: "text-violet-600",
    border: "hover:border-violet-400",
    glow: "bg-violet-500/10",
    btn: "text-violet-600 group-hover:bg-violet-600 group-hover:text-white",
  },
  rose: {
    bg: "from-rose-50 to-rose-100",
    text: "text-rose-600",
    border: "hover:border-rose-400",
    glow: "bg-rose-500/10",
    btn: "text-rose-600 group-hover:bg-rose-600 group-hover:text-white",
  },
};

function FeatureCardLink({ card, large = false, badge, points }: { card: FeatureCard; large?: boolean; badge?: string; points?: string[] }) {
  const a = ACCENT[card.accent];
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className={`group flex flex-col items-start text-left p-6 md:p-8 rounded-[2rem] bg-white/60 backdrop-blur-sm border border-slate-200 ${a.border} hover:shadow-2xl transition-all duration-500 relative overflow-hidden ${
        large ? "lg:col-span-2" : ""
      }`}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 ${a.glow} rounded-full blur-3xl -mr-16 -mt-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
      <div
        className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br ${a.bg} ${a.text} flex items-center justify-center mb-5 md:mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 shadow-sm`}
      >
        <Icon className="w-7 h-7 md:w-8 md:h-8" />
      </div>
      {badge && <span className="absolute top-6 right-6 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">{badge}</span>}
      <h2 className="text-lg md:text-2xl font-black mb-2 md:mb-3 text-slate-900 group-hover:text-slate-900 transition-colors">
        {card.title}
      </h2>
      <p className="text-slate-500 text-sm md:text-base leading-relaxed mb-6 md:mb-8 flex-1 font-medium group-hover:text-slate-600 transition-colors">
        {card.description}
      </p>
      {points && (
        <ul className="-mt-3 mb-6 space-y-1.5 text-sm font-semibold text-slate-600">
          {points.map((point) => <li key={point} className="flex gap-2"><span aria-hidden="true" className={a.text}>✓</span>{point}</li>)}
        </ul>
      )}
      <div
        className={`inline-flex items-center justify-center w-full py-3 md:py-3.5 rounded-xl bg-slate-50 font-bold text-sm md:text-base border border-slate-100 group-hover:border-transparent transition-all duration-300 ${a.btn}`}
      >
        {card.cta} <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
      </div>
    </Link>
  );
}

export default function HomeClient() {
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  const handleSkripsiClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowModal(true);
  };

  const confirmSkripsi = () => {
    setShowModal(false);
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-800 font-sans">
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-16 md:py-24 flex flex-col items-center text-center">
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-slate-900 mb-6 md:mb-8 tracking-tight leading-[1.05] animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
          Laporan dan PPT kuliah,
          <br />
          <span className="text-blue-600">dibantu AI</span>
        </h1>
        <p className="text-lg md:text-2xl text-slate-500 max-w-3xl mb-12 md:mb-20 leading-relaxed font-medium px-4 md:px-0 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
          Susun laporan lengkap dengan sumber asli dan buat presentasi dengan desain unik, semuanya bisa diedit dan diunduh. Alat bantu kuliah lain ada di bawah.
        </p>

        {/* Fitur unggulan: Laporan dan Presentasi, selalu paling depan. */}
        <section aria-label="Fitur unggulan" className="w-full max-w-6xl mb-10 md:mb-14 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-300">
          <div className="grid md:grid-cols-2 gap-6 md:gap-8 w-full">
            {FEATURED.map((card) => (
              <div key={card.href} className="flex flex-col">
                <FeatureCardLink card={card} badge="Unggulan" points={card.points} />
                <Link href={card.learn} className="mt-3 text-sm font-bold text-slate-500 hover:text-blue-600">
                  Pelajari cara kerja {card.title} →
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="w-full max-w-6xl mb-16 md:mb-24 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-300">
          <div className="grid md:grid-cols-2 gap-6 md:gap-8 w-full">
            {PRIMARY_FEATURES.map((card) => (
              <FeatureCardLink key={card.href} card={card} />
            ))}
          </div>
        </section>

        {/* Utility features, sisanya, dikasih section header biar jelas. */}
        <section className="w-full max-w-6xl animate-in fade-in slide-in-from-bottom-12 duration-700 delay-500">
          <div className="mb-8 md:mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900">
              Alat bantu lainnya
            </h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 w-full">
            {UTILITY_FEATURES.map((card) => (
              <FeatureCardLink key={card.href} card={card} />
            ))}
          </div>
        </section>

        <button
          onClick={handleSkripsiClick}
          className="mt-16 md:mt-20 text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors"
        >
          Lihat fitur penyusun laporan →
        </button>
      </main>

      {/* Confirmation Modal */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md transition-all"
        >
          <div className="bg-white w-full max-w-md rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-10 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-6 md:mb-8">
              <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Bot className="w-6 h-6 md:w-7 md:h-7" />
              </div>
              <button
                type="button"
                aria-label="Tutup modal"
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-slate-50 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            <h3 id="report-modal-title" className="text-xl md:text-2xl font-bold text-slate-900 mb-3 md:mb-4">Penyusun laporan</h3>
            <p className="text-slate-500 text-base md:text-lg leading-relaxed mb-8 md:mb-10 font-medium">
              Fitur ini membantu menyusun laporan praktikum, makalah, capstone, dan skripsi. Lanjut?
            </p>

            <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-3 md:py-4 px-6 rounded-xl md:rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
              >
                Batal
              </button>
              <button
                onClick={confirmSkripsi}
                className="flex-1 py-3 md:py-4 px-6 rounded-xl md:rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02]"
              >
                Lanjut
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Workflow, FileText, ArrowRight, BookOpen, X, Sparkles, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Home() {
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


      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-16 md:py-24 flex flex-col items-center text-center">

        <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-slate-900 mb-6 md:mb-8 tracking-tight leading-[1.05] animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
          Tools <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">Mahasiswa</span>
          <br/>Lebih Cepat
        </h1>
        <p className="text-lg md:text-2xl text-slate-500 max-w-3xl mb-12 md:mb-20 leading-relaxed font-medium px-4 md:px-0 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
          Keluhkampus dirancang khusus agar pengerjaan diagram, laporan, dan skripsimu bisa selesai jauh lebih gampang dan cepat. Tidak perlu keahlian khusus, tinggal klik!
        </p>

        {/* Feature Cards */}
        {/* Feature Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 w-full max-w-6xl animate-in fade-in slide-in-from-bottom-12 duration-700 delay-300">
          
          {/* UML Flow Card */}
          <Link
            href="/uml-builder"
            className="group flex flex-col items-start text-left p-6 md:p-8 rounded-[2rem] bg-white/60 backdrop-blur-sm border border-slate-200 hover:border-blue-400 hover:shadow-2xl hover:shadow-blue-500/20 transition-all duration-500 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-16 -mt-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 shadow-sm">
              <Workflow className="w-8 h-8" />
            </div>
            <h2 className="text-xl md:text-2xl font-black mb-3 text-slate-900 group-hover:text-blue-700 transition-colors">UML Auto Build</h2>
            <p className="text-slate-500 text-sm md:text-base leading-relaxed mb-8 flex-1 font-medium group-hover:text-slate-600 transition-colors">
              Pusing bikin Flowchart atau Use Case? Biar AI yang bikinin secara otomatis. Tinggal ketik, langsung jadi diagram profesional!
            </p>
            <div className="inline-flex items-center justify-center w-full py-3.5 rounded-xl bg-slate-50 text-blue-600 font-bold text-sm md:text-base group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 shadow-sm border border-slate-100 group-hover:border-transparent">
              Coba UML Builder <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Data Synthesizer Card */}
          <Link
            href="/data-synthesizer"
            className="group flex flex-col items-start text-left p-6 md:p-8 rounded-[2rem] bg-white/60 backdrop-blur-sm border border-slate-200 hover:border-indigo-400 hover:shadow-2xl hover:shadow-indigo-500/20 transition-all duration-500 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-50 to-indigo-100 text-indigo-600 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-500 shadow-sm">
              <BookOpen className="w-8 h-8" />
            </div>
            <h2 className="text-xl md:text-2xl font-black mb-3 text-slate-900 group-hover:text-indigo-700 transition-colors">Auto-Bab 4</h2>
            <p className="text-slate-500 text-sm md:text-base leading-relaxed mb-8 flex-1 font-medium group-hover:text-slate-600 transition-colors">
              Punya data kuesioner atau wawancara yang masih acak-acakan? Ubah jadi narasi Skripsi Bab 4 yang rapi dan ilmiah dalam hitungan detik.
            </p>
            <div className="inline-flex items-center justify-center w-full py-3.5 rounded-xl bg-slate-50 text-indigo-600 font-bold text-sm md:text-base group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300 shadow-sm border border-slate-100 group-hover:border-transparent">
              Olah Data Sekarang <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Skripsi Build Card */}
          <button
            onClick={handleSkripsiClick}
            className="group flex flex-col items-start text-left p-6 md:p-8 rounded-[2rem] bg-white/60 backdrop-blur-sm border border-slate-200 hover:border-amber-400 hover:shadow-2xl hover:shadow-amber-500/20 transition-all duration-500 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl -mr-16 -mt-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 text-amber-600 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 shadow-sm">
              <FileText className="w-8 h-8" />
            </div>
            <h2 className="text-xl md:text-2xl font-black mb-3 text-slate-900 group-hover:text-amber-700 transition-colors">Skripsi Build</h2>
            <p className="text-slate-500 text-sm md:text-base leading-relaxed mb-8 flex-1 font-medium group-hover:text-slate-600 transition-colors">
              Masih sering bingung masalah format atau margin? Tools ini bantu rapikan format skripsimu sesuai standar kampus tanpa pusing.
            </p>
            <div className="inline-flex items-center justify-center w-full py-3.5 rounded-xl bg-slate-50 text-amber-600 font-bold text-sm md:text-base group-hover:bg-amber-600 group-hover:text-white transition-all duration-300 shadow-sm border border-slate-100 group-hover:border-transparent">
              Buka Fitur Skripsi <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

        </div>
      </main>

      {/* Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md transition-all">
          <div className="bg-white w-full max-w-md rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-10 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-6 md:mb-8">
              <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center">
                <Sparkles className="w-6 h-6 md:w-7 md:h-7" />
              </div>
              <button 
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-slate-50 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>
            
            <h3 className="text-xl md:text-2xl font-black text-slate-900 mb-3 md:mb-4">Fitur Sedang Dikembangkan</h3>
            <p className="text-slate-500 text-base md:text-lg leading-relaxed mb-8 md:mb-10 font-medium">
              Fitur Skripsi Build saat ini masih dalam tahap pengembangan. Apakah kamu tetap mau melanjutkan untuk mencoba versi beta?
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
              <button 
                onClick={() => setShowModal(false)}
                className="flex-1 py-3 md:py-4 px-6 rounded-xl md:rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
              >
                Gak Jadi
              </button>
              <button 
                onClick={confirmSkripsi}
                className="flex-1 py-3 md:py-4 px-6 rounded-xl md:rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02]"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="w-full py-8 md:py-12 mt-auto text-slate-500 text-center">
        <p className="text-sm font-medium">
          &copy; {new Date().getFullYear()} keluhkampus. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

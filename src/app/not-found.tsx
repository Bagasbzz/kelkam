/**
 * Halaman 404 global (alamat tidak ada, atau notFound() dari halaman).
 * Tampil di dalam layout utama sehingga navbar tetap ada.
 */
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

export const metadata = { title: "Halaman tidak ditemukan", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <p className="text-5xl font-black text-slate-200" aria-hidden>404</p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">Halaman tidak ditemukan</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Alamat yang Anda buka tidak ada atau sudah dipindahkan. Periksa kembali alamatnya, atau kembali ke beranda.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Kembali ke beranda
          </Link>
          <Link
            href="/fitur"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:border-blue-400"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Lihat semua fitur
          </Link>
        </div>
      </div>
    </main>
  );
}

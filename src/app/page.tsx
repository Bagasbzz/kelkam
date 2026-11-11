import Link from "next/link";
import type { Metadata } from "next";
import HomeClient from "@/components/home/HomeClient";
import { JsonLd } from "@/components/seo/JsonLd";
import { appJsonLd, faqJsonLd, FEATURES, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME}: ${SITE_TAGLINE} untuk Mahasiswa` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: SITE_URL },
};

const HOME_FAQ = [
  { q: "Apa itu keluhkampus?", a: SITE_DESCRIPTION },
  ...FEATURES.flatMap((feature) => feature.faq.slice(0, 2)),
];

export default function Home() {
  return (
    <>
      <JsonLd data={appJsonLd()} />
      <JsonLd data={faqJsonLd(HOME_FAQ)} />
      <HomeClient />
      {/* Penjelasan yang bisa dibaca mesin pencari dan asisten AI, tampil juga untuk pengguna. */}
      <section aria-labelledby="kenapa" className="w-full bg-white border-t border-slate-100">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-12 md:py-16 text-left">
          <h2 id="kenapa" className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900">Kenapa mahasiswa memakai {SITE_NAME}</h2>
          <div className="mt-6 md:mt-8 grid gap-8 md:grid-cols-2">
            {FEATURES.map((feature) => (
              <article key={feature.slug}>
                <h3 className="text-lg font-bold text-slate-900">{feature.name}</h3>
                <p className="mt-2 text-slate-600">{feature.summary}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  {feature.benefits.map((benefit) => <li key={benefit.title}><b className="text-slate-800">{benefit.title}.</b> {benefit.text}</li>)}
                </ul>
                <Link href={`/fitur/${feature.slug}`} className="mt-2 inline-block py-2 text-sm font-bold text-blue-600 hover:underline">Lihat cara kerja {feature.name}</Link>
              </article>
            ))}
          </div>
          <h2 className="mt-12 md:mt-14 text-xl sm:text-2xl font-black text-slate-900">Pertanyaan umum</h2>
          {/* Buka-tutup: teks tetap ada di HTML (terbaca mesin pencari), tapi halaman di HP tidak memanjang ±2.000px. */}
          <div className="mt-4 md:mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {HOME_FAQ.map((item) => (
              <details key={item.q} className="group px-4 sm:px-5">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 py-3 font-bold text-slate-900 [&::-webkit-details-marker]:hidden">
                  <h3 className="flex-1 text-base">{item.q}</h3>
                  <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-45 text-xl leading-none">+</span>
                </summary>
                <p className="pb-4 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <footer className="w-full bg-white px-4 py-8 text-center text-sm font-medium text-slate-500">
        <nav aria-label="Tautan fitur" className="mb-2 flex flex-wrap justify-center gap-x-5 gap-y-1">
          <Link href="/fitur" className="py-2 hover:text-blue-600">Semua fitur</Link>
          {FEATURES.map((feature) => <Link key={feature.slug} href={`/fitur/${feature.slug}`} className="py-2 hover:text-blue-600">{feature.name}</Link>)}
        </nav>
        <p>&copy; {new Date().getFullYear()} {SITE_NAME}</p>
      </footer>
    </>
  );
}

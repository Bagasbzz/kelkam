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
        <div className="mx-auto max-w-5xl px-6 py-16 text-left">
          <h2 id="kenapa" className="text-2xl md:text-3xl font-black text-slate-900">Kenapa mahasiswa memakai {SITE_NAME}</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            {FEATURES.map((feature) => (
              <article key={feature.slug}>
                <h3 className="text-lg font-bold text-slate-900">{feature.name}</h3>
                <p className="mt-2 text-slate-600">{feature.summary}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  {feature.benefits.map((benefit) => <li key={benefit.title}><b className="text-slate-800">{benefit.title}.</b> {benefit.text}</li>)}
                </ul>
                <Link href={`/fitur/${feature.slug}`} className="mt-3 inline-block text-sm font-bold text-blue-600 hover:underline">Lihat cara kerja {feature.name}</Link>
              </article>
            ))}
          </div>
          <h2 className="mt-14 text-2xl font-black text-slate-900">Pertanyaan umum</h2>
          <dl className="mt-6 space-y-5">
            {HOME_FAQ.map((item) => (
              <div key={item.q}>
                <dt className="font-bold text-slate-900">{item.q}</dt>
                <dd className="mt-1 text-slate-600">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <footer className="w-full bg-white py-8 text-center text-sm font-medium text-slate-500">
        <nav aria-label="Tautan fitur" className="mb-3 flex flex-wrap justify-center gap-4">
          <Link href="/fitur" className="hover:text-blue-600">Semua fitur</Link>
          {FEATURES.map((feature) => <Link key={feature.slug} href={`/fitur/${feature.slug}`} className="hover:text-blue-600">{feature.name}</Link>)}
        </nav>
        <p>&copy; {new Date().getFullYear()} {SITE_NAME}</p>
      </footer>
    </>
  );
}

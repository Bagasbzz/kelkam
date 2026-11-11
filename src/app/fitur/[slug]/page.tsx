import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd, pageMeta } from "@/components/seo/JsonLd";
import { appJsonLd, faqJsonLd, featureBySlug, FEATURES, howToJsonLd, SITE_NAME, SITE_URL } from "@/lib/seo/site";

export function generateStaticParams() {
  return FEATURES.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const feature = featureBySlug((await params).slug);
  return feature ? { ...pageMeta(feature.title, feature.description, `/fitur/${feature.slug}`), keywords: feature.keywords } : {};
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const feature = featureBySlug((await params).slug);
  if (!feature) notFound();
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Fitur", item: `${SITE_URL}/fitur` },
      { "@type": "ListItem", position: 3, name: feature.name, item: `${SITE_URL}/fitur/${feature.slug}` },
    ],
  };
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 text-slate-800 sm:px-6 sm:py-14">
      <JsonLd data={appJsonLd(feature)} />
      <JsonLd data={howToJsonLd(feature)} />
      <JsonLd data={faqJsonLd(feature.faq)} />
      <JsonLd data={breadcrumb} />
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500"><Link href="/" className="inline-block py-2 hover:underline">Beranda</Link> / <Link href="/fitur" className="inline-block py-2 hover:underline">Fitur</Link> / {feature.name}</nav>
      <h1 className="mt-2 text-3xl sm:mt-4 sm:text-4xl md:text-5xl font-black leading-tight text-slate-900">{feature.title}</h1>
      <p className="mt-4 text-base text-slate-600 sm:mt-5 sm:text-lg">{feature.description}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={feature.appHref} className="w-full rounded-xl bg-blue-600 px-5 py-3 text-center font-bold sm:w-auto text-white hover:bg-blue-700">Coba {feature.name} sekarang</Link>
        <Link href={`${feature.appHref}?panduan=1`} className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-center font-bold sm:w-auto text-slate-700 hover:border-blue-400">Lihat panduan interaktif</Link>
      </div>

      <h2 className="mt-10 text-2xl sm:mt-14 font-black text-slate-900">Cara kerja</h2>
      <p className="mt-3 text-slate-600">{feature.summary}</p>
      <ol className="mt-6 space-y-4">
        {feature.steps.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{i + 1}</span>
            <div><h3 className="font-bold text-slate-900">{step.title}</h3><p className="text-slate-600">{step.text}</p></div>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 text-2xl sm:mt-14 font-black text-slate-900">Keunggulan</h2>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {feature.benefits.map((benefit) => (
          <article key={benefit.title} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="font-bold text-slate-900">{benefit.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{benefit.text}</p>
          </article>
        ))}
      </div>

      <h2 className="mt-10 text-2xl sm:mt-14 font-black text-slate-900">Pertanyaan umum</h2>
      <dl className="mt-6 space-y-5">
        {feature.faq.map((item) => (
          <div key={item.q}><dt className="font-bold text-slate-900">{item.q}</dt><dd className="mt-1 text-slate-600">{item.a}</dd></div>
        ))}
      </dl>

      <p className="mt-10 text-sm text-slate-500 sm:mt-14">
        Fitur lain: {FEATURES.filter((item) => item.slug !== feature.slug).map((item) => <Link key={item.slug} href={`/fitur/${item.slug}`} className="mr-1 inline-block py-2 font-bold text-blue-600 hover:underline">{item.name}</Link>)} · <Link href="/fitur" className="inline-block py-2 font-bold text-blue-600 hover:underline">semua alat</Link>
      </p>
    </main>
  );
}

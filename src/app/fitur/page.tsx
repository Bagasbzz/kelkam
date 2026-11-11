import Link from "next/link";
import { JsonLd, pageMeta } from "@/components/seo/JsonLd";
import { appJsonLd, FEATURES, OTHER_TOOLS, SITE_NAME } from "@/lib/seo/site";

export const metadata = pageMeta(
  "Semua Fitur: Laporan AI, PPT AI, Diagram UML, dan Alat Kuliah",
  `Daftar lengkap fitur ${SITE_NAME}: Laporan AI dengan sumber asli dan ekspor DOCX, Presentasi AI dengan desain unik dan PPTX editable, diagram UML, olah data, serta alat PDF dan Word.`,
  "/fitur",
);

export default function FiturPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 text-slate-800 sm:px-6 sm:py-14">
      <JsonLd data={appJsonLd()} />
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900">Fitur {SITE_NAME}</h1>
      <p className="mt-4 text-lg text-slate-600">Dua fitur unggulan untuk tugas besar kuliah, ditambah alat bantu harian.</p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {FEATURES.map((feature) => (
          <article key={feature.slug} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Unggulan</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">{feature.name}</h2>
            <p className="mt-2 text-slate-600">{feature.description}</p>
            <div className="mt-3 flex gap-2 text-sm font-bold">
              <Link href={`/fitur/${feature.slug}`} className="-ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-blue-600 hover:underline">Cara kerja</Link>
              <Link href={feature.appHref} className="inline-flex min-h-11 items-center rounded-lg px-2 text-slate-700 hover:underline">Buka aplikasi</Link>
            </div>
          </article>
        ))}
      </div>
      <h2 className="mt-14 text-2xl font-black text-slate-900">Alat lain</h2>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {OTHER_TOOLS.map((tool) => (
          <li key={tool.href} className="relative rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300">
            <Link href={tool.href} className="font-bold text-slate-900 after:absolute after:inset-0 after:rounded-xl hover:text-blue-600">{tool.name}</Link>
            <p className="mt-1 text-sm text-slate-600">{tool.text}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/seo/site";

/** JSON-LD for search engines and AI assistants. `<` is escaped so data can never close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** Per-page metadata with canonical URL and social cards. */
export function pageMeta(title: string, description: string, path: string, options: { index?: boolean } = {}): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${title} | ${SITE_NAME}`, description, url, siteName: SITE_NAME, locale: "id_ID", type: "website" },
    twitter: { card: "summary_large_image", title: `${title} | ${SITE_NAME}`, description },
    ...(options.index === false ? { robots: { index: false, follow: true } } : {}),
  };
}

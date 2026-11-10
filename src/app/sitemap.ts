import type { MetadataRoute } from "next";
import { FEATURES, OTHER_TOOLS, SITE_URL } from "@/lib/seo/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/fitur`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    ...FEATURES.map((feature) => ({ url: `${SITE_URL}/fitur/${feature.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.95 })),
    // Halaman yang wajib login (Studio) tidak dimasukkan: crawler hanya akan melihat halaman masuk.
    ...OTHER_TOOLS.filter((tool) => tool.href !== "/studio").map((tool) => ({ url: `${SITE_URL}${tool.href}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}

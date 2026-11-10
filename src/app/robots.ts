import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/site";

/** Semua crawler termasuk asisten AI boleh membaca halaman publik; area akun dan API tidak diindeks. */
export default function robots(): MetadataRoute.Robots {
  const disallow = ["/api/", "/login", "/tugas/admin694", "/editor", "/research"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"].map((userAgent) => ({ userAgent, allow: ["/", "/llms.txt"], disallow })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

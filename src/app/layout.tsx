import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import Navbar from "@/components/ui/Navbar";
import { JsonLd } from "@/components/seo/JsonLd";
import { organizationJsonLd, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/seo/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: ${SITE_TAGLINE} untuk Mahasiswa`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["buat laporan dengan AI", "buat ppt dengan AI", "AI untuk mahasiswa", "AI skripsi", "AI makalah", "presentasi AI", "laporan praktikum", "diagram UML", "keluhkampus"],
  icons: { icon: "/icon.svg" },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "id_ID", url: SITE_URL, title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  other: { "application-release": process.env.APPLICATION_RELEASE || "unknown" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <head>
        <link rel="alternate" type="text/plain" href="/llms.txt" title="Ringkasan untuk asisten AI" />
      </head>
      <body
        className="antialiased bg-slate-50 text-slate-900 min-h-screen flex flex-col selection:bg-blue-200 selection:text-blue-900"
      >
        <JsonLd data={organizationJsonLd()} />
        <AuthProvider>
          <Navbar />
          <div className="flex-1 flex flex-col mt-[72px]">
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}

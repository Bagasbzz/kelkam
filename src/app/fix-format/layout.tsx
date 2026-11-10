import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Rapikan Format Dokumen Word", "Rapikan judul, daftar, dan spasi dokumen Word dalam satu klik.", "/fix-format");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

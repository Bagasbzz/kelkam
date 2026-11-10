import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Editor Dokumen Online", "Tulis dokumen seperti di Word lalu unduh dengan format rapi sesuai kampus.", "/template-generator");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

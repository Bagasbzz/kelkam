import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Pengumpulan Tugas Online", "Kumpulkan tugas lewat token mata kuliah dan lihat urutan pengumpulan.", "/tugas");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

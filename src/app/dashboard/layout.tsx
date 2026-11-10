import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Laporan AI: Buat Laporan dan Skripsi dengan Sumber Asli", "Asisten Laporan AI menyusun laporan, makalah, dan skripsi bab demi bab dengan sumber jurnal dan buku asli, diagram, audit AI, dan ekspor DOCX.", "/dashboard", { index: false });

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Olah Data Penelitian jadi Pembahasan", "Ubah hasil kuesioner, wawancara, atau observasi menjadi tulisan hasil dan pembahasan dengan bantuan AI.", "/data-synthesizer");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

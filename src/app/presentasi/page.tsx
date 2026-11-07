import PresentationWorkspace from "@/components/presentation/PresentationWorkspace";

export const metadata = {
  title: "Presentasi | keluhkampus",
  description: "Buat presentasi dengan AI dari materi Anda. Pilih desain, edit slide, dan unduh PowerPoint yang dapat diedit.",
};

export default function PresentasiPage() {
  return <PresentationWorkspace />;
}

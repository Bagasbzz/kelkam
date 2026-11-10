import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Pantau Progres Tugas", "Catat kemajuan tugas dan kebiasaan belajar.", "/tracker");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

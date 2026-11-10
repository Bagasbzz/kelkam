import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Studio AI", "Susun ide dan kerangka laporan bersama AI.", "/studio", { index: false });

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import { pageMeta } from "@/components/seo/JsonLd";

export const metadata = pageMeta("Buat Diagram UML Online", "Buat flowchart, use case, activity, sequence, class, dan ERD yang bisa diedit dan dipakai di laporan kuliah.", "/uml-builder");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

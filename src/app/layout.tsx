import type { Metadata } from "next";
import Navbar from "@/components/ui/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "keluhkampus | Platform Berbagai Tools Mahasiswa",
  description: "Platform berbagai tools mahasiswa untuk mempermudah pengerjaan tugas kuliahmu.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body
        className="antialiased bg-slate-50 text-slate-900 min-h-screen flex flex-col selection:bg-blue-200 selection:text-blue-900"
      >
        <Navbar />
        <div className="flex-1 flex flex-col mt-[72px]">
          {children}
        </div>
      </body>
    </html>
  );
}

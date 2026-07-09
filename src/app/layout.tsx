import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Navbar from "@/components/ui/Navbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 text-slate-900 min-h-screen flex flex-col selection:bg-blue-200 selection:text-blue-900`}
      >
        <Navbar />
        <div className="flex-1 flex flex-col mt-[72px]">
          {children}
        </div>
      </body>
    </html>
  );
}

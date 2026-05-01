import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

import Navbar from "@/components/ui/Navbar";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 text-slate-900 min-h-screen flex flex-col selection:bg-blue-200 selection:text-blue-900`}
      >
        <Navbar />
        {/* Subtle global background gradients */}
        <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-blue-100/40 rounded-full blur-[120px]" />
          <div className="absolute top-[20%] -right-[10%] w-[40%] h-[60%] bg-indigo-100/40 rounded-full blur-[120px]" />
          <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] bg-blue-50/50 rounded-full blur-[120px]" />
        </div>
        <div className="flex-1 flex flex-col mt-[72px]">
          {children}
        </div>
      </body>
    </html>
  );
}

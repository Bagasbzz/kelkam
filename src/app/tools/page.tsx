/**
 * src/app/tools/page.tsx
 * -----------------------------------------------------------------------------
 * Halaman /tools — umbrella untuk PDF/DOCX/Image tools. Tabs primitive
 * dari `src/components/ui/Tabs.tsx`; tiap tab render panel tools kategori
 * masing-masing (server-component shell + client island).
 *
 * Akses: publik, tidak butuh auth. Semua proses client-side (file tidak
 * di-upload ke server).
 * -----------------------------------------------------------------------------
 */

import { FileText, FileType, Image as ImageIcon, Wrench } from "lucide-react";
import { DocxToolsPanel } from "@/components/tools/DocxToolsPanel";
import { ImageToolsPanel } from "@/components/tools/ImageToolsPanel";
import { PDFToolsPanel } from "@/components/tools/PDFToolsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";

export const metadata = {
  title: "Tools | keluhkampus",
  description: "Kumpulan tools PDF, DOCX, dan Image — semua proses di browser, file aman.",
};

export default function ToolsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-[2rem] bg-slate-950 p-7 text-white shadow-2xl md:p-10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600">
              <Wrench className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Tools</h1>
              <p className="text-sm text-slate-300 md:text-base">
                Konversi, kompres, edit. Semua proses di browser — file tidak di-upload ke server.
              </p>
            </div>
          </div>
        </header>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <Tabs defaultValue="pdf">
            <TabsList className="mb-6 w-full overflow-x-auto md:w-auto">
              <TabsTrigger value="pdf" icon={<FileText className="h-4 w-4" aria-hidden />}>
                PDF
              </TabsTrigger>
              <TabsTrigger value="docx" icon={<FileType className="h-4 w-4" aria-hidden />}>
                DOCX
              </TabsTrigger>
              <TabsTrigger value="image" icon={<ImageIcon className="h-4 w-4" aria-hidden />}>
                Image
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pdf">
              <PDFToolsPanel />
            </TabsContent>
            <TabsContent value="docx">
              <DocxToolsPanel />
            </TabsContent>
            <TabsContent value="image">
              <ImageToolsPanel />
            </TabsContent>
          </Tabs>
        </div>

        <footer className="text-center text-xs text-slate-400">
          Semua proses di browser. File tidak pernah dikirim ke server.
        </footer>
      </div>
    </main>
  );
}
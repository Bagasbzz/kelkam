"use client";

import FileUpload from "@/components/FileUpload";
import { Info, Sparkles, ArrowRight, FileText, Search, AlertCircle } from "lucide-react";
import Navbar from "@/components/Navbar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ThesisDocument, THESIS_PRESETS } from "@/lib/types/thesis";

export default function FixFormatPage() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1: Upload, 2: Preview, 3: Processing
  const [parseResult, setParseResult] = useState<any>(null);
  const [doc, setDoc] = useState<ThesisDocument | null>(null);

  const handleImport = (result: any) => {
    setParseResult(result);
    
    // Create initial document object from result
    const newDoc: ThesisDocument = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        title: "Dokumen Impor",
        studentName: "",
        nim: "",
        university: "",
        faculty: "",
        prodi: "",
        supervisor: "",
        year: new Date().getFullYear().toString(),
        method: "",
        object: "",
        problem: "",
      },
      settings: THESIS_PRESETS["Standar Indonesia"],
      sections: result.sections,
      content: { type: 'doc', content: [] }, // Will be hydrated later
    };

    setDoc(newDoc);
    setStep(2);
  };

  const handleContinue = () => {
    if (!doc) return;
    setStep(3);
    
    // Flatten sections into a single Tiptap document content
    // In a real app, the editor might handle sections individually, 
    // but here we merge them for the unified editor.
    const allContent: any[] = [];
    doc.sections.forEach(chapter => {
        allContent.push({ 
          type: 'heading', 
          attrs: { level: 1, id: chapter.id }, 
          content: [{ type: 'text', text: chapter.title }] 
        });
        
        if (chapter.content && chapter.content.content) {
            allContent.push(...chapter.content.content);
        }
        
        chapter.children.forEach(sub => {
            allContent.push({ 
              type: 'heading', 
              attrs: { level: 2, id: sub.id }, 
              content: [{ type: 'text', text: sub.title }] 
            });
            
            if (sub.content && sub.content.content) {
                allContent.push(...sub.content.content);
            }
        });
    });

    const finalizedDoc = { ...doc, content: { type: 'doc', content: allContent } };
    localStorage.setItem("thesis_document", JSON.stringify(finalizedDoc));
    
    setTimeout(() => {
        router.push("/editor");
    }, 1000);
  };
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      
      <Navbar />

      <main className="w-full max-w-4xl mx-auto px-6 py-12 flex flex-col items-center">
        
        <div className="text-center mb-10 md:mb-16 animate-in fade-in slide-in-from-top duration-700">
          <div className="inline-flex p-3 bg-blue-100 text-blue-600 rounded-2xl mb-6">
            <FileText className="w-7 h-7 md:w-8 md:h-8" />
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4 leading-tight">Import Skripsi</h1>
          <p className="text-gray-500 max-w-xl mx-auto leading-relaxed text-sm md:text-base px-2">
            Upload file .docx Anda. Sistem akan mengekstrak struktur BAB secara otomatis dan membukanya di editor terpadu.
          </p>
        </div>

        <div className="w-full grid sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-8 mb-12">
            <Card className="p-5 md:p-6 border-dashed bg-gray-50/50">
                <Search className="w-6 h-6 text-blue-500 mb-4" />
                <h3 className="font-bold text-sm mb-2">Deteksi Otomatis</h3>
                <p className="text-xs text-gray-400">Kami mencari pola BAB I, 1.1, dan judul lainnya.</p>
            </Card>
            <Card className="p-5 md:p-6 border-dashed bg-gray-50/50">
                <ArrowRight className="w-6 h-6 text-indigo-500 mb-4" />
                <h3 className="font-bold text-sm mb-2">Konversi Struktur</h3>
                <p className="text-xs text-gray-400">Teks dirapikan ke dalam model dokumen terpadu.</p>
            </Card>
            <Card className="p-5 md:p-6 border-dashed bg-gray-50/50 sm:col-span-2 md:col-span-1">
                <Sparkles className="w-6 h-6 text-amber-500 mb-4" />
                <h3 className="font-bold text-sm mb-2">Editor Terpadu</h3>
                <p className="text-xs text-gray-400">Lanjutkan penulisan dengan formatting standar.</p>
            </Card>
        </div>

        <div className="w-full max-w-2xl">
          {step === 1 && (
            <FileUpload onSuccess={handleImport} />
          )}

          {step === 2 && doc && (
            <div className="space-y-6 md:space-y-8 animate-in fade-in zoom-in duration-500">
               <Card className="p-5 md:p-8 border-blue-100 bg-blue-50/20">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="shrink-0 w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                      <Sparkles className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-black text-lg md:text-xl text-gray-900">Struktur Berhasil Dideteksi</h3>
                      <p className="text-xs md:text-sm text-gray-500">Silakan periksa dan sesuaikan sebelum masuk ke editor.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
                    {[
                      { label: "BAB", value: parseResult.stats.chapters },
                      { label: "Sub-Bab", value: parseResult.stats.subChapters },
                      { label: "Paragraf", value: parseResult.stats.paragraphs },
                    ].map(stat => (
                      <div key={stat.label} className="bg-white p-4 rounded-2xl md:rounded-3xl border border-blue-50 flex sm:flex-col justify-between items-center sm:text-center">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest sm:mb-1">{stat.label}</p>
                        <p className="text-xl md:text-2xl font-black text-blue-600">{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="bg-white rounded-2xl md:rounded-3xl border border-blue-50 overflow-hidden mb-8">
                    <div className="p-3 md:p-4 bg-gray-50 border-b border-gray-100">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Preview Struktur</p>
                    </div>
                    <div className="p-3 md:p-4 max-h-80 md:max-h-96 overflow-y-auto space-y-2">
                       {doc.sections.map((chapter) => (
                         <div key={chapter.id} className="space-y-2">
                            <div className="flex items-center gap-3 p-2.5 md:p-3 bg-gray-50 rounded-xl">
                               <div className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                               <input 
                                 className="bg-transparent font-bold text-xs md:text-sm flex-1 outline-none text-gray-900"
                                 value={chapter.title}
                                 onChange={(e) => {
                                    const newSections = doc.sections.map(s => s.id === chapter.id ? { ...s, title: e.target.value } : s);
                                    setDoc({ ...doc, sections: newSections });
                                 }}
                               />
                            </div>
                            <div className="pl-6 md:pl-8 space-y-2">
                               {chapter.children.map(sub => (
                                 <div key={sub.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors group">
                                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                                    <input 
                                      className="bg-transparent text-[11px] md:text-xs font-medium flex-1 outline-none text-gray-600"
                                      value={sub.title}
                                      onChange={(e) => {
                                        const newSections = doc.sections.map(s => {
                                            if (s.id === chapter.id) {
                                                return { ...s, children: s.children.map(ss => ss.id === sub.id ? { ...ss, title: e.target.value } : ss) };
                                            }
                                            return s;
                                        });
                                        setDoc({ ...doc, sections: newSections });
                                      }}
                                    />
                                 </div>
                               ))}
                            </div>
                         </div>
                       ))}
                    </div>
                  </div>

                  <Button variant="dark" size="xl" className="w-full text-sm md:text-base py-4" onClick={handleContinue}>
                    LANJUTKAN KE EDITOR
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
               </Card>
            </div>
          )}

          {step === 3 && (
             <Card className="p-12 flex flex-col items-center justify-center text-center animate-pulse">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6" />
                <p className="font-black text-xl uppercase tracking-widest text-gray-900">Mempersiapkan Editor...</p>
                <p className="text-gray-400 mt-2">Menyimpan struktur ke dalam model dokumen terpadu.</p>
             </Card>
          )}
        </div>

        <div className="mt-20 flex gap-4 items-center p-4 bg-gray-50 rounded-2xl border border-gray-100 max-w-lg">
            <AlertCircle className="w-5 h-5 text-gray-400" />
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Format yang didukung: .docx (Disarankan menggunakan heading standar)
            </p>
        </div>
      </main>
      
    </div>
  );
}

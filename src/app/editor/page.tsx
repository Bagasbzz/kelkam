"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutPanelLeft, Settings2, Download } from "lucide-react";
import SkripsiEditor from "@/components/Editor";
import StructureSidebar from "@/components/editor/StructureSidebar";
import FormattingPanel from "@/components/editor/FormattingPanel";
import { RichTextNode, ThesisDocument, ThesisSettings } from "@/lib/types/thesis";
import { exportToDocx } from "@/utils/docx-exporter";

interface ThesisCheckpoint {
  id: string;
  name: string;
  data: ThesisDocument;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRichTextNode(value: unknown): value is RichTextNode {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.content !== undefined && (!Array.isArray(value.content) || !value.content.every(isRichTextNode))) return false;
  return true;
}

function isThesisDocument(value: unknown): value is ThesisDocument {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isRecord(value.metadata) &&
    isRecord(value.settings) &&
    Array.isArray(value.sections) &&
    isRichTextNode(value.content)
  );
}

function parseStoredDocument(raw: string): ThesisDocument | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isThesisDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCheckpoints(raw: string | null): ThesisCheckpoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((checkpoint): checkpoint is ThesisCheckpoint => {
      if (!isRecord(checkpoint)) return false;
      return (
        typeof checkpoint.id === "string" &&
        typeof checkpoint.name === "string" &&
        isThesisDocument(checkpoint.data)
      );
    });
  } catch {
    return [];
  }
}

export default function UnifiedEditorPage() {
  const router = useRouter();
  const [doc, setDoc] = useState<ThesisDocument | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 1. Initial Load & Fallback
  useEffect(() => {
    const saved = localStorage.getItem("thesis_document");
    if (!saved) {
      router.push("/template-generator");
      return;
    }

    const parsedDoc = parseStoredDocument(saved);
    if (!parsedDoc) {
      console.error("Stored thesis_document is invalid");
      router.push("/template-generator");
      return;
    }

    const timer = window.setTimeout(() => {
      setDoc(parsedDoc);
      setIsLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [router]);

  // 2. Debounced Autosave
  useEffect(() => {
    if (!doc) return;

    const timeout = setTimeout(() => {
      setIsSaving(true);
      localStorage.setItem("thesis_document", JSON.stringify(doc));
      // Also update the old 'skripsi-draft' for compatibility if needed
      if (doc.content) {
          localStorage.setItem('skripsi-draft', JSON.stringify(doc.content));
      }
      setTimeout(() => setIsSaving(false), 500);
    }, 3000); // 3s debounce

    return () => clearTimeout(timeout);
  }, [doc]);

  // 3. BeforeUnload Guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  if (!isLoaded || !doc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 pt-16">
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm font-semibold text-gray-600 shadow-sm">
          Memuat dokumen...
        </div>
      </div>
    );
  }

  const updateSettings = (newSettings: ThesisSettings) => {
    setDoc(prev => prev ? { ...prev, settings: newSettings, updatedAt: new Date().toISOString() } : null);
  };

  const updateContent = (newContent: RichTextNode) => {
    setDoc(prev => prev ? { ...prev, content: newContent, updatedAt: new Date().toISOString() } : null);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <div className="flex-1 flex pt-16 overflow-hidden">
        {/* Left Sidebar: Structural Control */}
        <aside className="w-72 bg-white border-r border-gray-100 flex flex-col hidden lg:flex">
          <div className="p-6 border-b border-gray-50 flex items-center justify-between">
            <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <LayoutPanelLeft className="w-4 h-4" />
              Struktur
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
             <StructureSidebar content={doc.content} onUpdate={updateContent} />
          </div>
        </aside>

        {/* Center: Editor Area */}
        <main className="flex-1 overflow-y-auto bg-gray-100/50 p-4 md:p-12 flex flex-col items-center">
            {/* Real-time Status */}
            <div className="w-full max-w-4xl mb-4 flex justify-between items-center px-4">
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isSaving ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`} />
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest font-sans">
                        {isSaving ? 'Menyimpan...' : 'Tersimpan ke Lokal'}
                    </span>
                </div>
                <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest border border-gray-200 px-3 py-1 rounded-full bg-white">
                    {doc.settings.paperSize} / {doc.settings.font.family}
                </div>
            </div>

            {/* A4 Paper View Wrapper */}
            <div 
                className="bg-white shadow-2xl shadow-gray-200 min-h-[1123px] w-full max-w-[794px] transition-all duration-500 mb-20"
                style={{
                    paddingTop: `${doc.settings.margins.top}mm`,
                    paddingBottom: `${doc.settings.margins.bottom}mm`,
                    paddingLeft: `${doc.settings.margins.left}mm`,
                    paddingRight: `${doc.settings.margins.right}mm`,
                    fontFamily: doc.settings.font.family,
                }}
            >
                <div 
                    className="prose prose-slate max-w-none"
                    style={{
                        fontSize: `${doc.settings.font.sizeBody}pt`,
                        lineHeight: doc.settings.font.lineSpacing,
                        textAlign: doc.settings.alignment,
                    }}
                >
                    <SkripsiEditor content={doc.content} onChange={updateContent} />
                </div>
            </div>
        </main>

        {/* Right Sidebar: Formatting */}
        <aside className="w-80 bg-white border-l border-gray-100 flex flex-col hidden xl:flex">
          <div className="p-6 border-b border-gray-50 flex items-center justify-between">
            <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Formatting
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <FormattingPanel settings={doc.settings} onUpdate={updateSettings} />
          </div>
          <div className="p-6 border-t border-gray-50 space-y-3">
             <button 
                onClick={() => {
                  if (!doc) return;
                  const checkpoints = parseCheckpoints(localStorage.getItem("thesis_checkpoints"));
                  const newCheckpoint = {
                    id: Date.now().toString(),
                    name: `Checkpoint ${new Date().toLocaleString('id-ID')}`,
                    data: doc
                  };
                  localStorage.setItem("thesis_checkpoints", JSON.stringify([newCheckpoint, ...checkpoints].slice(0, 5)));
                  alert("Checkpoint berhasil disimpan!");
                }}
                className="w-full py-3 border-2 border-gray-100 text-gray-400 font-black rounded-2xl flex items-center justify-center gap-2 hover:border-blue-200 hover:text-blue-600 transition-all mb-2"
             >
                SIMPAN CHECKPOINT
             </button>

             <button 
                onClick={() => doc && exportToDocx(doc.content, doc.settings)}
                className="w-full py-4 bg-gray-900 text-white font-black rounded-2xl flex items-center justify-center gap-2 hover:bg-blue-600 transition-all shadow-xl shadow-gray-200"
             >
                <Download className="w-5 h-5" />
                EXPORT SEKARANG
             </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Sparkles, FileSearch, Type, Copy, Check } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Textarea from "@/components/ui/Textarea";

export default function AIToolsPage() {
  const [activeTab, setActiveTab] = useState<"checker" | "rewriter">("checker");
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleProcess = async () => {
    if (!inputText.trim()) return;
    
    setIsLoading(true);
    setError("");
    setResult("");
    setCopied(false);

    const endpoint = activeTab === "checker" ? "/api/ai/structure-check" : "/api/ai/academic-rewrite";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal menghubungi AI");
      
      // Handle the standardized { success, data } format
      setResult(data.data || data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans p-6">
      <div className="max-w-5xl mx-auto py-12">
        
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">AI Academic Tools</h1>
          <p className="text-lg text-gray-500 max-w-lg mx-auto leading-relaxed">
            Asisten cerdas untuk mengecek struktur dan memperbaiki gaya bahasa laporan, makalah, proposal, atau skripsi Anda.
          </p>
        </div>

        <div className="flex items-center justify-center p-1 bg-gray-50 rounded-[2rem] max-w-sm mx-auto mb-12 border border-gray-100 mx-2 sm:mx-auto">
          <button 
            onClick={() => { setActiveTab("checker"); setInputText(""); setResult(""); setError(""); }}
            className={`flex-1 py-3 px-6 rounded-[1.8rem] text-sm font-black transition-all flex items-center justify-center gap-2 ${activeTab === "checker" ? 'bg-white shadow-lg text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <FileSearch className="w-4 h-4" />
            STRUKTUR
          </button>
          <button 
            onClick={() => { setActiveTab("rewriter"); setInputText(""); setResult(""); setError(""); }}
            className={`flex-1 py-3 px-6 rounded-[1.8rem] text-sm font-black transition-all flex items-center justify-center gap-2 ${activeTab === "rewriter" ? 'bg-white shadow-lg text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Type className="w-4 h-4" />
            REWRITER
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div className="space-y-6 animate-in slide-in-from-left duration-500">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-[0.2em]">Masukan Teks</h3>
              <button 
                onClick={() => setInputText("")} 
                className="text-[10px] font-black text-gray-300 hover:text-red-500 transition-colors uppercase"
              >
                BERSIHKAN
              </button>
            </div>
            
            <Card variant="borderless" padding="md" className="ring-offset-white border-2 border-transparent focus-within:border-blue-200 focus-within:ring-8 focus-within:ring-blue-50 transition-all">
              <Textarea 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="h-80 bg-transparent p-0 border-none focus:ring-0"
                placeholder={activeTab === "checker" ? "Tempelkan Bab 1 - Bab 3 Anda..." : "Tulis kalimat yang ingin diperbaiki agar lebih formal..."}
              />
              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-6">
                <span className="text-[10px] font-black text-gray-300">{inputText.length} KARAKTER</span>
                <Button 
                  onClick={handleProcess}
                  disabled={isLoading || !inputText.trim()}
                  variant={activeTab === "checker" ? "primary" : "secondary"}
                  isLoading={isLoading}
                  icon={Sparkles}
                >
                  {activeTab === "checker" ? "Cek Struktur" : "Rewrite"}
                </Button>
              </div>
            </Card>
          </div>

          <div className="space-y-6 animate-in slide-in-from-right duration-500">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-[0.2em]">Analisis AI</h3>
              {result && (
                <button 
                  onClick={handleCopy}
                  className={`text-[10px] font-black flex items-center gap-1.5 px-4 py-2 rounded-full border transition-all ${copied ? 'bg-green-50 border-green-200 text-green-600' : 'border-gray-100 text-gray-400 hover:text-gray-900'}`}
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'TERSALIN' : 'SALIN HASIL'}
                </button>
              )}
            </div>
            <Card variant={result ? "default" : "borderless"} padding="md" className="min-h-[448px] flex flex-col transition-all duration-700">
              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-30">
                  <div className={`w-12 h-12 border-4 rounded-full animate-spin border-t-transparent ${activeTab === 'checker' ? 'border-blue-600' : 'border-indigo-600'}`} />
                  <p className="text-sm font-black uppercase tracking-widest">Memproses...</p>
                </div>
              ) : result ? (
                <div className="prose prose-gray prose-p:leading-relaxed prose-p:text-gray-600 whitespace-pre-wrap font-serif text-lg flex-1">
                  {result}
                </div>
              ) : error ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-red-500 opacity-60">
                   <p className="font-black text-xs uppercase tracking-[0.2em] mb-2">Terjadi Kesalahan</p>
                   <p className="text-sm font-medium">{error}</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center space-y-6 text-center opacity-20 py-20">
                  <div className="w-20 h-20 rounded-[2rem] border-4 border-dashed border-gray-300 flex items-center justify-center">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <p className="max-w-[200px] text-sm font-bold leading-relaxed lowercase">
                    Klik tombol bintang untuk melihat analisis AI di sini.
                  </p>
                </div>
              )}
            </Card>
          </div>
        </div>

      </div>
    </div>
  );
}

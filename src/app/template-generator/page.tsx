"use client";

import { useState } from "react";
import { Sparkles, Loader2, User, BookOpen, CheckCircle2, ArrowRight, Settings2, ShieldCheck, Layout } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { ThesisDocument, THESIS_PRESETS, ThesisSettings } from "@/lib/types/thesis";

export default function SmartTemplatePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formatMode, setFormatMode] = useState<"standard" | "manual">("standard");
  const [formData, setFormData] = useState({
    studentName: "",
    nim: "",
    title: "",
    university: "",
    faculty: "",
    prodi: "",
    supervisor: "",
    year: new Date().getFullYear().toString(),
    method: "",
    object: "",
    problem: "",
  });

  const [manualSettings, setManualSettings] = useState<ThesisSettings>(THESIS_PRESETS["Standar Indonesia"]);

  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleNext = () => {
    setStep((prev) => prev + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFinish = () => {
    setIsLoading(true);
    
    // Generate unique IDs for sections
    const generateId = () => `section_${Math.random().toString(36).substr(2, 9)}`;

    // Generate stable IDs for initial sections
    const s1 = generateId();
    const s11 = generateId();
    const s12 = generateId();
    const s2 = generateId();
    const s3 = generateId();
    const s4 = generateId();
    const s5 = generateId();

    const newDoc: ThesisDocument = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: formData,
      settings: formatMode === "standard" ? THESIS_PRESETS["Standar Indonesia"] : manualSettings,
      sections: [
        { id: s1, title: 'BAB 1 PENDAHULUAN', level: 1, children: [
          { id: s11, title: '1.1 Latar Belakang', level: 2, children: [] },
          { id: s12, title: '1.2 Rumusan Masalah', level: 2, children: [] },
        ] },
        { id: s2, title: 'BAB 2 TINJAUAN PUSTAKA', level: 1, children: [] },
        { id: s3, title: 'BAB 3 METODOLOGI PENELITIAN', level: 1, children: [] },
        { id: s4, title: 'BAB 4 HASIL DAN PEMBAHASAN', level: 1, children: [] },
        { id: s5, title: 'BAB 5 KESIMPULAN', level: 1, children: [] },
      ],
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, id: s1 }, content: [{ type: 'text', text: 'BAB 1 PENDAHULUAN' }] },
          { type: 'heading', attrs: { level: 2, id: s11 }, content: [{ type: 'text', text: '1.1 Latar Belakang' }] },
          { type: 'paragraph', content: [{ type: 'text', text: `Penelitian ini dilatarbelakangi oleh ${formData.problem} pada ${formData.object}...` }] },
          { type: 'heading', attrs: { level: 2, id: s12 }, content: [{ type: 'text', text: '1.2 Rumusan Masalah' }] },
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 1, id: s2 }, content: [{ type: 'text', text: 'BAB 2 TINJAUAN PUSTAKA' }] },
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 1, id: s3 }, content: [{ type: 'text', text: 'BAB 3 METODOLOGI PENELITIAN' }] },
          { type: 'paragraph', content: [{ type: 'text', text: `Metode yang digunakan adalah ${formData.method}.` }] },
          { type: 'heading', attrs: { level: 1, id: s4 }, content: [{ type: 'text', text: 'BAB 4 HASIL DAN PEMBAHASAN' }] },
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 1, id: s5 }, content: [{ type: 'text', text: 'BAB 5 KESIMPULAN' }] },
          { type: 'paragraph' },
        ],
      },
    };

    localStorage.setItem("thesis_document", JSON.stringify(newDoc));
    
    setTimeout(() => {
        setIsLoading(false);
        router.push("/editor");
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans p-6">
      <div className="max-w-3xl mx-auto py-12">
        
        <Navbar />

        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Template Generator</h1>
          <p className="text-lg text-gray-500 max-w-lg mx-auto leading-relaxed">
            Hasilkan struktur skripsi lengkap yang sudah terformat rapi sesuai aturan akademik.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 mb-16">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black transition-all ${step >= s ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-gray-100 text-gray-400'}`}>
                {s}
              </div>
              {s < 3 && <div className={`w-12 h-1 rounded-full ${step > s ? 'bg-blue-600' : 'bg-gray-100'}`} />}
            </div>
          ))}
        </div>

        <Card padding="lg">
          {step === 1 && (
            <div className="animate-in slide-in-from-right duration-500 space-y-8">
              <h3 className="text-2xl font-black flex items-center gap-3">
                <User className="w-6 h-6 text-blue-600" />
                Informasi Dasar
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                <Input label="Nama Lengkap" name="studentName" value={formData.studentName} onChange={handleChange} placeholder="Budi Santoso" />
                <Input label="NIM / NPM" name="nim" value={formData.nim} onChange={handleChange} placeholder="12345678" />
                <Input label="Universitas" name="university" value={formData.university} onChange={handleChange} placeholder="Nama Kampus" />
                <Input label="Fakultas" name="faculty" value={formData.faculty} onChange={handleChange} placeholder="Teknik / Ekonomi" />
              </div>
              <Button 
                onClick={handleNext} 
                disabled={!formData.studentName || !formData.university}
                className="w-full"
                variant="dark"
                size="xl"
              >
                LANJUT KE PARAMETER PENELITIAN
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in slide-in-from-right duration-500 space-y-8">
              <h3 className="text-2xl font-black flex items-center gap-3">
                <Layout className="w-6 h-6 text-blue-600" />
                Parameter Penelitian
              </h3>
              <div className="space-y-6">
                <Textarea label="Judul Skripsi" name="title" value={formData.title} onChange={handleChange} placeholder="Tulis judul lengkap Anda di sini..." className="h-24" />
                <div className="grid md:grid-cols-2 gap-6">
                  <Input label="Metode" name="method" value={formData.method} onChange={handleChange} placeholder="Kuantitatif / Kualitatif" />
                  <Input label="Objek" name="object" value={formData.object} onChange={handleChange} placeholder="UMKM / Startup / Sekolah" />
                </div>
                <Textarea label="Masalah Utama" name="problem" value={formData.problem} onChange={handleChange} placeholder="Jelaskan masalah utama yang diangkat..." className="h-24" />
              </div>
              <div className="flex gap-4">
                <Button variant="ghost" onClick={() => setStep(1)}>KEMBALI</Button>
                <Button 
                  onClick={handleNext} 
                  disabled={!formData.title || !formData.method} 
                  className="flex-1"
                  variant="dark"
                  size="xl"
                >
                  LANJUT KE PENGATURAN FORMAT
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-in slide-in-from-right duration-500 space-y-8">
              <h3 className="text-2xl font-black flex items-center gap-3">
                <Settings2 className="w-6 h-6 text-blue-600" />
                Pengaturan Format Dokumen
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button 
                    onClick={() => setFormatMode("standard")}
                    className={`p-5 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border-2 transition-all text-left ${formatMode === 'standard' ? 'border-blue-600 bg-blue-50/50' : 'border-gray-100 hover:border-gray-200'}`}
                  >
                      <ShieldCheck className={`w-6 h-6 md:w-8 md:h-8 mb-3 md:mb-4 ${formatMode === 'standard' ? 'text-blue-600' : 'text-gray-300'}`} />
                      <p className="font-black text-xs md:text-sm uppercase tracking-widest mb-1">Standar Indonesia</p>
                      <p className="text-[10px] text-gray-400 font-bold">4-4-3-3, TNR 12, Spasi 1.5</p>
                  </button>
                  <button 
                    onClick={() => setFormatMode("manual")}
                    className={`p-5 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border-2 transition-all text-left ${formatMode === 'manual' ? 'border-indigo-600 bg-indigo-50/50' : 'border-gray-100 hover:border-gray-200'}`}
                  >
                      <Settings2 className={`w-6 h-6 md:w-8 md:h-8 mb-3 md:mb-4 ${formatMode === 'manual' ? 'text-indigo-600' : 'text-gray-300'}`} />
                      <p className="font-black text-xs md:text-sm uppercase tracking-widest mb-1">Format Manual</p>
                      <p className="text-[10px] text-gray-400 font-bold">Atur margin & font sendiri</p>
                  </button>
              </div>

              {formatMode === "manual" && (
                  <div className="p-5 md:p-6 bg-gray-50 rounded-[1.5rem] md:rounded-[2rem] space-y-6 animate-in fade-in duration-500">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                          <Input label="Atas" type="number" value={manualSettings.margins.top} onChange={(e) => setManualSettings({...manualSettings, margins: {...manualSettings.margins, top: Number(e.target.value)}})} />
                          <Input label="Kiri" type="number" value={manualSettings.margins.left} onChange={(e) => setManualSettings({...manualSettings, margins: {...manualSettings.margins, left: Number(e.target.value)}})} />
                          <Input label="Bawah" type="number" value={manualSettings.margins.bottom} onChange={(e) => setManualSettings({...manualSettings, margins: {...manualSettings.margins, bottom: Number(e.target.value)}})} />
                          <Input label="Kanan" type="number" value={manualSettings.margins.right} onChange={(e) => setManualSettings({...manualSettings, margins: {...manualSettings.margins, right: Number(e.target.value)}})} />
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                          <Input label="Ukuran Font" type="number" value={manualSettings.font.sizeBody} onChange={(e) => setManualSettings({...manualSettings, font: {...manualSettings.font, sizeBody: Number(e.target.value)}})} />
                          <Input label="Spasi Baris" type="number" step="0.1" value={manualSettings.font.lineSpacing} onChange={(e) => setManualSettings({...manualSettings, font: {...manualSettings.font, lineSpacing: Number(e.target.value)}})} />
                      </div>
                  </div>
              )}

              <div className="flex gap-4 pt-4">
                <Button variant="ghost" onClick={() => setStep(2)}>KEMBALI</Button>
                <Button 
                  onClick={handleFinish} 
                  disabled={isLoading} 
                  isLoading={isLoading}
                  variant="primary"
                  size="xl"
                  className="flex-1"
                  icon={Sparkles}
                >
                  BUKA EDITOR SKRIPSI
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="animate-in zoom-in-95 duration-500 text-center py-8">
              <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <h2 className="text-3xl font-black mb-4">Template Berhasil Dibuat!</h2>
              <p className="text-gray-400 font-medium mb-10">File dikirim ke folder unduhan Anda. Selamat menulis!</p>
              <div className="flex flex-col gap-4 max-w-sm mx-auto">
                <Button variant="dark" size="lg" onClick={() => { setStep(1); }}>
                  Buat Template Baru
                </Button>
                <Link href="/" className="text-sm font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-widest">
                  KEMBALI KE BERANDA
                </Link>
              </div>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileText,
  GitBranch,
  Lightbulb,
  PenLine,
  Plus,
  Save,
  Sparkles,
  Workflow,
} from "lucide-react";
import Navbar from "@/components/Navbar";

type ProjectType = "capstone" | "course" | "practicum" | "paper" | "formal" | "thesis";
type Formality = "ringkas" | "formal" | "akademik";
type SectionStatus = "draft" | "review" | "approved";
type DiagramStatus = "planned" | "draft" | "approved";

interface ReportSection {
  id: string;
  title: string;
  purpose: string;
  requiredDiagrams: string[];
  status: SectionStatus;
}

interface DiagramPlan {
  id: string;
  title: string;
  type: "flowchart" | "activity" | "usecase" | "sequence" | "communication";
  purpose: string;
  prompt: string;
  status: DiagramStatus;
  approvedAt?: string;
  caption?: string;
  diagramData?: {
    nodes: unknown[];
    edges: unknown[];
    meta?: Record<string, unknown>;
  };
}

interface SourceNote {
  id: string;
  title: string;
  content: string;
}

interface ReportProject {
  projectType: ProjectType;
  title: string;
  topic: string;
  course: string;
  institution: string;
  formality: Formality;
  citationStyle: "APA" | "IEEE" | "Bebas";
  sources: SourceNote[];
  outline: ReportSection[];
  diagrams: DiagramPlan[];
}

const STORAGE_KEY = "report_builder_project_v1";

const projectTypeLabel: Record<ProjectType, string> = {
  capstone: "Capstone / Projek Akhir",
  course: "Tugas Mata Kuliah",
  practicum: "Laporan Praktikum",
  paper: "Makalah Biasa",
  formal: "Laporan Projek Formal",
  thesis: "Skripsi / Proposal",
};

const defaultProject: ReportProject = {
  projectType: "formal",
  title: "",
  topic: "",
  course: "",
  institution: "",
  formality: "formal",
  citationStyle: "APA",
  sources: [],
  outline: [],
  diagrams: [],
};

const makeId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

function buildOutline(project: ReportProject): ReportSection[] {
  const hasSystemTopic = /sistem|aplikasi|website|web|mobile|absensi|kasir|penjualan|rekomendasi|database/i.test(`${project.title} ${project.topic}`);

  if (project.projectType === "practicum") {
    return [
      { id: "sec-cover", title: "Identitas Praktikum", purpose: "Memuat judul, nama, kelas, mata kuliah, dan identitas praktikum.", requiredDiagrams: [], status: "draft" },
      { id: "sec-purpose", title: "Tujuan Praktikum", purpose: "Menjelaskan kompetensi dan target percobaan.", requiredDiagrams: [], status: "draft" },
      { id: "sec-theory", title: "Dasar Teori", purpose: "Merangkum teori yang relevan dengan percobaan dan menyertakan sitasi.", requiredDiagrams: [], status: "draft" },
      { id: "sec-tools", title: "Alat dan Bahan", purpose: "Mendaftar perangkat, software, dataset, atau bahan percobaan.", requiredDiagrams: [], status: "draft" },
      { id: "sec-steps", title: "Langkah Kerja", purpose: "Menjelaskan prosedur kerja secara runtut.", requiredDiagrams: hasSystemTopic ? ["flow-main"] : [], status: "draft" },
      { id: "sec-result", title: "Hasil dan Pembahasan", purpose: "Menyajikan hasil, analisis, screenshot, tabel, dan interpretasi.", requiredDiagrams: [], status: "draft" },
      { id: "sec-close", title: "Kesimpulan", purpose: "Merangkum hasil praktikum dan pembelajaran utama.", requiredDiagrams: [], status: "draft" },
    ];
  }

  if (project.projectType === "paper") {
    return [
      { id: "sec-intro", title: "Pendahuluan", purpose: "Menjelaskan latar belakang, masalah, tujuan, dan batasan pembahasan.", requiredDiagrams: [], status: "draft" },
      { id: "sec-theory", title: "Kajian Teori", purpose: "Menyusun konsep utama dan sitasi pendukung.", requiredDiagrams: [], status: "draft" },
      { id: "sec-discussion", title: "Pembahasan", purpose: "Mengembangkan analisis utama berdasarkan topik dan bahan mentah.", requiredDiagrams: hasSystemTopic ? ["usecase-main"] : [], status: "draft" },
      { id: "sec-close", title: "Penutup", purpose: "Berisi kesimpulan dan saran singkat.", requiredDiagrams: [], status: "draft" },
      { id: "sec-ref", title: "Daftar Pustaka", purpose: `Daftar sumber dengan gaya ${project.citationStyle}.`, requiredDiagrams: [], status: "draft" },
    ];
  }

  return [
    { id: "bab1", title: "BAB 1 Pendahuluan", purpose: "Latar belakang, rumusan masalah, tujuan, manfaat, batasan, dan metode singkat.", requiredDiagrams: [], status: "draft" },
    { id: "bab2", title: "BAB 2 Landasan Teori", purpose: "Teori, konsep sistem, teknologi, dan penelitian/rujukan terkait.", requiredDiagrams: [], status: "draft" },
    { id: "bab3", title: "BAB 3 Analisis dan Perancangan", purpose: "Analisis kebutuhan, aktor, proses bisnis, rancangan UML, database, dan UI.", requiredDiagrams: hasSystemTopic ? ["usecase-main", "activity-login", "activity-manage", "flow-main"] : ["flow-main"], status: "draft" },
    { id: "bab4", title: "BAB 4 Implementasi dan Pengujian", purpose: "Implementasi fitur, hasil tampilan, pengujian, dan evaluasi.", requiredDiagrams: [], status: "draft" },
    { id: "bab5", title: "BAB 5 Penutup", purpose: "Kesimpulan, saran pengembangan, dan keterbatasan.", requiredDiagrams: [], status: "draft" },
    { id: "ref", title: "Daftar Pustaka", purpose: `Semua referensi dirapikan dengan gaya ${project.citationStyle}.`, requiredDiagrams: [], status: "draft" },
  ];
}

function buildDiagramPlan(project: ReportProject): DiagramPlan[] {
  const topic = project.title || project.topic || "Sistem";
  const hasSystemTopic = /sistem|aplikasi|website|web|mobile|absensi|kasir|penjualan|rekomendasi|database/i.test(`${project.title} ${project.topic}`);
  if (!hasSystemTopic) return [];

  return [
    {
      id: "usecase-main",
      title: "Use Case Diagram Sistem",
      type: "usecase",
      purpose: "Menggambarkan aktor dan fitur utama sistem.",
      prompt: `Buat use case diagram untuk ${topic}. Tentukan aktor utama, fitur login, kelola data utama, transaksi/proses inti, dan laporan jika relevan.`,
      status: "planned",
    },
    {
      id: "activity-login",
      title: "Activity Diagram Login",
      type: "activity",
      purpose: "Menjelaskan alur login, validasi kredensial, role, sukses, dan gagal.",
      prompt: `Buat activity diagram login untuk ${topic} dengan swimlane Pengguna/Admin dan Sistem. Sertakan validasi kredensial, role admin/user, pesan gagal, dan dashboard sesuai role.`,
      status: "planned",
    },
    {
      id: "activity-manage",
      title: "Activity Diagram Kelola Data",
      type: "activity",
      purpose: "Menjelaskan proses tambah, ubah, hapus, validasi, simpan, dan error.",
      prompt: `Buat activity diagram kelola data untuk ${topic}. Sertakan aksi tambah, ubah, hapus, validasi data, pesan error, simpan data, hapus data, dan perbarui daftar.`,
      status: "planned",
    },
    {
      id: "flow-main",
      title: "Flowchart Proses Utama",
      type: "flowchart",
      purpose: "Menggambarkan alur besar pengguna dari mulai sampai selesai.",
      prompt: `Buat flowchart proses utama untuk ${topic}. Susun alur dari mulai, login, dashboard, pilih fitur utama, validasi, proses data, tampilkan hasil, dan selesai.`,
      status: "planned",
    },
  ];
}

function qualityChecks(project: ReportProject) {
  return [
    { label: "Judul/topik sudah jelas", ok: Boolean(project.title.trim() || project.topic.trim()) },
    { label: "Jenis laporan sudah dipilih", ok: Boolean(project.projectType) },
    { label: "Outline sudah dibuat", ok: project.outline.length > 0 },
    { label: "Bahan mentah/contoh sudah masuk", ok: project.sources.length > 0 },
    { label: "Diagram sudah direncanakan", ok: project.diagrams.length > 0 || project.projectType === "paper" || project.projectType === "practicum" },
    { label: "Semua diagram penting sudah approved", ok: project.diagrams.length === 0 || project.diagrams.every((d) => d.status === "approved" && Boolean(d.diagramData)) },
    { label: "Gaya sitasi dipilih", ok: Boolean(project.citationStyle) },
  ];
}

export default function ReportBuilderPage() {
  const router = useRouter();
  const [project, setProject] = useState<ReportProject>(defaultProject);
  const [sourceDraft, setSourceDraft] = useState({ title: "", content: "" });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setProject({ ...defaultProject, ...JSON.parse(saved) });
      } catch {
        setProject(defaultProject);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  const checks = useMemo(() => qualityChecks(project), [project]);
  const approvedCount = project.diagrams.filter((d) => d.status === "approved" && d.diagramData).length;

  const updateProject = <K extends keyof ReportProject>(key: K, value: ReportProject[K]) => {
    setProject((prev) => ({ ...prev, [key]: value }));
  };

  const generatePlan = () => {
    setProject((prev) => {
      const next = { ...prev };
      next.outline = buildOutline(prev);
      next.diagrams = buildDiagramPlan(prev);
      return next;
    });
  };

  const addSource = () => {
    if (!sourceDraft.title.trim() && !sourceDraft.content.trim()) return;
    setProject((prev) => ({
      ...prev,
      sources: [{ id: makeId("src"), title: sourceDraft.title || "Bahan Mentah", content: sourceDraft.content }, ...prev.sources],
    }));
    setSourceDraft({ title: "", content: "" });
  };

  const sendToUmlBuilder = (diagram: DiagramPlan) => {
    const sourceSummary = project.sources.slice(0, 3).map((source) => ({
      title: source.title,
      preview: source.content.slice(0, 500),
    }));

    localStorage.setItem("uml-ai-prefill", JSON.stringify({
      prompt: diagram.prompt,
      diagramType: ["flowchart", "activity", "usecase"].includes(diagram.type) ? diagram.type : "flowchart",
      reportDiagramId: diagram.id,
      title: diagram.title,
      reportContext: {
        reportTitle: project.title,
        topic: project.topic.slice(0, 700),
        projectType: project.projectType,
        course: project.course,
        citationStyle: project.citationStyle,
        sources: sourceSummary,
      },
      diagramData: diagram.diagramData,
    }));
    router.push("/uml-builder");
  };

  const setDiagramStatus = (id: string, status: DiagramStatus) => {
    setProject((prev) => ({
      ...prev,
      diagrams: prev.diagrams.map((diagram) => {
        if (diagram.id !== id) return diagram;
        if (status === "approved" && !diagram.diagramData) return { ...diagram, status: "draft" };
        return { ...diagram, status };
      }),
    }));
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 py-10 md:py-16">
        <Link href="/" className="inline-flex items-center text-sm font-semibold text-slate-500 hover:text-blue-600 mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" /> Kembali ke Beranda
        </Link>

        <section className="mb-8 md:mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-black uppercase tracking-widest mb-4">
            <Sparkles className="w-4 h-4" /> Laporan Builder v1
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Rancang laporan, diagram, dan struktur akademik dari satu tempat.</h1>
          <p className="text-slate-500 max-w-3xl text-base md:text-lg leading-relaxed">
            Pilih bentuk proyek, masukkan bahan mentah atau contoh laporan, lalu sistem menyusun outline, kebutuhan diagram, dan checklist kualitas sebelum masuk tahap penulisan final.
          </p>
        </section>

        <div className="grid xl:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
          <div className="space-y-6">
            <section className="border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><ClipboardList className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-xl font-black">Setup Proyek</h2>
                  <p className="text-sm text-slate-500">Tentukan konteks dulu supaya output tidak generik.</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Jenis laporan</span>
                  <select value={project.projectType} onChange={(e) => updateProject("projectType", e.target.value as ProjectType)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500">
                    {Object.entries(projectTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Gaya bahasa</span>
                  <select value={project.formality} onChange={(e) => updateProject("formality", e.target.value as Formality)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500">
                    <option value="ringkas">Ringkas</option>
                    <option value="formal">Formal</option>
                    <option value="akademik">Akademik penuh</option>
                  </select>
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Judul sementara</span>
                  <input value={project.title} onChange={(e) => updateProject("title", e.target.value)} placeholder="Contoh: Rancang Bangun Sistem Absensi QR Karyawan" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500" />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Topik / kebutuhan dosen / ide kasar</span>
                  <textarea value={project.topic} onChange={(e) => updateProject("topic", e.target.value)} placeholder="Tempel brief tugas, ide capstone, fitur aplikasi, aturan dosen, atau masalah yang ingin dibahas..." className="min-h-28 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-blue-500" />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Mata kuliah / konteks</span>
                  <input value={project.course} onChange={(e) => updateProject("course", e.target.value)} placeholder="PBO, RPL, Basis Data, Capstone..." className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500" />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Sitasi</span>
                  <select value={project.citationStyle} onChange={(e) => updateProject("citationStyle", e.target.value as ReportProject["citationStyle"])} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500">
                    <option value="APA">APA</option>
                    <option value="IEEE">IEEE</option>
                    <option value="Bebas">Bebas</option>
                  </select>
                </label>
              </div>

              <button onClick={generatePlan} className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700 transition-colors">
                <Lightbulb className="w-4 h-4" /> Rancang Outline & Diagram
              </button>
            </section>

            <section className="border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><BookOpen className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-xl font-black">Bahan Mentah & Contoh</h2>
                  <p className="text-sm text-slate-500">Masukkan brief, contoh laporan, catatan, referensi, atau bahan kasar.</p>
                </div>
              </div>

              <div className="grid md:grid-cols-[0.8fr_1.2fr_auto] gap-3 items-start">
                <input value={sourceDraft.title} onChange={(e) => setSourceDraft((prev) => ({ ...prev, title: e.target.value }))} placeholder="Judul bahan" className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-amber-500" />
                <textarea value={sourceDraft.content} onChange={(e) => setSourceDraft((prev) => ({ ...prev, content: e.target.value }))} placeholder="Tempel bahan mentah di sini..." className="min-h-24 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-amber-500" />
                <button onClick={addSource} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-amber-600 transition-colors">
                  <Plus className="w-4 h-4" /> Tambah
                </button>
              </div>

              <div className="mt-4 grid md:grid-cols-2 gap-3">
                {project.sources.length === 0 ? (
                  <div className="md:col-span-2 rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-400 font-semibold">Belum ada bahan. Tambahkan minimal brief tugas atau catatan kasar supaya nanti AI tidak ngarang.</div>
                ) : project.sources.map((source) => (
                  <div key={source.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="font-black text-slate-800 mb-1">{source.title}</p>
                    <p className="text-xs text-slate-500 line-clamp-3">{source.content}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center"><CheckCircle2 className="w-5 h-5" /></div>
                  <h2 className="text-xl font-black">Quality Gate</h2>
                </div>
                <span className="text-xs font-black text-slate-400">{checks.filter((c) => c.ok).length}/{checks.length}</span>
              </div>
              <div className="space-y-2">
                {checks.map((check) => (
                  <div key={check.label} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${check.ok ? "bg-green-500" : "bg-slate-300"}`} />
                    <span className={`text-sm font-bold ${check.ok ? "text-slate-700" : "text-slate-400"}`}>{check.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><GitBranch className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-xl font-black">Diagram Plan</h2>
                  <p className="text-sm text-slate-500">{approvedCount}/{project.diagrams.length} diagram approved.</p>
                </div>
              </div>

              <div className="space-y-3">
                {project.diagrams.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-400 font-semibold">Klik rancang outline dulu. Diagram akan muncul otomatis kalau topiknya berbasis sistem/aplikasi.</div>
                ) : project.diagrams.map((diagram) => (
                  <div key={diagram.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-900">{diagram.title}</p>
                        <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mt-1">{diagram.type}</p>
                        <p className="text-xs text-slate-500 mt-2 leading-relaxed">{diagram.purpose}</p>
                      </div>
                      <select value={diagram.status} onChange={(e) => setDiagramStatus(diagram.id, e.target.value as DiagramStatus)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold">
                        <option value="planned">planned</option>
                        <option value="draft">draft</option>
                        <option value="approved" disabled={!diagram.diagramData}>approved</option>
                      </select>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${diagram.diagramData ? "bg-green-100 text-green-700" : "bg-white text-slate-400 border border-slate-200"}`}>
                        {diagram.diagramData ? "diagram tersimpan" : "belum ada diagram"}
                      </span>
                      {diagram.approvedAt && <span className="text-[10px] font-bold text-slate-400">Approved {new Date(diagram.approvedAt).toLocaleDateString("id-ID")}</span>}
                    </div>
                    <button onClick={() => sendToUmlBuilder(diagram)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 transition-colors">
                      <Workflow className="w-4 h-4" /> {diagram.diagramData ? "Edit di UML Builder" : "Buat di UML Builder"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section className="mt-6 border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><FileText className="w-5 h-5" /></div>
              <div>
                <h2 className="text-xl font-black">Outline Laporan</h2>
                <p className="text-sm text-slate-500">Struktur awal yang nanti bisa dipakai untuk generate isi per bagian.</p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest"><Save className="w-4 h-4" /> Auto-save lokal</div>
          </div>

          {project.outline.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 font-semibold">Outline belum dibuat. Isi setup proyek lalu klik Rancang Outline & Diagram.</div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {project.outline.map((section) => (
                <div key={section.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-black text-slate-900 leading-snug">{section.title}</h3>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{section.status}</span>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">{section.purpose}</p>
                  {section.requiredDiagrams.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {section.requiredDiagrams.map((diagramId) => (
                        <span key={diagramId} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-indigo-600 border border-indigo-100">{diagramId}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 grid md:grid-cols-3 gap-4">
          <Link href="/ai-tools" className="rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
            <PenLine className="w-6 h-6 text-blue-600 mb-3" />
            <p className="font-black text-slate-900">Benerin Bahasa & Sitasi</p>
            <p className="text-sm text-slate-500 mt-1">Pakai AI Academic Tools untuk rewrite dan cek struktur.</p>
          </Link>
          <Link href="/data-synthesizer" className="rounded-2xl border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all">
            <BookOpen className="w-6 h-6 text-indigo-600 mb-3" />
            <p className="font-black text-slate-900">Olah Data Mentah</p>
            <p className="text-sm text-slate-500 mt-1">Ubah kuesioner, wawancara, atau observasi jadi narasi.</p>
          </Link>
          <Link href="/template-generator" className="rounded-2xl border border-slate-200 p-5 hover:border-amber-300 hover:shadow-sm transition-all">
            <FileText className="w-6 h-6 text-amber-600 mb-3" />
            <p className="font-black text-slate-900">Buka Editor Dokumen</p>
            <p className="text-sm text-slate-500 mt-1">Lanjut ke editor untuk menulis dan export DOCX.</p>
          </Link>
        </section>
      </main>
    </div>
  );
}

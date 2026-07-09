"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileArchive,
  FileCheck2,
  FileText,
  GitBranch,
  Lightbulb,
  Search,
  PenLine,
  Plus,
  Save,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";

type ProjectType = "capstone" | "course" | "practicum" | "paper" | "formal" | "thesis";
type Formality = "ringkas" | "formal" | "akademik";
type SectionStatus = "draft" | "review" | "approved";
type DiagramStatus = "planned" | "draft" | "approved";
type SourceKind = "brief" | "guide" | "example" | "reference" | "code" | "note";
type WorkflowStage = "intake" | "planned" | "drafted";

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
  kind?: SourceKind;
  title: string;
  content: string;
  fileName?: string;
}

interface TablePlan {
  id: string;
  title: string;
  purpose: string;
  columns: string[];
  status: "planned" | "draft" | "done";
}

interface ReferenceItem {
  id: string;
  query: string;
  purpose: string;
  status: "planned" | "saved";
  citation?: string;
  url?: string;
}

interface ReportDraft {
  content: string;
  generatedAt: string;
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
  tables: TablePlan[];
  references: ReferenceItem[];
  titleIdeas: string[];
  workflowStage: WorkflowStage;
  reportDraft?: ReportDraft;
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

const sourceKindLabel: Record<SourceKind, string> = {
  brief: "Brief / aturan tugas",
  guide: "Pedoman dosen / kampus",
  example: "Contoh laporan benar",
  reference: "Referensi / sitasi",
  code: "Konteks codingan / repo",
  note: "Catatan bebas",
};

const sourceKindHint: Record<SourceKind, string> = {
  brief: "Tempel brief tugas, rubrik penilaian, batasan, atau instruksi dosen.",
  guide: "Tempel poin penting dari PDF pedoman, format kampus, atau aturan penulisan.",
  example: "Tempel struktur/contoh laporan yang dianggap benar supaya sistem meniru pola, bukan isinya mentah-mentah.",
  reference: "Tempel daftar jurnal, link, DOI, kutipan, atau catatan teori yang ingin dipakai.",
  code: "Tempel README, struktur folder, daftar fitur, route/API, schema DB, atau ringkasan ZIP project codingan.",
  note: "Tempel catatan kasar, hasil diskusi, kebutuhan user, atau ide yang belum rapi.",
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
  tables: [],
  references: [],
  titleIdeas: [],
  workflowStage: "intake",
};

const makeId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

const getProjectContext = (project: ReportProject) => `${project.title} ${project.topic} ${project.course} ${project.sources.map((source) => `${source.kind || "note"} ${source.title} ${source.content}`).join(" ")}`;

const isSystemProject = (project: ReportProject) => /sistem|aplikasi|website|web|mobile|absensi|kasir|penjualan|rekomendasi|database|login|admin|user|dashboard|api|route|controller|model|schema|mysql|postgres|supabase/i.test(getProjectContext(project));

function buildTitleIdeas(project: ReportProject): string[] {
  const base = (project.title || project.topic || "Sistem Informasi").replace(/\s+/g, " ").trim();
  const object = base.length > 90 ? `${base.slice(0, 90)}...` : base;
  const context = project.course || projectTypeLabel[project.projectType];

  if (isSystemProject(project)) {
    return [
      `Rancang Bangun ${object}`,
      `Analisis dan Perancangan ${object} Berbasis Web`,
      `Implementasi ${object} untuk Mendukung Proses ${context}`,
    ];
  }

  return [
    `Analisis ${object}`,
    `Kajian ${object} pada Konteks ${context}`,
    `Penyusunan Laporan ${object} Berdasarkan Data dan Referensi Terkait`,
  ];
}

function buildTablePlan(project: ReportProject): TablePlan[] {
  if (isSystemProject(project)) {
    return [
      { id: "tbl-actor", title: "Tabel Aktor dan Hak Akses", purpose: "Menjelaskan siapa saja pengguna sistem dan batas aksesnya.", columns: ["Aktor", "Hak Akses", "Keterangan"], status: "planned" },
      { id: "tbl-functional", title: "Tabel Kebutuhan Fungsional", purpose: "Merinci fitur utama yang harus tersedia di aplikasi.", columns: ["Kode", "Kebutuhan", "Aktor", "Prioritas"], status: "planned" },
      { id: "tbl-nonfunctional", title: "Tabel Kebutuhan Non-Fungsional", purpose: "Menjelaskan kebutuhan performa, keamanan, usability, dan kompatibilitas.", columns: ["Aspek", "Kebutuhan", "Ukuran Keberhasilan"], status: "planned" },
      { id: "tbl-test", title: "Tabel Pengujian Black Box", purpose: "Menguji fitur berdasarkan input, proses, dan output yang diharapkan.", columns: ["Fitur", "Skenario", "Hasil Diharapkan", "Status"], status: "planned" },
    ];
  }

  return [
    { id: "tbl-source", title: "Tabel Ringkasan Sumber", purpose: "Merangkum referensi, pedoman, dan bahan utama yang dipakai.", columns: ["Sumber", "Isi Penting", "Pemakaian di Laporan"], status: "planned" },
    { id: "tbl-analysis", title: "Tabel Hasil Analisis", purpose: "Menyusun temuan atau pembahasan utama secara ringkas.", columns: ["Aspek", "Temuan", "Interpretasi"], status: "planned" },
  ];
}

function buildReferencePlan(project: ReportProject): ReferenceItem[] {
  const topic = project.title || project.topic || "laporan akademik";
  const systemExtra = isSystemProject(project) ? [
    { query: `${topic} system design UML web application journal`, purpose: "Rujukan perancangan sistem dan UML." },
    { query: `${topic} black box testing web application journal`, purpose: "Rujukan metode pengujian aplikasi." },
  ] : [];

  return [
    { id: "ref-main", query: `${topic} jurnal penelitian terbaru`, purpose: "Referensi utama sesuai topik.", status: "planned" },
    { id: "ref-method", query: `${topic} metode penelitian laporan akademik`, purpose: "Dasar metode dan penyusunan laporan.", status: "planned" },
    ...systemExtra.map((item, index) => ({ id: `ref-system-${index + 1}`, ...item, status: "planned" as const })),
  ];
}

function buildOutline(project: ReportProject): ReportSection[] {
  const hasSystemTopic = isSystemProject(project);

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
  const hasSystemTopic = isSystemProject(project);
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
    { label: "Brainstorm judul sudah dibuat", ok: project.titleIdeas.length > 0 },
    { label: "Outline sudah dibuat", ok: project.outline.length > 0 },
    { label: "Sumber/konteks proyek sudah masuk", ok: project.sources.length > 0 },
    { label: "Daftar gambar & UML sudah direncanakan", ok: project.diagrams.length > 0 || project.projectType === "paper" || project.projectType === "practicum" },
    { label: "Tabel laporan sudah direncanakan", ok: project.tables.length > 0 },
    { label: "Query jurnal/referensi sudah disiapkan", ok: project.references.length > 0 },
    { label: "Semua diagram penting sudah approved", ok: project.diagrams.length === 0 || project.diagrams.every((d) => d.status === "approved" && Boolean(d.diagramData)) },
    { label: "Draft laporan lengkap sudah dibuat", ok: Boolean(project.reportDraft?.content) },
    { label: "Gaya sitasi dipilih", ok: Boolean(project.citationStyle) },
  ];
}

export default function ReportBuilderPage() {
  const router = useRouter();
  const [project, setProject] = useState<ReportProject>(defaultProject);
  const [sourceDraft, setSourceDraft] = useState<{ kind: SourceKind; title: string; content: string; fileName?: string }>({ kind: "brief", title: "", content: "" });
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState("");

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
  const doneTableCount = project.tables.filter((table) => table.status === "done").length;
  const savedReferenceCount = project.references.filter((reference) => reference.status === "saved").length;

  const updateProject = <K extends keyof ReportProject>(key: K, value: ReportProject[K]) => {
    setProject((prev) => ({ ...prev, [key]: value }));
  };

  const generatePlan = () => {
    setProject((prev) => {
      const next = { ...prev };
      next.titleIdeas = buildTitleIdeas(prev);
      next.title = prev.title || next.titleIdeas[0] || prev.title;
      next.outline = buildOutline(prev);
      next.diagrams = buildDiagramPlan(prev);
      next.tables = buildTablePlan(prev);
      next.references = buildReferencePlan(prev);
      next.workflowStage = "planned";
      return next;
    });
  };

  const selectTitleIdea = (title: string) => {
    setProject((prev) => ({ ...prev, title }));
  };

  const generateFullReport = async () => {
    setIsGeneratingReport(true);
    setReportError("");

    try {
      const response = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Gagal generate laporan lengkap.");

      setProject((prev) => ({
        ...prev,
        workflowStage: "drafted",
        reportDraft: { content: data.data, generatedAt: new Date().toISOString() },
      }));
    } catch (error: any) {
      setReportError(error.message || "Gagal generate laporan lengkap.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const addSource = () => {
    if (!sourceDraft.title.trim() && !sourceDraft.content.trim()) return;
    setProject((prev) => ({
      ...prev,
      sources: [{ id: makeId("src"), kind: sourceDraft.kind, title: sourceDraft.title || sourceKindLabel[sourceDraft.kind], content: sourceDraft.content, fileName: sourceDraft.fileName }, ...prev.sources],
    }));
    setSourceDraft((prev) => ({ kind: prev.kind, title: "", content: "" }));
  };

  const removeSource = (id: string) => {
    setProject((prev) => ({ ...prev, sources: prev.sources.filter((source) => source.id !== id) }));
  };

  const handleSourceFile = async (file?: File) => {
    if (!file) return;
    const readableTextFile = /\.(txt|md|csv|json|js|jsx|ts|tsx|php|py|java|sql|html|css|xml|yml|yaml)$/i.test(file.name);

    if (readableTextFile && file.size <= 250_000) {
      const text = await file.text();
      setSourceDraft((prev) => ({
        ...prev,
        title: prev.title || file.name,
        content: `${prev.content ? `${prev.content}\n\n` : ""}[File: ${file.name}]\n${text}`,
        fileName: file.name,
      }));
      return;
    }

    setSourceDraft((prev) => ({
      ...prev,
      title: prev.title || file.name,
      content: `${prev.content ? `${prev.content}\n\n` : ""}[Lampiran: ${file.name}]\nFile ini dicatat sebagai konteks. Untuk hasil AI yang akurat, tempel ringkasan isi pentingnya di sini: pedoman, struktur laporan contoh, fitur project, route/API, database, atau poin revisi dosen.`,
      fileName: file.name,
    }));
  };

  const sendToUmlBuilder = (diagram: DiagramPlan) => {
    const sourceSummary = project.sources.slice(0, 3).map((source) => ({
      kind: source.kind || "note",
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
            Pilih bentuk proyek, kumpulkan sumber seperti pedoman dosen/contoh laporan/konteks codingan, lalu sistem membantu brainstorming outline dan daftar gambar/UML sebelum eksekusi diagram satu per satu.
          </p>
        </section>

        <section className="mb-6 grid md:grid-cols-3 gap-3">
          {[
            { step: "1", title: "Kumpulkan konteks", desc: "Brief tugas, pedoman PDF, contoh laporan, referensi, atau ringkasan codingan." },
            { step: "2", title: "Brainstorm struktur", desc: "Sistem menyusun outline, asumsi, dan daftar gambar/UML yang dibutuhkan." },
            { step: "3", title: "Eksekusi & approve", desc: "Buat diagram di UML Builder, cek hasilnya, lalu approve ke laporan." },
          ].map((item) => (
            <div key={item.step} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white">{item.step}</span>
                <p className="font-black text-slate-900">{item.title}</p>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </section>

        <section className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/40 p-5 md:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">Alur Terpadu Laporan</h2>
              <p className="text-sm text-slate-600 mt-1">Satu workspace untuk brainstorming judul, format, gambar/UML, tabel, referensi jurnal, lalu generate draft laporan lengkap.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "intake", label: "Intake" },
                { key: "planned", label: "Rencana" },
                { key: "drafted", label: "Draft" },
              ].map((stage) => {
                const active = project.workflowStage === stage.key;
                return <span key={stage.key} className={`rounded-full px-3 py-1.5 text-xs font-black ${active ? "bg-blue-600 text-white" : "bg-white text-slate-400 border border-blue-100"}`}>{stage.label}</span>;
              })}
            </div>
          </div>

          <div className="mt-5 grid md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white p-4 border border-blue-100"><p className="text-xs font-black uppercase text-slate-400">Sumber</p><p className="text-2xl font-black text-slate-900">{project.sources.length}</p></div>
            <div className="rounded-xl bg-white p-4 border border-blue-100"><p className="text-xs font-black uppercase text-slate-400">Gambar/UML</p><p className="text-2xl font-black text-slate-900">{approvedCount}/{project.diagrams.length}</p></div>
            <div className="rounded-xl bg-white p-4 border border-blue-100"><p className="text-xs font-black uppercase text-slate-400">Tabel</p><p className="text-2xl font-black text-slate-900">{doneTableCount}/{project.tables.length}</p></div>
            <div className="rounded-xl bg-white p-4 border border-blue-100"><p className="text-xs font-black uppercase text-slate-400">Referensi</p><p className="text-2xl font-black text-slate-900">{savedReferenceCount}/{project.references.length}</p></div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <button onClick={generatePlan} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700 transition-colors">
              <Lightbulb className="w-4 h-4" /> Brainstorm Semua Rencana
            </button>
            <button onClick={generateFullReport} disabled={isGeneratingReport || project.outline.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 transition-colors">
              <Sparkles className="w-4 h-4" /> {isGeneratingReport ? "Menyusun Laporan..." : "Generate Laporan Lengkap"}
            </button>
          </div>
          {reportError && <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{reportError}</p>}
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

              {project.titleIdeas.length > 0 && (
                <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                  <p className="mb-3 text-xs font-black uppercase tracking-widest text-blue-700">Ide judul hasil brainstorming</p>
                  <div className="space-y-2">
                    {project.titleIdeas.map((title) => (
                      <button key={title} onClick={() => selectTitleIdea(title)} className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-bold transition-colors ${project.title === title ? "border-blue-500 bg-white text-blue-700" : "border-blue-100 bg-white/70 text-slate-600 hover:border-blue-300"}`}>
                        {title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={generatePlan} className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700 transition-colors">
                <Lightbulb className="w-4 h-4" /> Brainstorm Ulang Semua Rencana
              </button>
            </section>

            <section className="border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><FileCheck2 className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-xl font-black">Sumber & Konteks Proyek</h2>
                  <p className="text-sm text-slate-500">Masukkan pedoman dosen, contoh laporan benar, referensi, brief tugas, atau konteks codingan sebelum brainstorming.</p>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3 mb-4">
                {Object.entries(sourceKindLabel).map(([value, label]) => {
                  const active = sourceDraft.kind === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSourceDraft((prev) => ({ ...prev, kind: value as SourceKind }))}
                      className={`rounded-xl border px-3 py-2.5 text-left text-xs font-black transition-colors ${active ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500 hover:border-amber-200"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-4 mb-4">
                <p className="text-sm font-bold text-amber-900">{sourceKindHint[sourceDraft.kind]}</p>
                <p className="mt-1 text-xs text-amber-700 leading-relaxed">Alur sistem: kumpulkan konteks dulu, klik brainstorm, sistem membuat outline dan daftar gambar/UML yang perlu dibuat. Diagram baru dieksekusi setelah daftar ini disetujui.</p>
              </div>

              <div className="grid md:grid-cols-[0.8fr_1.2fr] gap-3 items-start">
                <div className="space-y-3">
                  <input value={sourceDraft.title} onChange={(e) => setSourceDraft((prev) => ({ ...prev, title: e.target.value }))} placeholder="Judul sumber, contoh: Pedoman Dosen RPL" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-amber-500" />
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-500 hover:border-amber-300 hover:text-amber-700 transition-colors">
                    <Upload className="w-4 h-4" /> Upload / catat file
                    <input type="file" className="hidden" accept=".txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.java,.sql,.html,.css,.xml,.yml,.yaml,.pdf,.docx,.zip" onChange={(e) => handleSourceFile(e.target.files?.[0])} />
                  </label>
                  {sourceDraft.fileName && <p className="text-xs font-bold text-slate-400">File dipilih: {sourceDraft.fileName}</p>}
                </div>
                <textarea value={sourceDraft.content} onChange={(e) => setSourceDraft((prev) => ({ ...prev, content: e.target.value }))} placeholder="Tempel isi penting/ringkasan di sini. Contoh: struktur laporan contoh, aturan format PDF pedoman, daftar fitur aplikasi, struktur folder codingan, route API, schema database, atau catatan revisi dosen..." className="min-h-40 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-amber-500" />
              </div>

              <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500 leading-relaxed">Tips hemat token: masukkan ringkasan yang relevan saja. Untuk ZIP codingan, cukup struktur folder, fitur, route/API, database, dan flow utama.</p>
                <button onClick={addSource} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-amber-600 transition-colors">
                  <Plus className="w-4 h-4" /> Tambah Sumber
                </button>
              </div>

              <div className="mt-4 grid md:grid-cols-2 gap-3">
                {project.sources.length === 0 ? (
                  <div className="md:col-span-2 rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-400 font-semibold">Belum ada sumber. Tambahkan minimal brief tugas, pedoman, contoh laporan, atau ringkasan project codingan supaya hasil brainstorm tidak generik.</div>
                ) : project.sources.map((source) => (
                  <div key={source.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-800">{source.title}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">{sourceKindLabel[source.kind || "note"]}</p>
                      </div>
                      <button onClick={() => removeSource(source.id)} className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="Hapus sumber">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {source.fileName && <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500 border border-slate-200"><FileArchive className="w-3 h-3" /> {source.fileName}</p>}
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
                  <h2 className="text-xl font-black">Daftar Gambar & UML</h2>
                  <p className="text-sm text-slate-500">{approvedCount}/{project.diagrams.length} diagram sudah dieksekusi dan approved.</p>
                </div>
              </div>

              <div className="space-y-3">
                {project.diagrams.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-400 font-semibold">Klik Brainstorm Outline & Daftar Gambar/UML dulu. Setelah itu sistem menampilkan gambar/diagram yang perlu dibuat sebelum masuk penulisan final.</div>
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
                        {diagram.diagramData ? "hasil sudah tersimpan" : "belum dieksekusi"}
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
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 font-semibold">Outline belum dibuat. Isi setup proyek dan sumber/konteks, lalu klik Brainstorm Outline & Daftar Gambar/UML.</div>
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

        <section className="mt-6 grid xl:grid-cols-2 gap-6">
          <div className="border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center"><Table2 className="w-5 h-5" /></div>
              <div>
                <h2 className="text-xl font-black">Rencana Tabel</h2>
                <p className="text-sm text-slate-500">Tabel yang perlu dibuat otomatis masuk konteks draft laporan.</p>
              </div>
            </div>
            {project.tables.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-400 font-semibold">Belum ada rencana tabel. Klik Brainstorm Semua Rencana dulu.</div>
            ) : (
              <div className="space-y-3">
                {project.tables.map((table) => (
                  <div key={table.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-900">{table.title}</p>
                        <p className="text-xs text-slate-500 mt-1">{table.purpose}</p>
                      </div>
                      <select value={table.status} onChange={(e) => setProject((prev) => ({ ...prev, tables: prev.tables.map((item) => item.id === table.id ? { ...item, status: e.target.value as TablePlan["status"] } : item) }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold">
                        <option value="planned">planned</option>
                        <option value="draft">draft</option>
                        <option value="done">done</option>
                      </select>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {table.columns.map((column) => <span key={column} className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-cyan-700 border border-cyan-100">{column}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center"><Search className="w-5 h-5" /></div>
              <div>
                <h2 className="text-xl font-black">Pencarian Jurnal & Referensi</h2>
                <p className="text-sm text-slate-500">Query disiapkan dulu, lalu hasil yang cocok bisa disimpan sebagai konteks.</p>
              </div>
            </div>
            {project.references.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-400 font-semibold">Belum ada query jurnal. Klik Brainstorm Semua Rencana dulu.</div>
            ) : (
              <div className="space-y-3">
                {project.references.map((reference) => (
                  <div key={reference.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="font-black text-slate-900">{reference.query}</p>
                    <p className="mt-1 text-xs text-slate-500">{reference.purpose}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(reference.query)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-black text-white hover:bg-purple-700"><Search className="w-3.5 h-3.5" /> Google Scholar</a>
                      <a href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(reference.query)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-black text-purple-700 border border-purple-100 hover:border-purple-300"><Search className="w-3.5 h-3.5" /> Semantic Scholar</a>
                      <button onClick={() => setProject((prev) => ({ ...prev, references: prev.references.map((item) => item.id === reference.id ? { ...item, status: item.status === "saved" ? "planned" : "saved" } : item) }))} className={`rounded-lg px-3 py-2 text-xs font-black border ${reference.status === "saved" ? "bg-green-50 text-green-700 border-green-100" : "bg-white text-slate-500 border-slate-200"}`}>{reference.status === "saved" ? "Tersimpan" : "Tandai cocok"}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center"><Sparkles className="w-5 h-5" /></div>
              <div>
                <h2 className="text-xl font-black">Draft Laporan Lengkap</h2>
                <p className="text-sm text-slate-500">Hasil akhir disusun dari konteks, outline, tabel, daftar UML, dan referensi yang sudah disimpan.</p>
              </div>
            </div>
            <button onClick={generateFullReport} disabled={isGeneratingReport || project.outline.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">
              <Sparkles className="w-4 h-4" /> {project.reportDraft ? "Generate Ulang" : "Generate Laporan"}
            </button>
          </div>
          {!project.reportDraft ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 font-semibold">Belum ada draft lengkap. Jalankan brainstorm, lengkapi konteks penting, lalu klik Generate Laporan Lengkap.</div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Generated {new Date(project.reportDraft.generatedAt).toLocaleString("id-ID")}</p>
                <button onClick={() => navigator.clipboard.writeText(project.reportDraft?.content || "")} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-600 border border-slate-200 hover:border-blue-300">Copy Draft</button>
              </div>
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 text-sm leading-relaxed text-slate-700 border border-slate-100">{project.reportDraft.content}</pre>
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

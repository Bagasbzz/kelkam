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
  Loader2,
  ExternalLink,
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
type StartMode = "need_title" | "has_title" | "has_material";
type SectionStatus = "draft" | "review" | "approved";
type DiagramStatus = "planned" | "draft" | "approved";
type SourceKind = "brief" | "guide" | "example" | "reference" | "code" | "note";
type WorkflowStage = "intake" | "planned" | "drafted";
type BuilderStep = "setup" | "context" | "plan" | "execute" | "draft";

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
  abstract?: string;
  pdfUrl?: string | null;
  results?: ReferenceResult[];
}

interface ReferenceResult {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract: string;
  url?: string;
  pdfUrl?: string | null;
  doi?: string | null;
  citationCount: number;
  isOpenAccess: boolean;
  citationApa: string;
}

interface ReportDraft {
  content: string;
  generatedAt: string;
  revisedAt?: string;
}

interface ReportProject {
  startMode: StartMode;
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

type RevisionMode = "format" | "expand" | "citation" | "table" | "bibliography" | "diagram" | "custom";

const STORAGE_KEY = "report_builder_project_v1";

const projectTypeLabel: Record<ProjectType, string> = {
  capstone: "Capstone / Projek Akhir",
  course: "Tugas Mata Kuliah",
  practicum: "Laporan Praktikum",
  paper: "Makalah Biasa",
  formal: "Laporan Projek Formal",
  thesis: "Skripsi / Proposal",
};

const startModeLabel: Record<StartMode, { title: string; helper: string }> = {
  need_title: { title: "Saya belum punya judul", helper: "AI bantu cari judul dari topik, file, dan kebutuhan tugas." },
  has_title: { title: "Saya sudah punya judul", helper: "Judul dipakai sebagai jangkar outline, tabel, UML, dan referensi." },
  has_material: { title: "Saya punya bahan/file contoh", helper: "Mulai dari pedoman, laporan lama, atau ZIP project codingan." },
};

const revisionModeLabel: Record<RevisionMode, string> = {
  format: "Rapikan format",
  expand: "Tambah isi",
  citation: "Tambah sitasi",
  table: "Tambah tabel",
  bibliography: "Rapikan daftar pustaka",
  diagram: "Masukkan diagram",
  custom: "Instruksi bebas",
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
  startMode: "need_title",
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

const builderSteps: { id: BuilderStep; label: string; helper: string }[] = [
  { id: "setup", label: "Setup", helper: "Judul, jenis laporan, format" },
  { id: "context", label: "Konteks", helper: "Pedoman, contoh, codingan" },
  { id: "plan", label: "Rencana", helper: "Outline, tabel, referensi" },
  { id: "execute", label: "Eksekusi", helper: "Buat dan approve UML" },
  { id: "draft", label: "Draft", helper: "Generate laporan lengkap" },
];

const loadingSteps = [
  "Membaca konteks proyek",
  "Menyusun struktur laporan",
  "Menyisipkan tabel dan placeholder gambar",
  "Merangkai referensi dan daftar pustaka",
  "Merapikan draft final",
];

const revisionSteps = [
  "Membaca draft dan konteks",
  "Mengecek instruksi revisi",
  "Memperbaiki bagian terkait",
  "Menjaga sitasi, tabel, dan placeholder gambar",
  "Merapikan hasil revisi",
];

const sectionStatusLabel: Record<SectionStatus, string> = {
  draft: "Perlu dicek",
  review: "Sedang dicek",
  approved: "Sudah oke",
};

const diagramStatusLabel: Record<DiagramStatus, string> = {
  planned: "Belum dibuat",
  draft: "Sedang dibuat",
  approved: "Sudah oke",
};

const tableStatusLabel: Record<TablePlan["status"], string> = {
  planned: "Belum dibuat",
  draft: "Sedang dibuat",
  done: "Sudah oke",
};

const getProjectContext = (project: ReportProject) => `${project.title} ${project.topic} ${project.course} ${project.sources.map((source) => `${source.kind || "note"} ${source.title} ${source.content}`).join(" ")}`;

const isSystemProject = (project: ReportProject) => /sistem|aplikasi|website|web|mobile|absensi|kasir|penjualan|rekomendasi|database|login|admin|user|dashboard|api|route|controller|model|schema|mysql|postgres|supabase/i.test(getProjectContext(project));

function plannerMessage(project: ReportProject, activeStep: BuilderStep) {
  if (activeStep === "setup") {
    if (project.startMode === "need_title") return "Mulai dari ide kasar dulu. Isi topik/kebutuhan dosen seadanya, lalu klik Brainstorm supaya sistem kasih pilihan judul, outline, tabel, UML, dan referensi awal.";
    if (project.startMode === "has_material") return "Upload atau tempel bahan dulu di langkah Konteks. Bahan seperti contoh laporan, pedoman dosen, atau ZIP codingan akan jadi dasar rencana laporan.";
    return "Isi judul sementara dan topik singkat. Setelah itu sistem bisa menurunkan struktur BAB, daftar gambar, tabel, dan query jurnal yang lebih pas.";
  }

  if (activeStep === "context") {
    return project.sources.length > 0
      ? `Sudah ada ${project.sources.length} sumber. Kalau sumber utama sudah masuk, lanjut Brainstorm supaya daftar BAB, diagram, tabel, dan referensi tersusun.`
      : "Masukkan minimal satu bahan utama: brief tugas, pedoman PDF/DOCX, contoh laporan benar, ZIP project codingan, atau catatan revisi dosen.";
  }

  if (activeStep === "plan") {
    return project.outline.length > 0
      ? "Cek rencana dulu. Kalau judul, outline, tabel, dan referensi sudah masuk akal, lanjut eksekusi UML/gambar yang dibutuhkan."
      : "Rencana belum ada. Jalankan Brainstorm dari konteks agar sistem menyusun daftar kerja sebelum generate laporan.";
  }

  if (activeStep === "execute") {
    return project.diagrams.length > 0
      ? `Ada ${project.diagrams.length} diagram/gambar yang direncanakan. Buat yang wajib dulu, approve, lalu masuk ke draft final.`
      : "Untuk laporan non-sistem, diagram bisa kosong. Kalau butuh gambar khusus, tambahkan konteksnya lalu brainstorm ulang.";
  }

  return project.reportDraft?.content
    ? "Draft sudah ada. Sekarang bisa copy, generate ulang, atau revisi bagian tertentu tanpa mengulang semua dari nol."
    : "Generate laporan baru setelah sumber, outline, tabel, referensi, dan diagram yang wajib sudah siap.";
}

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
    { id: "bab3", title: "BAB 3 Analisis dan Perancangan", purpose: "Analisis kebutuhan, aktor, proses bisnis, rancangan UML, database, dan UI.", requiredDiagrams: hasSystemTopic ? ["usecase-main", "activity-login", "sequence-login", "activity-manage", "flow-main"] : ["flow-main"], status: "draft" },
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
      id: "sequence-login",
      title: "Sequence Diagram Login",
      type: "sequence",
      purpose: "Menjelaskan interaksi pengguna, halaman login, service autentikasi, dan database secara berurutan.",
      prompt: `Buat sequence diagram login untuk ${topic}. Sertakan partisipan Pengguna, Halaman Login, Auth Service/Controller, dan Database. Alurnya: input kredensial, validasi, cek database, hasil validasi, buat sesi atau pesan gagal, lalu tampilkan dashboard sesuai role.`,
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
    { label: "Semua diagram penting sudah oke", ok: project.diagrams.length === 0 || project.diagrams.every((d) => d.status === "approved" && Boolean(d.diagramData)) },
    { label: "Draft laporan lengkap sudah dibuat", ok: Boolean(project.reportDraft?.content) },
    { label: "Gaya sitasi dipilih", ok: Boolean(project.citationStyle) },
  ];
}

export default function ReportBuilderPage() {
  const router = useRouter();
  const [project, setProject] = useState<ReportProject>(defaultProject);
  const [sourceDraft, setSourceDraft] = useState<{ kind: SourceKind; title: string; content: string; fileName?: string }>({ kind: "brief", title: "", content: "" });
  const [activeStep, setActiveStep] = useState<BuilderStep>("setup");
  const [isExtractingSource, setIsExtractingSource] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationLabel, setGenerationLabel] = useState("Menunggu perintah");
  const [reportError, setReportError] = useState("");
  const [searchingReferenceId, setSearchingReferenceId] = useState<string | null>(null);
  const [revisionMode, setRevisionMode] = useState<RevisionMode>("format");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [revisionTarget, setRevisionTarget] = useState("");
  const [isRevisingReport, setIsRevisingReport] = useState(false);
  const [revisionProgress, setRevisionProgress] = useState(0);
  const [revisionLabel, setRevisionLabel] = useState("Menunggu instruksi revisi");

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

  useEffect(() => {
    if (!isGeneratingReport) return;

    setGenerationProgress(8);
    setGenerationLabel(loadingSteps[0]);

    const timer = window.setInterval(() => {
      setGenerationProgress((prev) => {
        const next = Math.min(prev + Math.max(2, Math.round((95 - prev) / 8)), 95);
        const labelIndex = Math.min(Math.floor(next / 20), loadingSteps.length - 1);
        setGenerationLabel(loadingSteps[labelIndex]);
        return next;
      });
    }, 900);

    return () => window.clearInterval(timer);
  }, [isGeneratingReport]);

  useEffect(() => {
    if (!isRevisingReport) return;

    setRevisionProgress(10);
    setRevisionLabel(revisionSteps[0]);

    const timer = window.setInterval(() => {
      setRevisionProgress((prev) => {
        const next = Math.min(prev + Math.max(3, Math.round((94 - prev) / 7)), 94);
        const labelIndex = Math.min(Math.floor(next / 20), revisionSteps.length - 1);
        setRevisionLabel(revisionSteps[labelIndex]);
        return next;
      });
    }, 800);

    return () => window.clearInterval(timer);
  }, [isRevisingReport]);

  const checks = useMemo(() => qualityChecks(project), [project]);
  const assistantMessage = useMemo(() => plannerMessage(project, activeStep), [project, activeStep]);
  const approvedCount = project.diagrams.filter((d) => d.status === "approved" && d.diagramData).length;
  const doneTableCount = project.tables.filter((table) => table.status === "done").length;
  const savedReferenceCount = project.references.filter((reference) => reference.status === "saved").length;

  const updateProject = <K extends keyof ReportProject>(key: K, value: ReportProject[K]) => {
    setProject((prev) => ({ ...prev, [key]: value }));
  };

  const generatePlan = () => {
    setReportError("");
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
    setActiveStep("plan");
  };

  const selectTitleIdea = (title: string) => {
    setProject((prev) => ({ ...prev, title }));
  };

  const generateFullReport = async () => {
    if (!project.title.trim() && !project.topic.trim()) {
      setReportError("Isi judul atau topik dulu sebelum generate laporan.");
      setActiveStep("setup");
      return;
    }

    if (project.sources.length === 0) {
      setReportError("Tambahkan minimal 1 sumber/konteks dulu, misalnya brief tugas, pedoman dosen, contoh laporan, atau ringkasan project codingan.");
      setActiveStep("context");
      return;
    }

    if (project.outline.length === 0) {
      setReportError("Jalankan Brainstorm rencana dulu supaya outline, tabel, referensi, dan kebutuhan gambar tersusun.");
      setActiveStep("context");
      return;
    }

    setIsGeneratingReport(true);
    setGenerationProgress(2);
    setGenerationLabel("Memulai job generate laporan");
    setReportError("");

    try {
      const startResponse = await fetch("/api/report-jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });

      const startData = await startResponse.json().catch(() => null);
      if (!startResponse.ok || !startData?.success || !startData.job?.id) {
        throw new Error(startData?.error || "Gagal memulai job laporan.");
      }

      const jobId = startData.job.id;
      setGenerationProgress(startData.job.progress || 5);
      setGenerationLabel(startData.job.stage || "Job laporan dimulai");

      let finalJob: any = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const statusResponse = await fetch(`/api/report-jobs/status/${jobId}`, { cache: "no-store" });
        const statusData = await statusResponse.json().catch(() => null);

        if (!statusResponse.ok || !statusData?.success) {
          throw new Error(statusData?.error || "Gagal membaca progres generate laporan.");
        }

        const job = statusData.job;
        setGenerationProgress(Math.min(100, Math.max(0, Number(job.progress || 0))));
        setGenerationLabel(job.stage || "Generate laporan berjalan");

        if (job.status === "done" || job.status === "failed") {
          finalJob = job;
          break;
        }
      }

      if (!finalJob) throw new Error("Generate laporan terlalu lama. Coba cek lagi beberapa saat atau ulangi job.");
      if (finalJob.status === "failed") throw new Error(finalJob.error || "Generate laporan gagal.");

      setProject((prev) => ({
        ...prev,
        workflowStage: "drafted",
        reportDraft: { content: finalJob.result || "", generatedAt: new Date().toISOString() },
      }));
      setGenerationProgress(100);
      setGenerationLabel(finalJob.stage || "Laporan selesai disusun");
      setActiveStep("draft");
    } catch (error: any) {
      setReportError(error.message || "Gagal generate laporan lengkap.");
    } finally {
      window.setTimeout(() => setIsGeneratingReport(false), 500);
    }
  };

  const reviseReport = async () => {
    if (!project.reportDraft?.content) {
      setReportError("Belum ada draft yang bisa direvisi. Generate laporan dulu atau tempel laporan lama sebagai konteks, lalu generate draft awal.");
      return;
    }

    setIsRevisingReport(true);
    setRevisionProgress(10);
    setRevisionLabel(revisionSteps[0]);
    setReportError("");

    try {
      const response = await fetch("/api/ai/revise-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          draft: project.reportDraft.content,
          revisionMode,
          targetSection: revisionTarget,
          instruction: revisionInstruction,
        }),
      });

      const rawResponse = await response.text();
      let data: any = null;
      try {
        data = rawResponse ? JSON.parse(rawResponse) : null;
      } catch {
        const cleanText = rawResponse.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(cleanText || "Server mengembalikan respons revisi tidak valid.");
      }

      if (!response.ok || !data.success) throw new Error(data.error || "Gagal merevisi laporan.");

      setProject((prev) => ({
        ...prev,
        reportDraft: {
          content: data.data,
          generatedAt: prev.reportDraft?.generatedAt || new Date().toISOString(),
          revisedAt: new Date().toISOString(),
        },
      }));
      setRevisionProgress(100);
      setRevisionLabel("Revisi selesai dirapikan");
    } catch (error: any) {
      setReportError(error.message || "Gagal merevisi laporan.");
    } finally {
      window.setTimeout(() => setIsRevisingReport(false), 500);
    }
  };

  const addSource = () => {
    if (!sourceDraft.title.trim() && !sourceDraft.content.trim()) return;
    setReportError("");
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
    setIsExtractingSource(true);
    setSourceError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/context/extract", {
        method: "POST",
        body: formData,
      });

      const raw = await response.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "Gagal membaca file.");
      }

      if (!response.ok || !data.success) throw new Error(data.error || "Gagal membaca file.");

      setSourceDraft((prev) => ({
        ...prev,
        kind: (data.data.kind || prev.kind) as SourceKind,
        title: prev.title || data.data.title || file.name,
        content: `${prev.content ? `${prev.content}\n\n` : ""}${data.data.content}`,
        fileName: data.data.fileName || file.name,
      }));
      setReportError("");
    } catch (error: any) {
      setSourceError(error.message || "Gagal membaca file konteks.");
    } finally {
      setIsExtractingSource(false);
    }
  };

  const searchReferences = async (reference: ReferenceItem) => {
    setSearchingReferenceId(reference.id);
    setReportError("");

    try {
      const response = await fetch("/api/references/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: reference.query, limit: 5 }),
      });
      const raw = await response.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "Gagal mencari referensi.");
      }

      if (!response.ok || !data.success) throw new Error(data.error || "Gagal mencari referensi.");

      setProject((prev) => ({
        ...prev,
        references: prev.references.map((item) => item.id === reference.id ? { ...item, results: data.data } : item),
      }));
    } catch (error: any) {
      setReportError(error.message || "Gagal mencari referensi.");
    } finally {
      setSearchingReferenceId(null);
    }
  };

  const saveReferenceResult = (referenceId: string, result: ReferenceResult) => {
    setProject((prev) => ({
      ...prev,
      references: prev.references.map((item) => item.id === referenceId ? {
        ...item,
        status: "saved",
        citation: result.citationApa,
        url: result.url,
        pdfUrl: result.pdfUrl,
        abstract: result.abstract,
      } : item),
      sources: [{
        id: makeId("ref"),
        kind: "reference",
        title: result.title,
        fileName: result.pdfUrl || result.url,
        content: `[Referensi tersimpan]\nSitasi: ${result.citationApa}\nLink: ${result.url || "-"}\nPDF: ${result.pdfUrl || "-"}\nDOI: ${result.doi || "-"}\nAbstrak:\n${result.abstract}`,
      }, ...prev.sources],
    }));
    setReportError("");
  };

  const sendToUmlBuilder = (diagram: DiagramPlan) => {
    const sourceSummary = project.sources.slice(0, 3).map((source) => ({
      kind: source.kind || "note",
      title: source.title,
      preview: source.content.slice(0, 500),
    }));

    localStorage.setItem("uml-ai-prefill", JSON.stringify({
      prompt: diagram.prompt,
      diagramType: ["flowchart", "activity", "usecase", "sequence"].includes(diagram.type) ? diagram.type : "flowchart",
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

        <section className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/40 p-5 md:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">Alur Terpadu Laporan</h2>
              <p className="text-sm text-slate-600 mt-1">Ikuti langkah dari kiri ke kanan. Panel di bawah cuma menampilkan langkah yang sedang aktif.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 md:grid-cols-5">
            {builderSteps.map((step, index) => {
              const active = activeStep === step.id;
              const done =
                (step.id === "setup" && Boolean(project.title || project.topic)) ||
                (step.id === "context" && project.sources.length > 0) ||
                (step.id === "plan" && project.outline.length > 0) ||
                (step.id === "execute" && (project.diagrams.length === 0 || approvedCount > 0)) ||
                (step.id === "draft" && Boolean(project.reportDraft));
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${active ? "border-blue-500 bg-white shadow-sm" : "border-blue-100 bg-white/70 hover:border-blue-300"}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black ${done ? "bg-green-500 text-white" : active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}>{done ? "OK" : index + 1}</span>
                    {active && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">AKTIF</span>}
                  </div>
                  <p className="font-black text-slate-900">{step.label}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500 leading-snug">{step.helper}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-xl border border-blue-100 bg-white p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Langkah sekarang</p>
                <p className="text-lg font-black text-slate-900">{builderSteps.find((step) => step.id === activeStep)?.label}</p>
                <p className="text-sm text-slate-500">{builderSteps.find((step) => step.id === activeStep)?.helper}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeStep === "setup" && <button onClick={() => setActiveStep("context")} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">Lanjut isi konteks</button>}
                {activeStep === "context" && <button onClick={generatePlan} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white"><Lightbulb className="w-4 h-4" /> Brainstorm rencana</button>}
                {activeStep === "plan" && <button onClick={() => setActiveStep("execute")} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">Lanjut eksekusi UML</button>}
                {activeStep === "execute" && <button onClick={() => setActiveStep("draft")} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">Lanjut ke draft</button>}
                {activeStep === "draft" && <button onClick={generateFullReport} disabled={isGeneratingReport || project.outline.length === 0 || project.sources.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-40"><Sparkles className="w-4 h-4" /> {project.sources.length === 0 ? "Isi konteks dulu" : "Generate laporan"}</button>}
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-blue-700">AI Planner</p>
              <p className="text-sm font-semibold leading-relaxed text-slate-700">{assistantMessage}</p>
            </div>
            {isGeneratingReport && (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="mb-2 flex items-center justify-between text-xs font-black text-blue-800">
                  <span>{generationLabel}</span>
                  <span>{generationProgress}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 transition-all duration-700" style={{ width: `${generationProgress}%` }} />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-5">
                  {loadingSteps.map((label, index) => {
                    const done = generationProgress >= (index + 1) * 20;
                    return <div key={label} className={`rounded-lg px-2 py-2 text-[10px] font-black ${done ? "bg-white text-blue-700" : "bg-blue-100/60 text-blue-400"}`}>{label}</div>;
                  })}
                </div>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Sumber</p><p className="text-lg font-black">{project.sources.length}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">UML</p><p className="text-lg font-black">{approvedCount}/{project.diagrams.length}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Tabel</p><p className="text-lg font-black">{doneTableCount}/{project.tables.length}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Referensi</p><p className="text-lg font-black">{savedReferenceCount}/{project.references.length}</p></div>
            </div>
          </div>
          {reportError && <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{reportError}</p>}
        </section>

        <div className="grid gap-6 items-start">
          <div className="space-y-6">
            <section className={`${activeStep === "setup" ? "" : "hidden"} border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm`}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><ClipboardList className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-xl font-black">Setup Proyek</h2>
                  <p className="text-sm text-slate-500">Tentukan konteks dulu supaya output tidak generik.</p>
                </div>
              </div>

              <div className="mb-5 grid gap-3 md:grid-cols-3">
                {(Object.entries(startModeLabel) as [StartMode, { title: string; helper: string }][]).map(([value, item]) => {
                  const active = project.startMode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateProject("startMode", value)}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${active ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}
                    >
                      <p className="text-sm font-black">{item.title}</p>
                      <p className="mt-1 text-xs font-semibold leading-relaxed opacity-80">{item.helper}</p>
                    </button>
                  );
                })}
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

            <section className={`${activeStep === "context" ? "" : "hidden"} border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm`}>
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
                    {isExtractingSource ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {isExtractingSource ? "Membaca file..." : "Upload & baca konteks"}
                    <input type="file" className="hidden" disabled={isExtractingSource} accept=".txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.java,.sql,.html,.css,.xml,.yml,.yaml,.pdf,.docx,.zip" onChange={(e) => handleSourceFile(e.target.files?.[0])} />
                  </label>
                  {sourceDraft.fileName && <p className="text-xs font-bold text-slate-400">File dipilih: {sourceDraft.fileName}</p>}
                  {sourceError && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{sourceError}</p>}
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
            <section className={`${activeStep === "plan" ? "" : "hidden"} border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm`}>
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

            <section className={`${activeStep === "execute" ? "" : "hidden"} border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm`}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><GitBranch className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-xl font-black">Daftar Gambar & UML</h2>
                  <p className="text-sm text-slate-500">{approvedCount}/{project.diagrams.length} diagram sudah dibuat dan disetujui.</p>
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
                        <option value="planned">Belum dibuat</option>
                        <option value="draft">Sedang dibuat</option>
                        <option value="approved" disabled={!diagram.diagramData}>Sudah oke</option>
                      </select>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${diagram.diagramData ? "bg-green-100 text-green-700" : "bg-white text-slate-400 border border-slate-200"}`}>
                        {diagram.diagramData ? "hasil sudah tersimpan" : "belum dieksekusi"}
                      </span>
                      {diagram.approvedAt && <span className="text-[10px] font-bold text-slate-400">Approved {new Date(diagram.approvedAt).toLocaleDateString("id-ID")}</span>}
                      <span className="text-[10px] font-bold text-slate-400">{diagramStatusLabel[diagram.status]}</span>
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

        <section className={`${activeStep === "plan" ? "" : "hidden"} mt-6 border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm`}>
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
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{sectionStatusLabel[section.status]}</span>
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

        <section className={`${activeStep === "plan" ? "" : "hidden"} mt-6 grid xl:grid-cols-2 gap-6`}>
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
                        <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-cyan-600">{tableStatusLabel[table.status]}</p>
                      </div>
                      <select value={table.status} onChange={(e) => setProject((prev) => ({ ...prev, tables: prev.tables.map((item) => item.id === table.id ? { ...item, status: e.target.value as TablePlan["status"] } : item) }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold">
                        <option value="planned">Belum dibuat</option>
                        <option value="draft">Sedang dibuat</option>
                        <option value="done">Sudah oke</option>
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
                      <button onClick={() => searchReferences(reference)} disabled={searchingReferenceId === reference.id} className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-black text-white hover:bg-purple-700 disabled:opacity-50">
                        {searchingReferenceId === reference.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Cari & baca abstrak
                      </button>
                      <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(reference.query)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-black text-white hover:bg-purple-700"><Search className="w-3.5 h-3.5" /> Google Scholar</a>
                      <a href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(reference.query)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-black text-purple-700 border border-purple-100 hover:border-purple-300"><Search className="w-3.5 h-3.5" /> Semantic Scholar</a>
                      <button onClick={() => setProject((prev) => ({ ...prev, references: prev.references.map((item) => item.id === reference.id ? { ...item, status: item.status === "saved" ? "planned" : "saved" } : item) }))} className={`rounded-lg px-3 py-2 text-xs font-black border ${reference.status === "saved" ? "bg-green-50 text-green-700 border-green-100" : "bg-white text-slate-500 border-slate-200"}`}>{reference.status === "saved" ? "Tersimpan" : "Tandai cocok"}</button>
                    </div>
                    {reference.results && reference.results.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {reference.results.map((result) => (
                          <div key={result.id} className="rounded-xl border border-purple-100 bg-white p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="font-black text-slate-900 leading-snug">{result.title}</p>
                                <p className="mt-1 text-xs font-bold text-slate-500">{result.authors.slice(0, 4).join(", ") || "Penulis tidak tersedia"} {result.year ? `(${result.year})` : ""} {result.venue ? `- ${result.venue}` : ""}</p>
                                <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-slate-500">{result.abstract}</p>
                                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-purple-600">{result.citationCount} sitasi {result.isOpenAccess ? "- open access" : ""}</p>
                              </div>
                              <button onClick={() => saveReferenceResult(reference.id, result)} className="shrink-0 rounded-lg bg-green-600 px-3 py-2 text-xs font-black text-white hover:bg-green-700">Simpan ke konteks</button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {result.url && <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:border-purple-300"><ExternalLink className="w-3.5 h-3.5" /> Halaman paper</a>}
                              {result.pdfUrl && <a href={result.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-black text-green-700 hover:border-green-300"><ExternalLink className="w-3.5 h-3.5" /> PDF / download</a>}
                              {result.doi && <a href={`https://doi.org/${result.doi}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:border-purple-300"><ExternalLink className="w-3.5 h-3.5" /> DOI</a>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={`${activeStep === "draft" ? "" : "hidden"} mt-6 border border-slate-200 rounded-2xl bg-white p-5 md:p-6 shadow-sm`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center"><Sparkles className="w-5 h-5" /></div>
              <div>
                <h2 className="text-xl font-black">Draft Laporan Lengkap</h2>
                <p className="text-sm text-slate-500">Hasil akhir disusun dari konteks, outline, tabel, daftar UML, dan referensi yang sudah disimpan.</p>
              </div>
            </div>
            <button onClick={generateFullReport} disabled={isGeneratingReport || project.outline.length === 0 || project.sources.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">
              <Sparkles className="w-4 h-4" /> {project.sources.length === 0 ? "Isi konteks dulu" : project.reportDraft ? "Generate Ulang" : "Generate Laporan"}
            </button>
          </div>
          {!project.reportDraft ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400 font-semibold">Belum ada draft lengkap. Jalankan brainstorm, lengkapi konteks penting, lalu klik Generate Laporan Lengkap.</div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Revisi cepat</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(revisionModeLabel) as [RevisionMode, string][]).map(([value, label]) => {
                    const active = revisionMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRevisionMode(value)}
                        className={`rounded-lg border px-3 py-2 text-left text-xs font-black transition-colors ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <input value={revisionTarget} onChange={(e) => setRevisionTarget(e.target.value)} placeholder="Target bagian, contoh: BAB 1 / Landasan Teori / Daftar Pustaka" className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-slate-500" />
                <textarea value={revisionInstruction} onChange={(e) => setRevisionInstruction(e.target.value)} placeholder="Instruksi tambahan. Contoh: tambahkan 2 paragraf latar belakang, pakai sitasi dari referensi tersimpan, buat tabel kebutuhan fungsional, atau masukkan Activity Diagram Login ke BAB 3." className="mt-3 min-h-28 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-500" />
                <button onClick={reviseReport} disabled={isRevisingReport} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
                  {isRevisingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />} Terapkan Revisi
                </button>
                {isRevisingReport && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-2 flex items-center justify-between text-xs font-black text-slate-700">
                      <span>{revisionLabel}</span>
                      <span>{revisionProgress}%</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-slate-900 via-blue-500 to-emerald-500 transition-all duration-700" style={{ width: `${revisionProgress}%` }} />
                    </div>
                  </div>
                )}
                <p className="mt-3 text-xs leading-relaxed text-slate-500">Revisi memakai draft sekarang, outline, daftar tabel, referensi tersimpan, dan konteks proyek. Jadi user bisa rapihin laporan lama tanpa generate ulang total.</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Generated {new Date(project.reportDraft.generatedAt).toLocaleString("id-ID")}</p>
                    {project.reportDraft.revisedAt && <p className="mt-1 text-xs font-bold text-green-600">Revisi terakhir {new Date(project.reportDraft.revisedAt).toLocaleString("id-ID")}</p>}
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(project.reportDraft?.content || "")} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-600 border border-slate-200 hover:border-blue-300">Copy Draft</button>
                </div>
                <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 text-sm leading-relaxed text-slate-700 border border-slate-100">{project.reportDraft.content}</pre>
              </div>
            </div>
          )}
        </section>

        <section className="hidden mt-6 grid md:grid-cols-3 gap-4">
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

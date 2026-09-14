"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpenCheck,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  FileCheck2,
  FileText,
  GitBranch,
  History,
  Layers3,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  Workflow,
  XCircle,
} from "lucide-react";
import { authenticatedFetch } from "@/components/AuthProvider";
import {
  addStudioDecision,
  addStudioQuestion,
  addStudioSource,
  advanceArtifact,
  answerStudioQuestion,
  artifactDependencyProblems,
  createStudioProject,
  mergeAiQuestions,
  removeStudioSource,
  setDecisionStatus,
  specificationAsMarkdown,
  updateFormatProfile,
  updateStudioIntake,
  waiveStudioQuestion,
  type DecisionStatus,
  type FormatProfile,
  type QuestionCategory,
  type QuestionClass,
  type SourceAuthority,
  type SourceKind,
  type StudioArtifact,
  type StudioDecision,
  type StudioIntake,
  type StudioProject,
  type StudioQuestion,
  type StudioWorkspace,
} from "@/lib/studio/engine";
import {
  createStudioWorkspace,
  duplicateStudioProject,
  loadStudioWorkspace,
  saveStudioWorkspace,
} from "@/lib/studio/project-store";

type StudioTab = "intake" | "questions" | "decisions" | "specification" | "artifacts" | "format";
type SaveState = "loading" | "saved" | "saving" | "error";

const tabs: Array<{ id: StudioTab; label: string; helper: string; icon: typeof FileText }> = [
  { id: "intake", label: "Intake & Sumber", helper: "Konteks mentah", icon: Layers3 },
  { id: "questions", label: "Question Engine", helper: "Tutup celah", icon: BrainCircuit },
  { id: "decisions", label: "Decision Ledger", helper: "Kunci fakta", icon: History },
  { id: "specification", label: "Specification", helper: "Sumber tunggal", icon: ClipboardCheck },
  { id: "artifacts", label: "Artefak & UML", helper: "Bangun berurutan", icon: Workflow },
  { id: "format", label: "Format Preflight", helper: "Anti revisi", icon: FileCheck2 },
];

const projectTypeOptions: Array<{ value: StudioIntake["projectType"]; label: string }> = [
  { value: "thesis", label: "Skripsi / Tesis" },
  { value: "proposal", label: "Proposal" },
  { value: "capstone", label: "Capstone / Projek Akhir" },
  { value: "course", label: "Tugas Mata Kuliah" },
  { value: "practicum", label: "Laporan Praktikum" },
  { value: "paper", label: "Makalah" },
  { value: "formal", label: "Laporan Formal" },
];

const sourceKindOptions: Array<{ value: SourceKind; label: string }> = [
  { value: "lecturer_request", label: "Permintaan / revisi dosen" },
  { value: "campus_guide", label: "Pedoman kampus" },
  { value: "template", label: "Template resmi" },
  { value: "brief", label: "Brief / rubrik tugas" },
  { value: "example", label: "Contoh laporan" },
  { value: "code", label: "Kode / repository" },
  { value: "dataset", label: "Dataset" },
  { value: "reference", label: "Referensi ilmiah" },
  { value: "note", label: "Catatan mentah" },
];

const authorityOptions: Array<{ value: SourceAuthority; label: string; helper: string }> = [
  { value: "binding", label: "Mengikat", helper: "Wajib mengalahkan sumber lain" },
  { value: "primary", label: "Utama", helper: "Fakta inti proyek" },
  { value: "supporting", label: "Pendukung", helper: "Melengkapi keputusan" },
  { value: "example_only", label: "Contoh saja", helper: "Pola, bukan fakta" },
  { value: "unverified", label: "Belum terverifikasi", helper: "Perlu dikonfirmasi" },
];

const categoryLabels: Record<QuestionCategory, string> = {
  identity: "Identitas",
  scope: "Cakupan",
  actors: "Aktor",
  requirements: "Kebutuhan",
  flow: "Alur",
  exceptions: "Exception",
  data: "Data",
  method: "Metode",
  format: "Format",
  citation: "Sitasi",
  lecturer: "Dosen",
  conflict: "Konflik",
};

const decisionStatusLabel: Record<DecisionStatus, string> = {
  suggested: "Saran",
  draft: "Draft",
  confirmed: "Terkonfirmasi",
  locked: "Terkunci",
  superseded: "Digantikan",
  rejected: "Ditolak",
};

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 placeholder:text-slate-300";
const labelClass = "mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-400";
const cardClass = "rounded-3xl border border-slate-200 bg-white shadow-sm";

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet" }) {
  const colors = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-100 text-blue-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    violet: "bg-violet-100 text-violet-700",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${colors[tone]}`}>{children}</span>;
}

function SectionTitle({ icon: Icon, eyebrow, title, helper }: { icon: typeof FileText; eyebrow: string; title: string; helper: string }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Icon className="h-6 w-6" /></div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm font-medium leading-relaxed text-slate-500">{helper}</p>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm font-semibold text-slate-400">{children}</div>;
}

export default function StudioPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<StudioWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>("intake");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [showResolvedQuestions, setShowResolvedQuestions] = useState(false);
  const [deepScanning, setDeepScanning] = useState(false);
  const [deepFindings, setDeepFindings] = useState<string[]>([]);
  const [extractingFile, setExtractingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceDraft, setSourceDraft] = useState<{
    kind: SourceKind;
    authority: SourceAuthority;
    title: string;
    content: string;
    provenance: string;
    fileName?: string;
  }>({ kind: "lecturer_request", authority: "binding", title: "", content: "", provenance: "" });
  const [manualQuestion, setManualQuestion] = useState<{ prompt: string; category: QuestionCategory; class: QuestionClass }>({
    prompt: "",
    category: "conflict",
    class: "important",
  });
  const [manualDecision, setManualDecision] = useState<{ statement: string; value: string; category: QuestionCategory }>({
    statement: "",
    value: "",
    category: "requirements",
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadStudioWorkspace(window.localStorage);
      setWorkspace(loaded);
      setSaveState("saved");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!workspace || saveState === "loading") return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      try {
        saveStudioWorkspace(window.localStorage, workspace);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 300);
    return () => window.clearTimeout(timer);
    // saveState is deliberately not a dependency to avoid a save-status loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  const project = useMemo(
    () => workspace?.projects.find((item) => item.id === workspace.activeProjectId) || workspace?.projects[0] || null,
    [workspace],
  );

  const replaceActiveProject = useCallback((next: StudioProject) => {
    setWorkspace((current) => current ? {
      ...current,
      activeProjectId: next.id,
      projects: current.projects.map((item) => item.id === next.id ? next : item),
    } : current);
  }, []);

  const runMutation = useCallback((mutation: (current: StudioProject) => StudioProject, success?: string) => {
    if (!project) return;
    try {
      const next = mutation(project);
      replaceActiveProject(next);
      setError("");
      if (success) setNotice(success);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Perubahan gagal diterapkan.");
    }
  }, [project, replaceActiveProject]);

  const updateIntake = (field: keyof StudioIntake, value: StudioIntake[keyof StudioIntake]) => {
    runMutation((current) => updateStudioIntake(current, { [field]: value } as Partial<StudioIntake>));
  };

  const createProject = () => {
    const next = createStudioProject();
    setWorkspace((current) => current ? {
      ...current,
      activeProjectId: next.id,
      projects: [...current.projects, next],
    } : createStudioWorkspace(next));
    setActiveTab("intake");
    setNotice("Proyek baru dibuat. Mulai dari masalah, tujuan, dan sumber utama.");
  };

  const duplicateProject = () => {
    if (!project) return;
    const next = duplicateStudioProject(project);
    setWorkspace((current) => current ? {
      ...current,
      activeProjectId: next.id,
      projects: [...current.projects, next],
    } : current);
    setNotice("Salinan proyek dibuat tanpa lock agar aman untuk dieksplorasi.");
  };

  const deleteProject = () => {
    if (!workspace || !project || workspace.projects.length <= 1) {
      setError("Minimal satu proyek harus tetap tersedia.");
      return;
    }
    if (!window.confirm(`Hapus proyek lokal “${project.name}”? Tindakan ini tidak memengaruhi database.`)) return;
    const projects = workspace.projects.filter((item) => item.id !== project.id);
    setWorkspace({ ...workspace, projects, activeProjectId: projects[0].id });
    setNotice("Proyek lokal dihapus.");
  };

  const addSource = () => {
    runMutation(
      (current) => addStudioSource(current, sourceDraft),
      "Sumber masuk ke context vault dan seluruh turunan yang terkait ditandai untuk validasi ulang.",
    );
    if (sourceDraft.title.trim() && sourceDraft.content.trim()) {
      setSourceDraft({ kind: "note", authority: "unverified", title: "", content: "", provenance: "" });
    }
  };

  const extractFile = async (file: File) => {
    setExtractingFile(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await authenticatedFetch("/api/context/extract", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "File gagal dibaca.");
      const kind = sourceKindOptions.some((option) => option.value === body.data.kind)
        ? (body.data.kind as SourceKind)
        : "note";
      setSourceDraft((current) => ({
        ...current,
        kind,
        authority: kind === "campus_guide" ? "primary" : current.authority,
        title: body.data.title || file.name,
        content: body.data.content || "",
        fileName: file.name,
        provenance: `Ekstrak file ${file.name}`,
      }));
      setNotice("File berhasil diekstrak. Periksa otoritas dan isi sebelum memasukkannya.");
    } catch (extractError) {
      if (/\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|sql|html|css|xml|ya?ml)$/i.test(file.name) && file.size <= 2_000_000) {
        const content = await file.text();
        setSourceDraft((current) => ({ ...current, title: file.name, content, fileName: file.name, provenance: "Dibaca lokal dari browser" }));
        setNotice("File teks dibaca lokal. Login dibutuhkan untuk ekstraksi PDF/DOCX/ZIP yang aman.");
      } else {
        setError(extractError instanceof Error ? extractError.message : "File gagal diekstrak.");
      }
    } finally {
      setExtractingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const answerQuestion = (question: StudioQuestion, lock: boolean) => {
    const answer = questionDrafts[question.id] ?? question.answer;
    runMutation(
      (current) => answerStudioQuestion(current, question.id, answer, { lock }),
      lock ? "Jawaban dikonfirmasi dan dikunci ke Decision Ledger." : "Jawaban dikonfirmasi ke Decision Ledger.",
    );
  };

  const waiveQuestion = (question: StudioQuestion) => {
    const reason = window.prompt("Tuliskan alasan mengapa pertanyaan ini aman untuk di-waive. Alasan akan masuk audit trail.");
    if (!reason) return;
    runMutation((current) => waiveStudioQuestion(current, question.id, reason), "Waiver tersimpan sebagai asumsi yang dapat diaudit.");
  };

  const runDeepScan = async () => {
    if (!project) return;
    setDeepScanning(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/studio/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intake: project.intake,
          specification: project.specification,
          unresolvedQuestions: project.questions.filter((question) => question.status === "unanswered").map((question) => question.prompt),
          sources: project.sources,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Deep Scan gagal.");
      runMutation(
        (current) => mergeAiQuestions(current, body.data.questions || []),
        `${body.data.questions?.length || 0} pertanyaan blind spot baru ditambahkan.`,
      );
      setDeepFindings(Array.isArray(body.data.findings) ? body.data.findings : []);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Deep Scan gagal. Pertanyaan deterministik tetap aktif.");
    } finally {
      setDeepScanning(false);
    }
  };

  const openUmlBuilder = (artifact: StudioArtifact) => {
    if (!project) return;
    const diagramType = artifact.id === "usecase-main" ? "usecase" : artifact.id === "sequence-main" ? "sequence" : "activity";
    let next = project;
    try {
      if (["not_started", "stale"].includes(artifact.status)) next = advanceArtifact(project, artifact.id, "draft");
      replaceActiveProject(next);
      const nextWorkspace = workspace ? {
        ...workspace,
        projects: workspace.projects.map((item) => item.id === next.id ? next : item),
      } : null;
      if (nextWorkspace) saveStudioWorkspace(window.localStorage, nextWorkspace);
      window.localStorage.setItem("uml-ai-prefill", JSON.stringify({
        prompt: [
          `Buat ${artifact.title} yang konsisten dengan Project Specification berikut.`,
          "Jangan menambah aktor, requirement, entitas, atau alur yang tidak ada. Jika informasi kritis kurang, minta klarifikasi.",
          specificationAsMarkdown(next.specification),
        ].join("\n\n").slice(0, 18_000),
        diagramType,
        reportDiagramId: artifact.id,
        title: artifact.title,
        diagramData: artifact.payload,
        reportContext: {
          studioProjectId: next.id,
          reportTitle: next.intake.title,
          topic: next.intake.topic || next.intake.problem,
          projectType: next.intake.projectType,
          course: next.intake.course,
          citationStyle: next.formatProfile.citationStyle,
          specificationVersion: next.specification.version,
          sources: next.sources.slice(0, 6).map((source) => ({ title: source.title, preview: source.content.slice(0, 500) })),
        },
      }));
      router.push("/uml-builder");
    } catch (umlError) {
      setError(umlError instanceof Error ? umlError.message : "UML Builder gagal dibuka.");
    }
  };

  const downloadSpecification = () => {
    if (!project) return;
    const blob = new Blob([specificationAsMarkdown(project.specification)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}-spec-v${project.specification.version}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!workspace || !project) {
    return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></main>;
  }

  const unresolvedQuestions = project.questions.filter((question) => question.status === "unanswered");
  const visibleQuestions = showResolvedQuestions ? project.questions : unresolvedQuestions;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-6 overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-2xl shadow-slate-300">
          <div className="grid gap-7 p-6 md:p-8 lg:grid-cols-[1fr_360px]">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge tone="blue">Unified Project Studio</Badge>
                {project.importedFromLegacy && <Badge tone="violet">Imported legacy</Badge>}
                <span className="text-xs font-bold text-slate-400">Schema v{project.schemaVersion} · revisi {project.revision}</span>
              </div>
              <h1 className="max-w-4xl text-3xl font-black tracking-tight md:text-5xl">Berpikir dulu, mengunci keputusan, baru menghasilkan.</h1>
              <p className="mt-4 max-w-3xl text-sm font-medium leading-7 text-slate-300 md:text-base">
                Semua permintaan dosen, pedoman, bahan mentah, jawaban brainstorming, UML, isi, dan format hidup dalam satu rantai keputusan yang dapat diaudit.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <select
                  value={workspace.activeProjectId}
                  onChange={(event) => setWorkspace({ ...workspace, activeProjectId: event.target.value })}
                  className="max-w-sm rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold text-white outline-none"
                >
                  {workspace.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button onClick={createProject} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black hover:bg-blue-500"><Plus className="mr-1 inline h-4 w-4" /> Baru</button>
                <button onClick={duplicateProject} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-200 hover:bg-slate-800"><Copy className="mr-1 inline h-4 w-4" /> Duplikat</button>
                <button onClick={deleteProject} className="rounded-xl border border-red-900 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-950"><Trash2 className="mr-1 inline h-4 w-4" /> Hapus</button>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-end justify-between">
                <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Readiness</p><p className="mt-1 text-4xl font-black">{project.readiness.score}<span className="text-lg text-slate-500">/100</span></p></div>
                <Badge tone={project.readiness.stage === "ready" ? "green" : project.readiness.blockerCount ? "red" : "amber"}>{project.readiness.stage}</Badge>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all" style={{ width: `${project.readiness.score}%` }} /></div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-950 p-2"><p className="text-lg font-black text-red-300">{project.readiness.blockerCount}</p><p className="text-[9px] font-bold uppercase text-slate-500">blocker</p></div>
                <div className="rounded-xl bg-slate-950 p-2"><p className="text-lg font-black text-amber-300">{project.readiness.staleArtifactCount}</p><p className="text-[9px] font-bold uppercase text-slate-500">stale</p></div>
                <div className="rounded-xl bg-slate-950 p-2"><p className="text-lg font-black text-blue-300">{project.readiness.formatErrorCount}</p><p className="text-[9px] font-bold uppercase text-slate-500">format error</p></div>
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-400">
                {saveState === "saving" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : saveState === "error" ? <XCircle className="h-3.5 w-3.5 text-red-400" /> : <Save className="h-3.5 w-3.5 text-emerald-400" />}
                {saveState === "saving" ? "Menyimpan lokal…" : saveState === "error" ? "Penyimpanan lokal gagal" : "Tersimpan lokal · DB belum dimigrasikan"}
              </p>
            </div>
          </div>
        </header>

        {(notice || error) && (
          <div className={`mb-5 flex items-start justify-between rounded-2xl border px-4 py-3 text-sm font-semibold ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            <span>{error || notice}</span>
            <button onClick={() => { setError(""); setNotice(""); }} className="ml-4 text-current opacity-60 hover:opacity-100"><XCircle className="h-5 w-5" /></button>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-3 shadow-sm xl:sticky xl:top-24">
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const active = tab.id === activeTab;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`mb-1 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${active ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "text-slate-600 hover:bg-slate-50"}`}>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${active ? "bg-white/15" : "bg-slate-100"}`}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-black">{index + 1}. {tab.label}</span><span className={`block text-[10px] font-bold ${active ? "text-blue-100" : "text-slate-400"}`}>{tab.helper}</span></span>
                  <ChevronRight className="h-4 w-4 opacity-40" />
                </button>
              );
            })}
            <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Langkah berikutnya</p>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-300">{project.readiness.nextActions[0]}</p>
            </div>
          </aside>

          <section className={`${cardClass} min-w-0 p-5 md:p-8`}>
            {activeTab === "intake" && (
              <IntakePanel
                project={project}
                sourceDraft={sourceDraft}
                setSourceDraft={setSourceDraft}
                updateIntake={updateIntake}
                addSource={addSource}
                removeSource={(sourceId) => runMutation((current) => removeStudioSource(current, sourceId), "Sumber dihapus; turunan terkait menjadi stale.")}
                fileInputRef={fileInputRef}
                extractingFile={extractingFile}
                extractFile={extractFile}
              />
            )}
            {activeTab === "questions" && (
              <QuestionsPanel
                questions={visibleQuestions}
                unresolvedCount={unresolvedQuestions.length}
                drafts={questionDrafts}
                setDrafts={setQuestionDrafts}
                showResolved={showResolvedQuestions}
                setShowResolved={setShowResolvedQuestions}
                answerQuestion={answerQuestion}
                waiveQuestion={waiveQuestion}
                runDeepScan={runDeepScan}
                deepScanning={deepScanning}
                findings={deepFindings}
                manual={manualQuestion}
                setManual={setManualQuestion}
                addManual={() => {
                  runMutation((current) => addStudioQuestion(current, manualQuestion), "Pertanyaan brainstorming manual ditambahkan.");
                  if (manualQuestion.prompt.trim()) setManualQuestion({ ...manualQuestion, prompt: "" });
                }}
              />
            )}
            {activeTab === "decisions" && (
              <DecisionsPanel
                decisions={project.decisions}
                setStatus={(decision, status) => runMutation((current) => setDecisionStatus(current, decision.id, status), `Keputusan ${decisionStatusLabel[status].toLowerCase()}.`)}
                manual={manualDecision}
                setManual={setManualDecision}
                addManual={() => {
                  runMutation((current) => addStudioDecision(current, manualDecision), "Keputusan manual masuk ke ledger.");
                  if (manualDecision.statement.trim() && manualDecision.value.trim()) setManualDecision({ ...manualDecision, statement: "", value: "" });
                }}
              />
            )}
            {activeTab === "specification" && <SpecificationPanel project={project} download={downloadSpecification} />}
            {activeTab === "artifacts" && (
              <ArtifactsPanel
                project={project}
                openUml={openUmlBuilder}
                action={(artifact, action) => runMutation((current) => advanceArtifact(current, artifact.id, action), `${artifact.title}: status diperbarui.`)}
              />
            )}
            {activeTab === "format" && (
              <FormatPanel
                project={project}
                update={(patch) => runMutation((current) => updateFormatProfile(current, patch), "Profil format diperbarui; dokumen turunan perlu divalidasi ulang.")}
              />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

interface IntakePanelProps {
  project: StudioProject;
  sourceDraft: { kind: SourceKind; authority: SourceAuthority; title: string; content: string; provenance: string; fileName?: string };
  setSourceDraft: React.Dispatch<React.SetStateAction<IntakePanelProps["sourceDraft"]>>;
  updateIntake: (field: keyof StudioIntake, value: StudioIntake[keyof StudioIntake]) => void;
  addSource: () => void;
  removeSource: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  extractingFile: boolean;
  extractFile: (file: File) => Promise<void>;
}

function IntakePanel({ project, sourceDraft, setSourceDraft, updateIntake, addSource, removeSource, fileInputRef, extractingFile, extractFile }: IntakePanelProps) {
  return (
    <div>
      <SectionTitle icon={Layers3} eyebrow="Tahap 1" title="Project Intake & Context Vault" helper="Masukkan bahan mentah tanpa harus merapikannya dulu. Sistem membedakan sumber mengikat, fakta utama, pendukung, contoh, dan asumsi agar tidak tercampur." />
      <div className="grid gap-4 md:grid-cols-2">
        <label><span className={labelClass}>Jenis proyek</span><select className={inputClass} value={project.intake.projectType} onChange={(event) => updateIntake("projectType", event.target.value as StudioIntake["projectType"])}>{projectTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span className={labelClass}>Deadline</span><input type="date" className={inputClass} value={project.intake.deadline} onChange={(event) => updateIntake("deadline", event.target.value)} /></label>
        <label className="md:col-span-2"><span className={labelClass}>Judul kerja</span><input className={inputClass} value={project.intake.title} onChange={(event) => updateIntake("title", event.target.value)} placeholder="Judul boleh sementara, tetapi harus spesifik" /></label>
        <label><span className={labelClass}>Institusi</span><input className={inputClass} value={project.intake.institution} onChange={(event) => updateIntake("institution", event.target.value)} placeholder="Universitas / sekolah / organisasi" /></label>
        <label><span className={labelClass}>Program / mata kuliah</span><input className={inputClass} value={project.intake.program || project.intake.course} onChange={(event) => updateIntake("program", event.target.value)} placeholder="Program studi atau mata kuliah" /></label>
        <label><span className={labelClass}>Dosen / pembimbing</span><input className={inputClass} value={project.intake.lecturer} onChange={(event) => updateIntake("lecturer", event.target.value)} placeholder="Nama atau peran reviewer" /></label>
        <label><span className={labelClass}>Output yang diminta</span><input className={inputClass} value={project.intake.expectedOutput} onChange={(event) => updateIntake("expectedOutput", event.target.value)} placeholder="Laporan, sistem, UML, presentasi…" /></label>
        <label className="md:col-span-2"><span className={labelClass}>Masalah yang harus diselesaikan</span><textarea rows={4} className={inputClass} value={project.intake.problem} onChange={(event) => updateIntake("problem", event.target.value)} placeholder="Kondisi saat ini, pihak terdampak, dan akibat masalah" /></label>
        <label className="md:col-span-2"><span className={labelClass}>Tujuan terukur</span><textarea rows={3} className={inputClass} value={project.intake.objective} onChange={(event) => updateIntake("objective", event.target.value)} placeholder="Apa yang dirancang/dibangun/diuji/dianalisis dan ukuran selesai" /></label>
        <label><span className={labelClass}>Topik / ide kasar</span><textarea rows={3} className={inputClass} value={project.intake.topic} onChange={(event) => updateIntake("topic", event.target.value)} placeholder="Brain dump bebas" /></label>
        <label><span className={labelClass}>Kondisi / bahan yang sudah ada</span><textarea rows={3} className={inputClass} value={project.intake.existingState} onChange={(event) => updateIntake("existingState", event.target.value)} placeholder="Kode, data, draft, revisi, diagram lama…" /></label>
      </div>

      <div className="my-8 border-t border-slate-200" />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-xl font-black text-slate-900">Context Vault</h3><p className="mt-1 text-sm font-medium text-slate-500">Authority menentukan sumber mana yang menang saat ada konflik.</p></div>
        <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.zip,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.sql,.html,.css,.xml,.yml,.yaml" onChange={(event) => { const file = event.target.files?.[0]; if (file) void extractFile(file); }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={extractingFile} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{extractingFile ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Upload className="mr-2 inline h-4 w-4" />}Upload / ekstrak file</button>
      </div>
      <div className="rounded-3xl border border-blue-100 bg-blue-50/60 p-4 md:p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label><span className={labelClass}>Jenis sumber</span><select className={inputClass} value={sourceDraft.kind} onChange={(event) => setSourceDraft({ ...sourceDraft, kind: event.target.value as SourceKind })}>{sourceKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className={labelClass}>Tingkat otoritas</span><select className={inputClass} value={sourceDraft.authority} onChange={(event) => setSourceDraft({ ...sourceDraft, authority: event.target.value as SourceAuthority })}>{authorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.helper}</option>)}</select></label>
          <label><span className={labelClass}>Judul sumber</span><input className={inputClass} value={sourceDraft.title} onChange={(event) => setSourceDraft({ ...sourceDraft, title: event.target.value })} placeholder="Mis. Revisi dosen 22 Juli" /></label>
          <label><span className={labelClass}>Asal / provenance</span><input className={inputClass} value={sourceDraft.provenance} onChange={(event) => setSourceDraft({ ...sourceDraft, provenance: event.target.value })} placeholder="Email dosen, LMS, PDF fakultas…" /></label>
          <label className="md:col-span-2"><span className={labelClass}>Isi mentah</span><textarea rows={7} className={inputClass} value={sourceDraft.content} onChange={(event) => setSourceDraft({ ...sourceDraft, content: event.target.value })} placeholder="Tempel aturan, revisi, contoh, README, data, atau catatan apa adanya" /></label>
        </div>
        <button onClick={addSource} className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700"><Plus className="mr-2 inline h-4 w-4" />Masukkan ke vault</button>
      </div>
      <div className="mt-5 space-y-3">
        {project.sources.length === 0 ? <EmptyState>Belum ada sumber. Minimal masukkan brief/permintaan dosen dan pedoman format.</EmptyState> : project.sources.map((source) => (
          <article key={source.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge tone={source.authority === "binding" ? "red" : source.authority === "primary" ? "blue" : "slate"}>{source.authority}</Badge><Badge>{sourceKindOptions.find((item) => item.value === source.kind)?.label || source.kind}</Badge></div><h4 className="mt-2 truncate font-black text-slate-900">{source.title}</h4><p className="mt-1 text-xs font-semibold text-slate-400">{source.provenance || source.fileName || "Asal belum dicatat"}</p></div>
              <button onClick={() => { if (window.confirm(`Hapus sumber “${source.title}”?`)) removeSource(source.id); }} className="rounded-xl p-2 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
            </div>
            <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{source.content}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

interface QuestionsPanelProps {
  questions: StudioQuestion[];
  unresolvedCount: number;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  showResolved: boolean;
  setShowResolved: (value: boolean) => void;
  answerQuestion: (question: StudioQuestion, lock: boolean) => void;
  waiveQuestion: (question: StudioQuestion) => void;
  runDeepScan: () => Promise<void>;
  deepScanning: boolean;
  findings: string[];
  manual: { prompt: string; category: QuestionCategory; class: QuestionClass };
  setManual: React.Dispatch<React.SetStateAction<QuestionsPanelProps["manual"]>>;
  addManual: () => void;
}

function QuestionsPanel({ questions, unresolvedCount, drafts, setDrafts, showResolved, setShowResolved, answerQuestion, waiveQuestion, runDeepScan, deepScanning, findings, manual, setManual, addManual }: QuestionsPanelProps) {
  return (
    <div>
      <SectionTitle icon={BrainCircuit} eyebrow="Tahap 2" title="Question Engine" helper="Pertanyaan diurutkan berdasarkan dampak × ketidakpastian × jumlah artefak × risiko revisi. Blocker harus selesai sebelum produksi dianggap aman." />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 p-4 text-white">
        <div><p className="text-2xl font-black">{unresolvedCount} <span className="text-sm text-slate-400">belum dijawab</span></p><p className="text-xs font-semibold text-slate-500">Pertanyaan inti tetap berjalan tanpa AI.</p></div>
        <div className="flex gap-2"><button onClick={() => setShowResolved(!showResolved)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-black">{showResolved ? "Sembunyikan selesai" : "Lihat semua"}</button><button onClick={() => void runDeepScan()} disabled={deepScanning} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black disabled:opacity-50">{deepScanning ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 inline h-4 w-4" />}AI Deep Scan</button></div>
      </div>
      {findings.length > 0 && <div className="mb-5 rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-black uppercase tracking-widest text-violet-700">Temuan Deep Scan</p><ul className="mt-2 space-y-1 text-sm font-semibold text-violet-900">{findings.map((finding) => <li key={finding}>• {finding}</li>)}</ul></div>}
      <div className="space-y-4">
        {questions.length === 0 ? <EmptyState>Semua pertanyaan yang ditampilkan sudah selesai.</EmptyState> : questions.map((question, index) => {
          const answer = drafts[question.id] ?? question.answer;
          const tone = question.class === "blocker" ? "red" : question.class === "important" ? "amber" : "blue";
          return (
            <article key={question.id} className={`rounded-3xl border p-5 ${question.status === "unanswered" ? "border-slate-200 bg-white" : "border-emerald-100 bg-emerald-50/30"}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-black text-slate-300">#{index + 1}</span><Badge tone={tone}>{question.class}</Badge><Badge>{categoryLabels[question.category]}</Badge><span className="ml-auto text-[10px] font-black uppercase text-slate-400">Prioritas {question.priority}</span></div>
              <h3 className="mt-3 text-lg font-black leading-snug text-slate-900">{question.prompt}</h3>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-500"><strong className="text-slate-700">Kenapa ditanya:</strong> {question.why}</p>
              {question.status === "waived" ? <p className="mt-3 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-800">Waiver: {question.waiverReason}</p> : (
                <textarea rows={4} className={`${inputClass} mt-4`} value={answer} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.answerHint} />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {question.status !== "waived" && <><button onClick={() => answerQuestion(question, false)} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700"><Check className="mr-1 inline h-4 w-4" />Konfirmasi</button><button onClick={() => answerQuestion(question, true)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"><LockKeyhole className="mr-1 inline h-4 w-4" />Konfirmasi & kunci</button></>}
                {question.status === "unanswered" && question.class !== "blocker" && <button onClick={() => waiveQuestion(question)} className="rounded-xl px-3 py-2 text-xs font-black text-slate-400 hover:bg-slate-100">Waive dengan alasan</button>}
                <span className="self-center text-[10px] font-bold text-slate-400">Dampak: {question.affectedArtifactIds.length} artefak · {question.origin}</span>
              </div>
            </article>
          );
        })}
      </div>
      <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <h3 className="font-black text-slate-900">Tambahkan pertanyaan brainstorming sendiri</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_160px_150px_auto]"><input className={inputClass} value={manual.prompt} onChange={(event) => setManual({ ...manual, prompt: event.target.value })} placeholder="Pertanyaan dari user/dosen/reviewer…" /><select className={inputClass} value={manual.category} onChange={(event) => setManual({ ...manual, category: event.target.value as QuestionCategory })}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className={inputClass} value={manual.class} onChange={(event) => setManual({ ...manual, class: event.target.value as QuestionClass })}><option value="blocker">Blocker</option><option value="important">Important</option><option value="enrichment">Enrichment</option></select><button onClick={addManual} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white"><Plus className="mr-1 inline h-4 w-4" />Tambah</button></div>
      </div>
    </div>
  );
}

function DecisionsPanel({ decisions, setStatus, manual, setManual, addManual }: { decisions: StudioDecision[]; setStatus: (decision: StudioDecision, status: DecisionStatus) => void; manual: { statement: string; value: string; category: QuestionCategory }; setManual: React.Dispatch<React.SetStateAction<{ statement: string; value: string; category: QuestionCategory }>>; addManual: () => void }) {
  const active = decisions.filter((decision) => !["superseded", "rejected"].includes(decision.status));
  return (
    <div>
      <SectionTitle icon={History} eyebrow="Tahap 3" title="Decision Ledger" helper="Setiap jawaban penting berubah menjadi keputusan berversi. Lock mencegah perubahan diam-diam; perubahan keputusan membuat artefak turunannya stale." />
      <div className="mb-5 grid grid-cols-3 gap-3"><div className="rounded-2xl bg-slate-100 p-4"><p className="text-2xl font-black">{active.length}</p><p className="text-[10px] font-black uppercase text-slate-400">aktif</p></div><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-2xl font-black text-emerald-700">{active.filter((item) => item.status === "locked").length}</p><p className="text-[10px] font-black uppercase text-emerald-600">terkunci</p></div><div className="rounded-2xl bg-amber-50 p-4"><p className="text-2xl font-black text-amber-700">{active.filter((item) => item.status !== "locked").length}</p><p className="text-[10px] font-black uppercase text-amber-600">bisa berubah</p></div></div>
      <div className="space-y-3">{decisions.length === 0 ? <EmptyState>Jawab Question Engine untuk membangun ledger.</EmptyState> : decisions.map((decision) => (
        <article key={decision.id} className={`rounded-2xl border p-4 ${decision.status === "locked" ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200"}`}>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={decision.status === "locked" ? "green" : decision.status === "rejected" ? "red" : "blue"}>{decisionStatusLabel[decision.status]}</Badge><Badge>{categoryLabels[decision.category]}</Badge><span className="text-[10px] font-bold text-slate-400">v{decision.version} · {decision.origin} · {decision.history.length} riwayat</span></div>
          <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-400">{decision.statement}</p><p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">{decision.value}</p>
          <div className="mt-3 flex flex-wrap gap-2">{decision.status === "locked" ? <button onClick={() => setStatus(decision, "confirmed")} className="rounded-xl border border-amber-200 px-3 py-2 text-xs font-black text-amber-700"><Unlock className="mr-1 inline h-4 w-4" />Buka kunci</button> : !["rejected", "superseded"].includes(decision.status) && <button onClick={() => setStatus(decision, "locked")} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"><LockKeyhole className="mr-1 inline h-4 w-4" />Kunci</button>}{!["rejected", "superseded"].includes(decision.status) && <button onClick={() => setStatus(decision, "rejected")} className="rounded-xl px-3 py-2 text-xs font-black text-red-500 hover:bg-red-50">Tolak</button>}<span className="self-center text-[10px] font-bold text-slate-400">Mempengaruhi {decision.affectedArtifactIds.length} artefak</span></div>
        </article>
      ))}</div>
      <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5"><h3 className="font-black">Catat keputusan manual</h3><div className="mt-3 grid gap-3 md:grid-cols-2"><input className={inputClass} value={manual.statement} onChange={(event) => setManual({ ...manual, statement: event.target.value })} placeholder="Apa yang diputuskan?" /><select className={inputClass} value={manual.category} onChange={(event) => setManual({ ...manual, category: event.target.value as QuestionCategory })}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea rows={4} className={`${inputClass} md:col-span-2`} value={manual.value} onChange={(event) => setManual({ ...manual, value: event.target.value })} placeholder="Nilai keputusan dan detailnya" /></div><button onClick={addManual} className="mt-3 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white"><Plus className="mr-1 inline h-4 w-4" />Simpan keputusan</button></div>
    </div>
  );
}

function SpecificationPanel({ project, download }: { project: StudioProject; download: () => void }) {
  const spec = project.specification;
  const sections: Array<{ title: string; values: string[] }> = [
    { title: "Cakupan masuk", values: spec.scopeIn }, { title: "Cakupan keluar", values: spec.scopeOut }, { title: "Aktor", values: spec.actors.map((actor) => `${actor.name} — ${actor.responsibility}`) }, { title: "Kebutuhan fungsional", values: spec.functionalRequirements }, { title: "Kebutuhan nonfungsional", values: spec.nonFunctionalRequirements }, { title: "Aturan bisnis", values: spec.businessRules }, { title: "Alur normal", values: spec.normalFlows }, { title: "Exception", values: spec.exceptionFlows }, { title: "Entitas / data", values: spec.entities }, { title: "Metode", values: spec.methodology }, { title: "Permintaan dosen", values: spec.lecturerRequests }, { title: "Aturan format", values: spec.formatConstraints }, { title: "Asumsi / waiver", values: spec.assumptions },
  ];
  return <div><SectionTitle icon={ClipboardCheck} eyebrow="Tahap 4" title={`Project Specification v${spec.version}`} helper="Spesifikasi ini dikompilasi otomatis dari intake, sumber berotoritas, dan keputusan aktif. Artefak downstream wajib mengacu ke versi ini." /><div className="mb-5 flex flex-wrap gap-2"><button onClick={() => void navigator.clipboard.writeText(specificationAsMarkdown(spec))} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black"><Copy className="mr-1 inline h-4 w-4" />Copy Markdown</button><button onClick={download} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"><Download className="mr-1 inline h-4 w-4" />Download .md</button><Badge tone={spec.unresolvedBlockers.length ? "red" : "green"}>{spec.unresolvedBlockers.length} unresolved blocker</Badge></div><div className="rounded-3xl bg-slate-950 p-5 text-white"><p className="text-[10px] font-black uppercase tracking-widest text-blue-300">{projectTypeOptions.find((item) => item.value === spec.projectType)?.label}</p><h3 className="mt-2 text-2xl font-black">{spec.title || "Judul belum diputuskan"}</h3><div className="mt-4 grid gap-4 md:grid-cols-2"><div><p className="text-[10px] font-black uppercase text-slate-500">Masalah</p><p className="mt-1 text-sm leading-6 text-slate-300">{spec.problem || "Belum diputuskan"}</p></div><div><p className="text-[10px] font-black uppercase text-slate-500">Tujuan</p><p className="mt-1 text-sm leading-6 text-slate-300">{spec.objective || "Belum diputuskan"}</p></div></div></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{sections.map((section) => <article key={section.title} className="rounded-2xl border border-slate-200 p-4"><h4 className="font-black text-slate-900">{section.title}</h4>{section.values.length ? <ul className="mt-2 space-y-1.5 text-sm font-medium leading-6 text-slate-600">{section.values.map((value, index) => <li key={`${value}-${index}`} className="flex gap-2"><span className="text-blue-500">•</span><span>{value}</span></li>)}</ul> : <p className="mt-2 text-sm font-semibold text-slate-300">Belum diputuskan</p>}</article>)}</div>{spec.unresolvedBlockers.length > 0 && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4"><p className="font-black text-red-800">Produksi belum aman</p><ul className="mt-2 space-y-1 text-sm font-semibold text-red-700">{spec.unresolvedBlockers.map((item) => <li key={item}>• {item}</li>)}</ul></div>}</div>;
}

function ArtifactsPanel({ project, openUml, action }: { project: StudioProject; openUml: (artifact: StudioArtifact) => void; action: (artifact: StudioArtifact, action: "draft" | "ready" | "approve" | "lock" | "reopen") => void }) {
  return <div><SectionTitle icon={Workflow} eyebrow="Tahap 5" title="Artifact Dependency Graph" helper="Artefak dibangun dari hulu ke hilir. Approval ditolak bila dependensi belum approved; perubahan keputusan membuat seluruh turunan stale." /><div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-blue-800"><GitBranch className="mr-2 inline h-5 w-5" />Specification → requirements/aktor → UML → test case & outline → draft → format final.</div><div className="space-y-4">{project.artifacts.map((artifact, index) => { const problems = artifactDependencyProblems(project, artifact.id); const statusTone = artifact.status === "locked" || artifact.status === "approved" ? "green" : artifact.status === "stale" ? "red" : artifact.status === "ready" ? "blue" : "slate"; return <article key={artifact.id} className={`rounded-3xl border p-5 ${artifact.status === "stale" ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}><div className="flex flex-col gap-4 lg:flex-row lg:items-start"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-500">{index + 1}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><Badge tone={statusTone}>{artifact.status.replace("_", " ")}</Badge><span className="text-[10px] font-bold text-slate-400">v{artifact.currentVersion}{artifact.approvedVersion ? ` · approved v${artifact.approvedVersion}` : ""}</span></div><h3 className="mt-2 text-lg font-black text-slate-900">{artifact.title}</h3><p className="mt-1 text-sm font-medium leading-6 text-slate-500">{artifact.description}</p>{artifact.dependencyIds.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5"><span className="text-[10px] font-black uppercase text-slate-400">Butuh:</span>{artifact.dependencyIds.map((id) => { const dependency = project.artifacts.find((item) => item.id === id); return <Badge key={id} tone={dependency && ["approved", "locked"].includes(dependency.status) ? "green" : "amber"}>{dependency?.title || id}</Badge>; })}</div>}{problems.length > 0 && <p className="mt-2 text-xs font-bold text-amber-700">{problems.join(" ")}</p>}</div><div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[290px] lg:justify-end">{artifact.kind === "uml" && <button onClick={() => openUml(artifact)} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white"><Workflow className="mr-1 inline h-4 w-4" />{artifact.currentVersion ? "Buka UML" : "Buat UML"}</button>}{["not_started", "stale"].includes(artifact.status) && artifact.kind !== "uml" && <button onClick={() => action(artifact, "draft")} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">Mulai draft</button>}{artifact.status === "draft" && <button onClick={() => action(artifact, "ready")} className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-700">Siap review</button>}{["ready", "draft"].includes(artifact.status) && <button onClick={() => action(artifact, "approve")} disabled={problems.length > 0} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-30"><CheckCircle2 className="mr-1 inline h-4 w-4" />Approve</button>}{artifact.status === "approved" && <button onClick={() => action(artifact, "lock")} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"><LockKeyhole className="mr-1 inline h-4 w-4" />Lock</button>}{["approved", "locked"].includes(artifact.status) && <button onClick={() => action(artifact, "reopen")} className="rounded-xl border border-amber-200 px-3 py-2 text-xs font-black text-amber-700">Reopen</button>}</div></div></article>; })}</div></div>;
}

function FormatPanel({ project, update }: { project: StudioProject; update: (patch: Partial<FormatProfile>) => void }) {
  const profile = project.formatProfile;
  const errorCount = project.formatIssues.filter((issue) => issue.severity === "error").length;
  return <div><SectionTitle icon={FileCheck2} eyebrow="Tahap 6" title="Format Contract & Preflight" helper="Aturan format disimpan sebagai data terstruktur dan harus ditautkan ke pedoman sumber. Sistem memblokir finalisasi jika ada aturan kritis yang belum pasti." /><div className={`mb-5 rounded-2xl border p-4 ${errorCount ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}><ShieldCheck className={`mr-2 inline h-5 w-5 ${errorCount ? "text-red-600" : "text-emerald-600"}`} /><span className="text-sm font-black">{errorCount ? `${errorCount} error preflight harus diperbaiki` : "Tidak ada error format kritis"}</span></div><div className="grid gap-4 md:grid-cols-2"><label><span className={labelClass}>Nama preset</span><input className={inputClass} value={profile.presetName} onChange={(event) => update({ presetName: event.target.value })} /></label><label><span className={labelClass}>Sumber pedoman mengikat</span><select className={inputClass} value={profile.sourceId || ""} onChange={(event) => update({ sourceId: event.target.value || undefined })}><option value="">Belum dipilih</option>{project.sources.filter((source) => ["campus_guide", "template", "lecturer_request", "brief"].includes(source.kind)).map((source) => <option key={source.id} value={source.id}>{source.title} ({source.authority})</option>)}</select></label><label><span className={labelClass}>Ukuran kertas</span><select className={inputClass} value={profile.paperSize} onChange={(event) => update({ paperSize: event.target.value as FormatProfile["paperSize"] })}><option value="A4">A4</option><option value="Letter">Letter</option></select></label><label><span className={labelClass}>Font utama</span><input className={inputClass} value={profile.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })} /></label><label><span className={labelClass}>Ukuran body (pt)</span><input type="number" className={inputClass} value={profile.bodyFontSize} onChange={(event) => update({ bodyFontSize: Number(event.target.value) })} /></label><label><span className={labelClass}>Line spacing</span><input type="number" step="0.1" className={inputClass} value={profile.lineSpacing} onChange={(event) => update({ lineSpacing: Number(event.target.value) })} /></label><div className="md:col-span-2"><span className={labelClass}>Margin (mm) — atas / kanan / bawah / kiri</span><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{(["top", "right", "bottom", "left"] as const).map((side) => <label key={side}><span className="mb-1 block text-[10px] font-bold uppercase text-slate-400">{side}</span><input type="number" className={inputClass} value={profile.margins[side]} onChange={(event) => update({ margins: { ...profile.margins, [side]: Number(event.target.value) } })} /></label>)}</div></div><label><span className={labelClass}>Gaya sitasi</span><select className={inputClass} value={profile.citationStyle} onChange={(event) => update({ citationStyle: event.target.value as FormatProfile["citationStyle"] })}><option>APA 7</option><option>IEEE</option><option>Harvard</option><option>Vancouver</option><option>Other</option></select></label><label><span className={labelClass}>Aturan nomor halaman</span><input className={inputClass} value={profile.pageNumbering} onChange={(event) => update({ pageNumbering: event.target.value })} /></label><label className="md:col-span-2"><span className={labelClass}>Bagian wajib — satu per baris</span><textarea rows={8} className={inputClass} value={profile.requiredSections.join("\n")} onChange={(event) => update({ requiredSections: event.target.value.split(/\r?\n/) })} /></label></div><div className="mt-6"><h3 className="mb-3 text-lg font-black">Preflight issues</h3>{project.formatIssues.length === 0 ? <EmptyState>Semua aturan format yang dapat dicek sudah lolos.</EmptyState> : <div className="space-y-3">{project.formatIssues.map((issue) => <article key={issue.id} className={`rounded-2xl border p-4 ${issue.severity === "error" ? "border-red-200 bg-red-50" : issue.severity === "warning" ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50"}`}><div className="flex items-start gap-3">{issue.severity === "error" ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}<div><p className="text-sm font-black text-slate-900">{issue.message}</p><p className="mt-1 text-xs font-semibold text-slate-600">Perbaikan: {issue.fix}</p><p className="mt-1 text-[10px] font-bold uppercase text-slate-400">{issue.field}</p></div></div></article>)}</div>}</div><div className="mt-6 flex flex-wrap gap-3"><button onClick={() => window.location.assign("/fix-format")} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white"><Settings2 className="mr-2 inline h-4 w-4" />Buka Fix Format</button><div className="flex items-center text-xs font-bold text-slate-400"><BookOpenCheck className="mr-2 h-4 w-4" />Final DOCX tetap membutuhkan pemeriksaan struktur dokumen aktual.</div></div></div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, ImagePlus, Loader2, MessageCircle, Sparkles, Upload, X } from "lucide-react";
import { authenticatedFetch } from "@/components/AuthProvider";
import { getErrorMessage } from "@/lib/errors";
import { createStarterDeck, type PresentationDeck, type SlideVisual } from "@/lib/presentation/model";
import { layoutSlide, renderSlideSvg } from "@/lib/presentation/layout";
import { DESIGN_PRESETS } from "@/lib/presentation/presets";
import { combineIntakeMaterials, DEFAULT_INTAKE_ANSWERS, intakeMinutes, manualPresentationBrief, MAX_INTAKE_CHARS, MAX_INTAKE_FILE_BYTES, MAX_INTAKE_FILES, MAX_REFERENCE_BYTES, presentationBriefSchema, type BriefQuestionId, type PresentationBrief, type PresentationIntakeResult } from "@/lib/presentation/intake";
import styles from "./intake.module.css";

export type { PresentationIntakeResult } from "@/lib/presentation/intake";
type Material = { file: File; content?: string };
type Preset = (typeof DESIGN_PRESETS)[number];
const STEPS = ["Bahan", "Obrolan", "Tampilan", "Buat"];
const MOTIONS: { id: SlideVisual["motion"]; label: string }[] = [{ id: "none", label: "Tanpa animasi" }, { id: "fade", label: "Pudar lembut" }, { id: "push", label: "Geser" }, { id: "reveal", label: "Muncul bertahap" }];

async function request(url: string, body: FormData | object, signal: AbortSignal) {
  const form = body instanceof FormData;
  const response = await authenticatedFetch(url, { method: "POST", body: form ? body : JSON.stringify(body), headers: form ? undefined : { "Content-Type": "application/json" }, signal, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error || "Permintaan belum berhasil. Silakan coba lagi.");
  return data;
}

function seedDeck(preset: Preset, title: string, summary: string, motion: SlideVisual["motion"]): PresentationDeck {
  const deck = createStarterDeck(preset.theme);
  return {
    ...deck, title, artDirection: { ...preset.artDirection }, ...(preset.palette ? { palette: preset.palette } : {}),
    slides: [{
      id: deck.slides[0].id, title, eyebrow: "MENYIAPKAN PRESENTASI", body: summary ? [summary.slice(0, 220)] : [],
      source: "", notes: "", layout: "title", locked: false,
      visual: { motif: "none", background: preset.artDirection.style === "blueprint" ? "grid" : preset.artDirection.style === "zine" ? "halftone" : "solid", motion },
    }],
  };
}

function Thumbnail({ preset, title }: { preset: Preset; title: string }) {
  const deck = seedDeck(preset, title, "Satu gagasan. Cerita yang mudah diikuti.", "none");
  const svg = renderSlideSvg(layoutSlide(deck.slides[0], deck.theme, 0, 1, deck.artDirection, deck.palette));
  return <div className={styles.thumbnail} role="img" aria-label={`Contoh tampilan ${preset.label}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function PresentationIntake({ onReady, onCancel }: { onReady: (result: PresentationIntakeResult) => Promise<void>; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [reference, setReference] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [brief, setBrief] = useState<PresentationBrief | null>(null);
  const [manual, setManual] = useState(false);
  const [answers, setAnswers] = useState({ ...DEFAULT_INTAKE_ANSWERS });
  const [presetId, setPresetId] = useState(DESIGN_PRESETS[0].id);
  const [motion, setMotion] = useState<SlideVisual["motion"]>("none");
  const [slideCount, setSlideCount] = useState(6);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [canContinueManually, setCanContinueManually] = useState(false);
  const [materialText, setMaterialText] = useState("");
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  const extracted = useRef(new Map<File, string>());
  const referenceUpload = useRef<{ file: File; id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const preset = DESIGN_PRESETS.find((item) => item.id === presetId) ?? DESIGN_PRESETS[0];
  const topic = title.trim() || notes.trim().split("\n")[0]?.slice(0, 120) || materials[0]?.file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Presentasi saya";
  const minutes = intakeMinutes(answers.duration);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; abort.current?.abort(); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    if (!title && !notes && !materials.length && !reference) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [title, notes, materials.length, reference]);

  function addMaterials(files: File[]) {
    if (lock.current) return;
    setError(""); setCanContinueManually(false);
    if (materials.length + files.length > MAX_INTAKE_FILES) { setError("Pilih maksimum 8 dokumen sekaligus."); return; }
    if (files.some((file) => file.size <= 0 || file.size > MAX_INTAKE_FILE_BYTES)) { setError("Setiap bahan harus berisi data dan berukuran maksimum 12 MB."); return; }
    setMaterials((current) => [...current, ...files.map((file) => ({ file }))]);
  }

  async function consult() {
    if (lock.current) return;
    setError(""); setCanContinueManually(false);
    if (!notes.trim() && !materials.length && !title.trim()) { setError("Unggah bahan atau ceritakan topik Anda terlebih dahulu."); return; }
    if (!consent) { setError("Setujui pembacaan bahan sebelum melanjutkan ke AI."); return; }
    lock.current = true;
    const controller = new AbortController(); abort.current = controller;
    try {
      const contents: string[] = [];
      for (const material of materials) {
        let content = extracted.current.get(material.file);
        if (content === undefined) {
          setBusy(`Membaca ${material.file.name}...`);
          const form = new FormData(); form.set("file", material.file);
          const data = await request("/api/context/extract", form, controller.signal);
          controller.signal.throwIfAborted();
          if (typeof data.data?.content !== "string" || !data.data.content.trim()) throw new Error("Dokumen belum menghasilkan teks yang dapat dibaca.");
          const extractedContent = data.data.content as string;
          content = extractedContent;
          extracted.current.set(material.file, extractedContent);
          setMaterials((current) => current.map((item) => item.file === material.file ? { ...item, content: extractedContent } : item));
        }
        contents.push(content ?? "");
        combineIntakeMaterials([title.trim(), notes.trim()].filter(Boolean).join("\n\n"), contents);
      }
      const combined = combineIntakeMaterials([title.trim(), notes.trim()].filter(Boolean).join("\n\n"), contents);
      setMaterialText(combined);
      let referenceFileId: string | undefined;
      if (reference) {
        if (referenceUpload.current?.file === reference) referenceFileId = referenceUpload.current.id;
        else {
          setBusy("Mengunggah gambar inspirasi...");
          const form = new FormData(); form.set("file", reference);
          const data = await request("/api/files/upload", form, controller.signal);
          controller.signal.throwIfAborted();
          if (typeof data.data?.fileId !== "string") throw new Error("Gambar referensi belum berhasil diunggah.");
          referenceFileId = data.data.fileId;
          referenceUpload.current = { file: reference, id: referenceFileId! };
        }
      }
      setBusy("AI sedang memahami bahan dan menyiapkan pertanyaan...");
      try {
        const data = await request("/api/presentasi/brief", { materialText: combined, ...(referenceFileId ? { referenceFileId } : {}) }, controller.signal);
        controller.signal.throwIfAborted();
        const next = presentationBriefSchema.safeParse(data.brief);
        if (!next.success) throw new Error("Jawaban AI belum sesuai. Coba lagi atau lanjut atur sendiri.");
        setBrief(next.data); setManual(false); setStep(1);
      } catch (failure) {
        if (!controller.signal.aborted) setCanContinueManually(true);
        throw failure;
      }
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(getErrorMessage(failure)); }
    finally {
      if (mounted.current && !controller.signal.aborted) { setBusy(""); lock.current = false; }
    }
  }

  function answer(id: BriefQuestionId, value: string) { setAnswers((current) => ({ ...current, [id]: value })); setError(""); }
  function nextFromQuestions() {
    if (Object.values(answers).some((value) => !value.trim())) { setError("Isi setiap jawaban, atau pilih salah satu saran."); return; }
    if (!minutes) { setError("Tulis durasi dalam menit, antara 1 dan 180. Contoh: 10 menit."); return; }
    setError(""); setStep(2);
  }
  async function finish() {
    if (lock.current || !brief || !minutes) return;
    lock.current = true; setBusy("Menyiapkan presentasi Anda..."); setError("");
    const prompt = [
      `Buat presentasi berjudul ${topic}.`,
      `Tujuan: ${answers.intent.trim()}. Suasana: ${answers.tone.trim()}.`,
      `Pilihan tampilan pengguna: ${preset.label}. ${preset.description}`,
      `Pertahankan tema ${preset.theme}, arah seni ${preset.artDirection.style}, palet ${preset.palette ?? "bawaan tema"}, dan gerakan ${motion} untuk semua slide.`,
      manual ? "Preferensi diatur sendiri. Belum ada analisis AI atas bahan atau gambar referensi." : `Ringkasan konsultasi AI (periksa terhadap bahan asli): ${brief.summary}`,
      !manual && reference ? "Gunakan pengamatan visual dari ringkasan konsultasi sebagai inspirasi, bukan salinan persis atau sumber fakta." : "",
      "Gunakan hanya fakta yang ada di bahan. Jangan mengarang angka, sumber, hasil, atau kutipan. Tunjukkan keterbatasan bila bahan belum lengkap.",
    ].filter(Boolean).join("\n").slice(0, 4000);
    try {
      await onReady({ deck: seedDeck(preset, topic, manual ? "Menyiapkan cerita dari bahan Anda." : brief.summary, motion), prompt, materialText, audience: answers.audience.trim(), minutes, slideCount });
    } catch (failure) { if (mounted.current) setError(getErrorMessage(failure)); }
    finally { if (mounted.current) { setBusy(""); lock.current = false; } }
  }

  return <main className={styles.intake} aria-busy={!!busy}>
    <header className={styles.topbar}><span className={styles.brand}>PRESENTATION STUDIO</span><button type="button" className={styles.cancel} disabled={step === 3 && !!busy} onClick={() => { abort.current?.abort(); onCancel(); }}><X size={16} /> Batal</button></header>
    <ol className={styles.steps} aria-label="Langkah membuat presentasi">{STEPS.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} data-complete={index < step}><span>{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>
    <section className={styles.content}>
      <div className={styles.heading}><p className={styles.kicker}>LANGKAH {step + 1} DARI 4</p><h1 ref={heading} tabIndex={-1}>{["Mulai dari bahan Anda.", "Sedikit obrolan, lebih tepat sasaran.", "Pilih yang terasa seperti Anda.", "Siap jadi cerita yang menarik."][step]}</h1><p>{["Dokumen, catatan, atau ide yang belum rapi. Kita susun bersama.", "Pilih jawaban yang cocok. Semua saran boleh Anda ubah sendiri.", "Ini contoh tampilan, bukan isi presentasi yang sudah dibuat.", "Periksa pilihan Anda. AI baru menyusun slide setelah Anda menekan tombol di bawah."][step]}</p></div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {busy && <p className={styles.status} role="status"><Loader2 size={17} className={styles.spin} />{busy}</p>}
      {step === 0 && <div className={styles.materialGrid}>
        <div>
          <label className={styles.dropzone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addMaterials(Array.from(event.dataTransfer.files)); }}><Upload size={30} strokeWidth={1.5} /><strong>Letakkan bahan di sini</strong><span>atau pilih beberapa dokumen</span><small>PDF, Word, PowerPoint, teks, atau gambar. Maks. 12 MB per file.</small><input type="file" multiple disabled={!!busy} accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif" onChange={(event) => { addMaterials(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
          {!!materials.length && <ul className={styles.files}>{materials.map((item, index) => <li key={`${item.file.name}:${index}`}><FileText size={17} /><span><strong>{item.file.name}</strong><small>{item.content ? "Sudah dibaca" : "Menunggu persetujuan"} / {(item.file.size / 1048576).toFixed(1)} MB</small></span><button type="button" disabled={!!busy} aria-label={`Hapus ${item.file.name}`} onClick={() => { extracted.current.delete(item.file); setMaterials((current) => current.filter((_, i) => i !== index)); setCanContinueManually(false); }}><X size={16} /></button></li>)}</ul>}
          <label className={styles.field}>Topik atau judul singkat <span>Opsional</span><input value={title} maxLength={120} disabled={!!busy} placeholder="Misalnya: Ide ruang belajar yang lebih nyaman" onChange={(event) => { setTitle(event.target.value); setCanContinueManually(false); }} /></label>
          <label className={styles.field}>Ceritakan bahan atau ide Anda<textarea value={notes} maxLength={Math.max(0, MAX_INTAKE_CHARS - title.length)} disabled={!!busy} rows={5} placeholder="Tempel catatan, hal yang ingin disampaikan, atau jelaskan topik Anda..." onChange={(event) => { setNotes(event.target.value); setCanContinueManually(false); }} /></label>
          <p className={styles.hint}>Gabungan catatan dan teks dokumen maksimal 40.000 karakter. Bahan tidak dipotong diam-diam.</p>
        </div>
        <aside className={styles.aside}><div className={styles.asideIcon}><MessageCircle size={24} /></div><h2>Bahan dulu.<br />Desain menyusul.</h2><p>AI membaca bahan Anda, lalu bertanya tentang penonton, waktu, suasana, dan tujuan.</p><label className={styles.reference}><ImagePlus size={20} /><strong>{reference ? reference.name : "Punya contoh tampilan?"}</strong><span>Tambahkan satu gambar inspirasi, opsional. PNG/JPG, maks. 4 MB.</span><input type="file" accept="image/png,image/jpeg" disabled={!!busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (!["image/png", "image/jpeg"].includes(file.type) || file.size <= 0 || file.size > MAX_REFERENCE_BYTES) { setError("Gunakan gambar referensi PNG/JPG maksimum 4 MB."); return; } setReference(file); setCanContinueManually(false); }} /></label>{reference && <button type="button" className={styles.textButton} disabled={!!busy} onClick={() => { setReference(null); referenceUpload.current = null; setCanContinueManually(false); }}>Hapus gambar inspirasi</button>}<p className={styles.hint}>Gambar dianalisis untuk warna dan suasana, bukan disalin persis. Tidak perlu tautan luar.</p></aside>
        <div className={styles.consent}><label><input type="checkbox" checked={consent} disabled={!!busy} onChange={(event) => setConsent(event.target.checked)} /><span>Saya mengizinkan bahan diunggah dan dikirim ke AI saat menekan lanjut. Pembacaan gambar/OCR dan konsultasi memakai kuota AI. Jangan unggah data rahasia tanpa izin.</span></label><p>Isian belum disimpan sebagai presentasi. Memuat ulang atau membatalkan akan menghilangkan isian; file yang sudah diproses dapat tetap tersimpan di akun.</p></div>
      </div>}
      {step === 1 && brief && <div className={styles.conversation}><div className={styles.bubble}><span>{manual ? "PENGATURAN MANUAL / BUKAN JAWABAN AI" : "RINGKASAN DARI AI"}</span><p>{brief.summary}</p></div><div className={styles.questions}>{brief.questions.map((question, index) => <fieldset key={question.id} className={styles.question}><legend><span>{index + 1}</span>{question.label}</legend><div className={styles.options}>{question.options.map((option) => <button type="button" key={option} aria-pressed={answers[question.id] === option} onClick={() => answer(question.id, option)}>{option}</button>)}</div><label className={styles.custom}>Atau tulis jawaban Anda<input value={answers[question.id]} maxLength={question.id === "audience" ? 200 : 300} onChange={(event) => answer(question.id, event.target.value)} inputMode={question.id === "duration" ? "numeric" : undefined} /></label></fieldset>)}</div></div>}
      {step === 2 && <><div className={styles.gallery}>{DESIGN_PRESETS.map((item) => <button type="button" className={styles.preset} key={item.id} aria-pressed={presetId === item.id} onClick={() => setPresetId(item.id)}><Thumbnail preset={item} title={topic} /><span className={styles.presetLabel}><strong>{item.label}</strong>{presetId === item.id && <Check size={16} />}</span><span className={styles.presetDescription}>{item.description}</span></button>)}</div><fieldset className={styles.motion}><legend>Gerakan slide</legend><p>Tenang juga menarik. Pilihan ini berlaku untuk semua slide.</p><div className={styles.options}>{MOTIONS.map((item) => <button type="button" key={item.id} aria-pressed={motion === item.id} onClick={() => setMotion(item.id)}>{item.label}</button>)}</div></fieldset></>}
      {step === 3 && <div className={styles.review}><div><Thumbnail preset={preset} title={topic} /><p className={styles.hint}>Contoh gaya pilihan Anda. Isi final disusun dari bahan, bukan materi demo.</p></div><div className={styles.reviewDetails}><h2>{topic}</h2><dl><div><dt>Untuk</dt><dd>{answers.audience}</dd></div><div><dt>Waktu</dt><dd>{minutes} menit</dd></div><div><dt>Suasana</dt><dd>{answers.tone}</dd></div><div><dt>Tujuan</dt><dd>{answers.intent}</dd></div><div><dt>Tampilan</dt><dd>{preset.label} / {MOTIONS.find((item) => item.id === motion)?.label}</dd></div></dl><label className={styles.field}>Jumlah slide<input type="number" min={1} max={12} value={slideCount} disabled={!!busy} onChange={(event) => setSlideCount(Number(event.target.value))} /></label><p className={styles.hint}>1-12 slide. Hasil AI tetap perlu ditinjau sebelum digunakan.</p></div></div>}
      <footer className={styles.footer}><div>{step > 0 && <button type="button" disabled={!!busy} className={styles.back} onClick={() => { setError(""); setStep((current) => current - 1); }}><ArrowLeft size={16} /> Kembali</button>}</div><div className={styles.actions}>{step === 0 && canContinueManually && <button type="button" disabled={!!busy} className={styles.back} onClick={() => { setBrief(manualPresentationBrief()); setManual(true); setError(""); setStep(1); }}>Lanjut atur sendiri</button>}<button type="button" className={styles.primary} disabled={!!busy || (step === 3 && (!Number.isInteger(slideCount) || slideCount < 1 || slideCount > 12))} onClick={() => { if (step === 0) void consult(); else if (step === 1) nextFromQuestions(); else if (step === 2) setStep(3); else void finish(); }}>{busy ? <Loader2 size={17} className={styles.spin} /> : step === 0 || step === 3 ? <Sparkles size={17} /> : null}{[canContinueManually ? "Coba konsultasi lagi" : "Lanjut, ngobrol dengan AI", "Lanjut pilih tampilan", "Lihat pilihan saya", "Buat presentasi saya"][step]}{!busy && step !== 3 && <ArrowRight size={16} />}</button></div></footer>
    </section>
  </main>;
}

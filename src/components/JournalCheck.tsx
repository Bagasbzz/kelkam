"use client";

import { useEffect, useId, useRef, useState } from "react";
import { authenticatedFetch } from "@/components/AuthProvider";
import { buildJournalCheckLinks, normalizeJournalDoi, normalizeJournalIssns, parseJournalVerification, safeReferenceUrl, type JournalVerification } from "@/lib/references/journal-check";
import type { JournalVerificationResult, JournalVerificationStatus } from "@/lib/references/journal-verifier";

export interface JournalCheckProps {
  source: {
    id: string;
    doi?: string | null;
    venue?: string | null;
    issn?: string[];
    pdfUrl?: string | null;
    pdfStatus?: string;
    url?: string | null;
    doiUrl?: string | null;
  };
  verification?: JournalVerification;
  onVerificationChange?: (value: JournalVerification | null) => void;
  onDownload?: () => void;
  downloading?: boolean;
}

const linkClass = "inline-block py-1.5 text-blue-700 underline underline-offset-2 break-words focus-visible:outline-2 focus-visible:outline-offset-2";
const buttonClass = "inline-flex min-h-9 items-center rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2";
const verificationLabels: Record<JournalVerificationStatus, string> = {
  verified: "Metadata cocok",
  not_found: "Tidak ditemukan kecocokan",
  unavailable: "Penyedia tidak tersedia; coba lagi nanti",
  manual_required: "Perlu pemeriksaan manual",
  conflict: "Konflik identitas; periksa manual",
};

export default function JournalCheck(props: JournalCheckProps) {
  // Remount the draft when the source or persisted record changes, including a session switch.
  const revision = JSON.stringify([props.source.id, props.source.doi, props.source.doiUrl, props.source.venue, props.source.issn, props.verification]);
  return <JournalCheckEditor key={revision} {...props} />;
}

function JournalCheckEditor({ source, verification, onVerificationChange, onDownload, downloading }: JournalCheckProps) {
  const id = useId();
  const confirmed = parseJournalVerification(verification);
  const [sinta, setSinta] = useState(String(confirmed?.sintaRank || ""));
  const [quartile, setQuartile] = useState(confirmed?.scimagoQuartile || "");
  const [evidence, setEvidence] = useState(confirmed?.evidenceUrl || "");
  const [status, setStatus] = useState("");
  const [automatic, setAutomatic] = useState<JournalVerificationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [automaticError, setAutomaticError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const doi = normalizeJournalDoi(source.doi) || normalizeJournalDoi(source.doiUrl) || normalizeJournalDoi(source.id);
  const issns = normalizeJournalIssns(source.issn);
  const links = buildJournalCheckLinks(source);
  const articleUrl = safeReferenceUrl(source.url);
  const doiUrl = safeReferenceUrl(source.doiUrl);
  const pdfUrl = source.pdfStatus === "verified" ? safeReferenceUrl(source.pdfUrl) : null;

  async function checkAutomatically() {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setChecking(true);
    setAutomatic(null);
    setAutomaticError("");
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await authenticatedFetch("/api/references/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ ...(doi ? { doi } : {}), ...(source.venue?.trim() ? { venue: source.venue.trim().slice(0, 240) } : {}), issn: issns.slice(0, 10) }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || !payload.data) {
        setAutomaticError(response.status === 401 ? "Masuk terlebih dahulu untuk memeriksa metadata."
          : response.status === 429 ? "Terlalu banyak pemeriksaan. Coba lagi nanti."
            : "Pemeriksaan metadata gagal. Coba lagi nanti.");
        return;
      }
      setAutomatic(payload.data as JournalVerificationResult);
    } catch {
      setAutomaticError("Pemeriksaan gagal atau melewati batas waktu. Coba lagi nanti.");
    } finally {
      clearTimeout(timer);
      activeRequest.current = null;
      setChecking(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Disalin.");
    } catch {
      setStatus("Tidak dapat menyalin. Pilih dan salin teks jurnal/ISSN di atas secara manual.");
    }
  }

  function recordVerification() {
    const parsed = parseJournalVerification({
      ...(sinta ? { sintaRank: Number(sinta) } : {}),
      ...(quartile ? { scimagoQuartile: quartile } : {}),
      evidenceUrl: evidence.trim(),
      checkedAt: new Date().toISOString(),
      method: "user",
    });
    if (!parsed) {
      setStatus("Pilih peringkat dan isi tautan bukti HTTPS dari SINTA atau Scimago resmi.");
      return;
    }
    onVerificationChange?.(parsed);
    setStatus("Konfirmasi dikirim. Status tersimpan mengikuti catatan di atas.");
  }

  return (
    <section aria-label="Pemeriksaan jurnal dan akses artikel" className="my-3 min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Jurnal: <span className="select-text break-words">{source.venue?.trim() || "Nama jurnal belum tersedia"}</span></span>
        {source.venue?.trim() && <button type="button" onClick={() => void copy(source.venue!.trim())} className={buttonClass}>Salin nama jurnal</button>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {issns.length ? issns.map((issn) => <span key={issn} className="inline-flex flex-wrap items-center gap-2"><span className="select-text font-mono">ISSN {issn}</span><button type="button" className={buttonClass} aria-label={`Salin ISSN ${issn}`} onClick={() => void copy(issn)}>Salin ISSN</button></span>) : <span>ISSN belum tersedia. Coba pencarian nama jurnal.</span>}
      </div>
      <p className="mt-2">Kecocokan DOI hanya mengonfirmasi rekaman DOI pada penyedia, bukan kualitas karya, akreditasi SINTA, indeks Scopus, atau kuartil jurnal. ISSN/DOAJ tidak membuktikan jurnal Indonesia atau peringkat.</p>
      <div className="mt-3 border-t border-slate-200 pt-3">
        <button type="button" onClick={() => void checkAutomatically()} disabled={checking || (!doi && !issns.length && !source.venue?.trim())} className={buttonClass}>{checking ? "Memeriksa metadata..." : "Periksa metadata otomatis"}</button>
        <p className="mt-2">Hasil otomatis hanya sementara di tampilan ini, tidak disimpan dan tidak mengubah catatan manual. SINTA, Scopus, dan kuartil selalu perlu pemeriksaan manual.</p>
        <div role="status" aria-live="polite" aria-busy={checking} className="mt-2">
          {checking && <p>Menghubungi Crossref, OpenAlex, dan DOAJ...</p>}
          {automaticError && <p className="text-red-700">{automaticError}</p>}
          {automatic && <>
            <p className="font-semibold">{verificationLabels[automatic.status]}. Keyakinan: {{ high: "tinggi", medium: "sedang", low: "rendah" }[automatic.confidence]}. Dicek: {automatic.checkedAt}.</p>
            <p>Crossref: {verificationLabels[automatic.crossref.status]}. OpenAlex: {verificationLabels[automatic.openAlex.status]}. DOAJ langsung: {verificationLabels[automatic.doaj.status]}.</p>
            <p>Penerbit: {automatic.crossref.publisher || "Belum tersedia"}. Tipe karya: {automatic.crossref.type || "Belum tersedia"}.</p>
            {automatic.crossref.title && <p>Judul karya: {automatic.crossref.title}</p>}
            <p>Venue hasil: {automatic.crossref.venue || automatic.openAlex.venue || automatic.doaj.venue || "Belum tersedia"}. ISSN hasil: {Array.from(new Set([...automatic.crossref.issn, ...automatic.openAlex.issn, ...automatic.doaj.issn])).join(", ") || "Belum tersedia"}.</p>
            <p>{automatic.doaj.status === "verified" ? "DOAJ langsung: ISSN cocok dengan identifier jurnal dalam respons DOAJ."
              : "Belum ada konfirmasi langsung dari DOAJ; ini tidak membuktikan jurnal tidak terindeks."} {automatic.openAlex.inDoaj === undefined ? "Indikator DOAJ dari OpenAlex belum tersedia."
                : `Indikator DOAJ menurut OpenAlex: ${automatic.openAlex.inDoaj ? "ya" : "tidak"} (bukan konfirmasi langsung DOAJ).`}</p>
            {automatic.conflicts.map((conflict) => <p key={conflict} className="text-amber-800">{conflict}</p>)}
            <div className="mt-2 flex flex-wrap gap-3">{automatic.sources.map((entry) => {
              const url = safeReferenceUrl(entry.url);
              return url ? <a key={entry.provider} href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>Sumber {entry.provider}</a> : null;
            })}</div>
          </>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 font-semibold">
        {articleUrl && <a href={articleUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>Halaman artikel</a>}
        {doiUrl && <a href={doiUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>DOI artikel</a>}
        {pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>Buka PDF</a>}
        {pdfUrl && onDownload && <button type="button" className={buttonClass} onClick={onDownload} disabled={downloading}>{downloading ? "Menyiapkan PDF..." : "Unduh PDF"}</button>}
      </div>
      {!pdfUrl && <p className="mt-2 text-slate-500">PDF langsung belum terverifikasi. Periksa tombol PDF di halaman artikel atau akses melalui perpustakaan.</p>}
      <p className="mt-2 font-medium">
        {confirmed ? `Konfirmasi pengguna (bukan otomatis): ${[confirmed.sintaRank ? `SINTA ${confirmed.sintaRank}` : "", confirmed.scimagoQuartile ? `Scimago ${confirmed.scimagoQuartile}` : ""].filter(Boolean).join("; ")}. Dicek ${confirmed.checkedAt.slice(0, 10)}.` : "Peringkat jurnal belum dikonfirmasi pengguna."}
        {confirmed?.evidenceUrl && <> <a href={confirmed.evidenceUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>Bukti resmi</a></>}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer py-2 font-semibold focus-visible:outline-2">Cek &amp; catat peringkat jurnal</summary>
        <p className="mt-2">Coba setiap ISSN dan judul secara terpisah. Jika pencarian resmi kosong, gunakan Google domain resmi. Cocokkan nama, ISSN, tahun akreditasi, serta tahun/kategori kuartil; hasil pencarian bukan bukti peringkat atau indeks Scopus.</p>
        <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
          {links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className={linkClass}>{link.label}</a>)}
        </div>
        {!links.length && <p className="mt-2">Nama jurnal dan ISSN belum tersedia; periksa metadata di halaman penerbit terlebih dahulu.</p>}
        {onVerificationChange && <fieldset className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <legend className="font-semibold">Catatan pemeriksaan manual</legend>
          <div className="flex flex-wrap gap-3">
            <label htmlFor={`${id}-sinta`} className="flex items-center gap-2">SINTA
              <select id={`${id}-sinta`} value={sinta} onChange={(event) => setSinta(event.target.value)} className="rounded border bg-white p-1">
                <option value="">Belum dicatat</option>
                {[1, 2, 3, 4, 5, 6].map((rank) => <option key={rank} value={rank}>SINTA {rank}</option>)}
              </select>
            </label>
            <label htmlFor={`${id}-quartile`} className="flex items-center gap-2">Scimago
              <select id={`${id}-quartile`} value={quartile} onChange={(event) => setQuartile(event.target.value as typeof quartile)} className="rounded border bg-white p-1">
                <option value="">Belum dicatat</option>
                {["Q1", "Q2", "Q3", "Q4"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <label htmlFor={`${id}-evidence`} className="block">Tautan bukti resmi (wajib untuk mencatat)</label>
          <input id={`${id}-evidence`} type="url" value={evidence} maxLength={2048} onChange={(event) => setEvidence(event.target.value)} placeholder="https://sinta.kemdiktisaintek.go.id/journals/..." aria-describedby={`${id}-evidence-help`} className="w-full min-w-0 rounded border bg-white p-2" />
          <p id={`${id}-evidence-help`}>Gunakan halaman jurnal di SINTA/Scimago, bukan tautan Google. Catatan ini adalah pernyataan Anda, tidak diperiksa otomatis oleh aplikasi.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={recordVerification}>Saya sudah cek, catat peringkat</button>
            {confirmed && <button type="button" className={buttonClass} onClick={() => { onVerificationChange(null); setStatus("Permintaan hapus konfirmasi dikirim."); }}>Hapus konfirmasi</button>}
          </div>
        </fieldset>}
      </details>
      <p role="status" aria-live="polite" className="mt-2 empty:mt-0">{status}</p>
    </section>
  );
}

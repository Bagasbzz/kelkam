"use client";

import { useId, useState } from "react";
import { buildJournalCheckLinks, normalizeJournalIssns, parseJournalVerification, safeReferenceUrl, type JournalVerification } from "@/lib/references/journal-check";

export interface JournalCheckProps {
  source: {
    id: string;
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

const linkClass = "text-blue-700 underline underline-offset-2 break-words focus-visible:outline-2 focus-visible:outline-offset-2";
const buttonClass = "rounded border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2";

export default function JournalCheck(props: JournalCheckProps) {
  // Remount the draft when the source or persisted record changes, including a session switch.
  const revision = JSON.stringify([props.source.id, props.source.venue, props.source.issn, props.verification]);
  return <JournalCheckEditor key={revision} {...props} />;
}

function JournalCheckEditor({ source, verification, onVerificationChange, onDownload, downloading }: JournalCheckProps) {
  const id = useId();
  const confirmed = parseJournalVerification(verification);
  const [sinta, setSinta] = useState(String(confirmed?.sintaRank || ""));
  const [quartile, setQuartile] = useState(confirmed?.scimagoQuartile || "");
  const [evidence, setEvidence] = useState(confirmed?.evidenceUrl || "");
  const [status, setStatus] = useState("");
  const issns = normalizeJournalIssns(source.issn);
  const links = buildJournalCheckLinks(source);
  const articleUrl = safeReferenceUrl(source.url);
  const doiUrl = safeReferenceUrl(source.doiUrl);
  const pdfUrl = source.pdfStatus === "verified" ? safeReferenceUrl(source.pdfUrl) : null;

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
      <p className="mt-2">DOI valid hanya memvalidasi artikel, bukan akreditasi SINTA, indeks Scopus, atau kuartil jurnal. ISSN/DOAJ tidak membuktikan jurnal Indonesia atau peringkat.</p>
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
        <summary className="cursor-pointer font-semibold focus-visible:outline-2">Cek &amp; catat peringkat jurnal</summary>
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

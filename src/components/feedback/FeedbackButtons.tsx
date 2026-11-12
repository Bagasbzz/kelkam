"use client";

/** Tombol 👍/👎 untuk satu jawaban AI (Tahap 3). Komentar opsional muncul setelah 👎. */
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { authenticatedFetch } from "@/components/AuthProvider";

export default function FeedbackButtons({ feature, targetId }: { feature: "laporan" | "presentasi"; targetId: string }) {
  const [rating, setRating] = useState<1 | -1 | 0>(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);

  async function send(value: 1 | -1, note = "") {
    setRating(value);
    await authenticatedFetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature, targetId, rating: value, comment: note }),
    }).catch(() => undefined);
    if (note) setSent(true);
  }

  const button = (value: 1 | -1, label: string, Icon: typeof ThumbsUp) => (
    <button type="button" aria-label={label} aria-pressed={rating === value} onClick={() => void send(value)}
      className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${rating === value ? "bg-slate-900 text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}>
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="-ml-2.5 mt-1 flex flex-wrap items-center gap-0.5 text-xs text-slate-400">
      {button(1, "Jawaban ini membantu", ThumbsUp)}
      {button(-1, "Jawaban ini kurang membantu", ThumbsDown)}
      {rating === 1 && <span>Terima kasih.</span>}
      {rating === -1 && !sent && (
        <form className="flex w-full items-center gap-1.5 sm:w-auto" onSubmit={(e) => { e.preventDefault(); void send(-1, comment.trim()); }}>
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Apa yang kurang? (opsional)" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-base text-slate-700 sm:w-64 sm:flex-none sm:text-xs" />
          <button type="submit" className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:text-xs">Kirim</button>
        </form>
      )}
      {rating === -1 && sent && <span>Masukan tersimpan, terima kasih.</span>}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ResearchBrief } from "@/lib/types/research-project";
import { authenticatedFetch } from "@/components/AuthProvider";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface FollowupQuestion {
  id: string;
  field: string;
  text: string;
}

export default function ResearchChat({
  projectId,
  brief,
  onUpdateBrief,
}: {
  projectId?: string | null;
  brief?: Partial<ResearchBrief>;
  onUpdateBrief?: (patch: Partial<ResearchBrief>) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [followups, setFollowups] = useState<FollowupQuestion[]>([]);
  const [summary, setSummary] = useState("");

  const savePatchLocally = (patch: Partial<ResearchBrief>) => {
    try {
      const key = `research_brief_${projectId || "local"}`;
      const raw = localStorage.getItem(key);
      const existing = raw ? JSON.parse(raw) : {};
      const next = { ...(existing || {}), ...patch, updatedAt: new Date().toISOString() };
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore local save errors
    }
  };

  const send = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { id: `u_${Date.now()}`, role: "user", content: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const response = await authenticatedFetch("/api/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          brief: brief || {},
          messages: [...messages, userMsg].map((x) => ({ role: x.role, content: x.content })),
        }),
      });
      const data = await response.json();
      if (data?.success && data?.data) {
        const { patch, summary: s, followupQuestions } = data.data;
        setSummary(s || "");
        setFollowups(followupQuestions || []);

        if (patch && Object.keys(patch).length) {
          if (onUpdateBrief) {
            onUpdateBrief(patch);
          } else {
            savePatchLocally(patch);
          }
        }

        const assistantMsg: Message = { id: `a_${Date.now()}`, role: "assistant", content: s || (data.raw ? String(data.raw).slice(0, 800) : "Balasan AI") };
        setMessages((m) => [...m, assistantMsg]);
      } else {
        const assistantMsg: Message = { id: `a_${Date.now()}`, role: "assistant", content: data?.error || "Gagal memproses." };
        setMessages((m) => [...m, assistantMsg]);
      }
    } catch {
      setMessages((m) => [...m, { id: `a_${Date.now()}`, role: "assistant", content: "Error jaringan" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg">
      <div className="mb-3">
        <div className="text-sm font-bold">Chat Konsultasi Akademik</div>
        <div className="text-xs text-slate-500">Bicarakan kebutuhan laporan. AI akan mengajukan pertanyaan jika perlu.</div>
      </div>

      <div className="h-64 overflow-auto border rounded p-2 mb-3 bg-white">
        {messages.length === 0 && (
          <p className="p-4 text-center text-sm text-slate-400">
            Ceritakan kebutuhan, aturan dosen, bahan yang sudah ada, dan bagian yang masih membingungkan.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`mb-2 ${m.role === "user" ? "text-right" : "text-left"}`}>
            <div className={`inline-block p-2 rounded ${m.role === "user" ? "bg-blue-100" : "bg-gray-100"}`}>{m.content}</div>
          </div>
        ))}
      </div>

      <div className="mb-3">
        <label htmlFor="research-chat-input" className="sr-only">Pesan konsultasi akademik</label>
        <textarea
          id="research-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4_000}
          className="w-full p-2 border rounded"
          placeholder="Tulis kebutuhan, aturan dosen, bahan mentah, atau keputusan yang perlu dibahas"
        />
        <p className="mt-1 text-right text-[10px] text-slate-400">{input.length}/4000</p>
      </div>

      <div className="flex gap-2">
        <button onClick={send} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">{loading ? "Mengirim..." : "Kirim & Brainstorm"}</button>
        <button onClick={() => { setMessages([]); setFollowups([]); setSummary(""); }} className="px-4 py-2 border rounded">Reset</button>
      </div>

      {summary && <div className="mt-3 p-2 bg-green-50 border-l-4 border-green-400"><div className="font-bold">Ringkasan singkat</div><div className="text-sm">{summary}</div></div>}

      {followups.length > 0 && (
        <div className="mt-3">
          <div className="font-bold mb-2">Pertanyaan lanjutan</div>
          <ul className="list-disc pl-5">
            {followups.map((q) => (
              <li key={q.id} className="mb-2">
                <div className="mb-1">{q.text}</div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setInput(`Jawaban untuk "${q.text}": `)} className="px-3 py-1 border rounded text-sm">Jawab</button>
                  <button type="button" onClick={() => setFollowups((items) => items.filter((item) => item.id !== q.id))} className="px-3 py-1 border rounded text-sm">Lewati</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

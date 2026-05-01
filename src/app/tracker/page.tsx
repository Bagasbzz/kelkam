"use client";

import { useState, useEffect } from "react";
import { 
  BarChart3, 
  CheckCircle2, 
  Plus, 
  Trash2, 
  MessageSquare, 
  TrendingUp, 
  Trophy,
  LayoutDashboard
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";

type ProgressStatus = "Belum mulai" | "Sedang dikerjakan" | "Selesai";

interface ChapterProgress {
  id: string;
  name: string;
  status: ProgressStatus;
}

interface Task {
  id: string;
  text: string;
  completed: boolean;
}

interface Revision {
  id: string;
  note: string;
  status: "Belum dikerjakan" | "Sudah dikerjakan";
}

const INITIAL_CHAPTERS: ChapterProgress[] = [
  { id: "1", name: "Judul Disetujui", status: "Belum mulai" },
  { id: "2", name: "BAB 1 Pendahuluan", status: "Belum mulai" },
  { id: "3", name: "BAB 2 Tinjauan Pustaka", status: "Belum mulai" },
  { id: "4", name: "BAB 3 Metodologi", status: "Belum mulai" },
  { id: "5", name: "BAB 4 Hasil dan Pembahasan", status: "Belum mulai" },
  { id: "6", name: "BAB 5 Kesimpulan", status: "Belum mulai" },
];

export default function TrackerPage() {
  const [chapters, setChapters] = useState<ChapterProgress[]>(INITIAL_CHAPTERS);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [newTask, setNewTask] = useState("");
  const [newRevision, setNewRevision] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const savedChapters = localStorage.getItem("thesis_chapters");
    const savedTasks = localStorage.getItem("thesis_tasks");
    const savedRevisions = localStorage.getItem("thesis_revisions");

    if (savedChapters) setChapters(JSON.parse(savedChapters));
    if (savedTasks) setTasks(JSON.parse(savedTasks));
    if (savedRevisions) setRevisions(JSON.parse(savedRevisions));
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem("thesis_chapters", JSON.stringify(chapters));
    localStorage.setItem("thesis_tasks", JSON.stringify(tasks));
    localStorage.setItem("thesis_revisions", JSON.stringify(revisions));
  }, [chapters, tasks, revisions, isMounted]);

  const updateChapterStatus = (id: string, status: ProgressStatus) => {
    setChapters(prev => prev.map(ch => ch.id === id ? { ...ch, status } : ch));
  };

  const addTask = () => {
    if (!newTask.trim()) return;
    const task: Task = { id: Date.now().toString(), text: newTask, completed: false };
    setTasks(prev => [...prev, task]);
    setNewTask("");
  };

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const addRevision = () => {
    if (!newRevision.trim()) return;
    const revision: Revision = { id: Date.now().toString(), note: newRevision, status: "Belum dikerjakan" };
    setRevisions(prev => [...prev, revision]);
    setNewRevision("");
  };

  const toggleRevision = (id: string) => {
    setRevisions(prev => prev.map(r => r.id === id ? { ...r, status: r.status === "Belum dikerjakan" ? "Sudah dikerjakan" : "Belum dikerjakan" } : r));
  };

  const deleteRevision = (id: string) => {
    setRevisions(prev => prev.filter(r => r.id !== id));
  };

  const completedChaptersCount = chapters.filter(ch => ch.status === "Selesai").length;
  const progressPercentage = Math.round((completedChaptersCount / chapters.length) * 100);

  const getMotivation = () => {
    if (progressPercentage === 100) return "Luar biasa! Skripsi Anda telah selesai. Siap Sidang!";
    if (progressPercentage >= 80) return "Hampir sampai! Selesaikan bagian terakhir dengan semangat.";
    if (progressPercentage >= 50) return "Bagus! Anda sudah melewati setengah perjalanan skripsi.";
    if (progressPercentage > 0) return "Awal yang baik! Teruslah konsisten mengerjakan bab demi bab.";
    return "Mulai langkah pertama Anda hari ini. Semangat menabung data!";
  };

  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans">
      <Navbar />
      <div className="max-w-6xl mx-auto px-6 py-24">
        {/* Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 rounded-2xl border border-blue-100 shrink-0">
              <LayoutDashboard className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Progress Tracker</h1>
          </div>
          
          <Card padding="sm" className="flex items-center gap-4 bg-white border border-slate-200 shadow-sm self-start md:self-auto">
            <div className={`p-3 rounded-full shrink-0 ${progressPercentage === 100 ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="text-2xl font-black">{progressPercentage}%</div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Progress</div>
            </div>
          </Card>
        </div>

        {/* Motivation Card minimal white/blue */}
        <div className="mb-10 bg-white border border-blue-100 rounded-[2rem] md:rounded-[2.5rem] p-8 md:p-12 text-slate-800 shadow-xl shadow-blue-50 flex flex-col lg:flex-row items-center justify-between gap-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full blur-[80px] -mr-20 -mt-20 pointer-events-none" />
          
          <div className="relative z-10 max-w-xl text-center lg:text-left">
            <h2 className="text-2xl md:text-3xl font-extrabold mb-4 flex flex-col lg:flex-row items-center gap-3 text-slate-900">
              <Trophy className="w-8 h-8 text-blue-500 shrink-0" />
              {getMotivation()}
            </h2>
            <p className="text-slate-500 font-medium text-sm md:text-base leading-relaxed">
              Setiap kata yang Anda tulis hari ini membawa Anda lebih dekat ke meja hijau. Jangan menyerah!
            </p>
          </div>
          
          <div className="relative z-10 w-full lg:w-72 bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
             <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-3 text-slate-400">
               <span>Pencapaian</span>
               <span className="text-blue-600">{completedChaptersCount}/{chapters.length} Bab</span>
             </div>
             <div className="w-full bg-slate-100 rounded-full h-3">
               <div className="bg-blue-500 rounded-full h-full transition-all duration-1000 shadow-sm" style={{ width: `${progressPercentage}%` }} />
             </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-8">
          {/* Left: Progress Checklist */}
          <div className="lg:col-span-5 space-y-6">
            <Card padding="none" className="border border-slate-200 shadow-sm">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2 uppercase text-sm tracking-widest text-slate-700">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  Alur Skripsi
                </h3>
              </div>
              <div className="p-8 space-y-6">
                {chapters.map(ch => (
                  <div key={ch.id} className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <span className={`text-sm font-bold uppercase tracking-tight ${ch.status === 'Selesai' ? 'text-green-600' : 'text-slate-700'}`}>
                        {ch.name}
                      </span>
                      {ch.status === 'Selesai' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    </div>
                    <div className="flex gap-2 p-1.5 bg-slate-50 rounded-2xl border border-slate-100">
                      {(["Belum mulai", "Sedang dikerjakan", "Selesai"] as ProgressStatus[]).map(s => (
                        <button
                          key={s}
                          onClick={() => updateChapterStatus(ch.id, s)}
                          className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all
                            ${ch.status === s 
                              ? (s === 'Selesai' ? 'bg-green-500 text-white shadow-sm' : s === 'Sedang dikerjakan' ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-800 text-white shadow-sm')
                              : 'text-slate-400 hover:text-slate-600 hover:bg-white'
                            }`}
                        >
                          {s === 'Belum mulai' ? 'Mulai' : s === 'Sedang dikerjakan' ? 'Proses' : 'Selesai'}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-8">
            <Card padding="none" className="border border-slate-200 shadow-sm">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2 uppercase text-sm tracking-widest text-slate-700">
                  <CheckCircle2 className="w-5 h-5 text-blue-500" />
                  Daftar Tugas
                </h3>
                <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-3 py-1 rounded-full uppercase tracking-widest">
                  {tasks.filter(t => !t.completed).length} Aktif
                </span>
              </div>
              <div className="p-8">
                <div className="flex gap-2 mb-8">
                  <Input
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTask()}
                    placeholder="Tambah tugas (Cari jurnal, revisi bab 1, dll)..."
                    className="bg-white border-slate-200 focus:border-blue-400"
                  />
                  <Button onClick={addTask} size="md" className="h-[56px] w-[56px] p-0 shadow-sm" variant="primary" icon={Plus} />
                </div>

                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2 scrollbar-thin">
                  {tasks.map(task => (
                    <div key={task.id} className="group flex items-center gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-all border border-transparent hover:border-slate-100">
                      <button 
                        onClick={() => toggleTask(task.id)}
                        className={`shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all
                          ${task.completed ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 bg-white'}`}
                      >
                        {task.completed && <CheckCircle2 className="w-4 h-4" />}
                      </button>
                      <span className={`flex-1 text-sm font-medium ${task.completed ? 'line-through text-slate-300' : 'text-slate-700'}`}>
                        {task.text}
                      </span>
                      <button 
                        onClick={() => deleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {tasks.length === 0 && (
                    <div className="text-center py-12 text-slate-400 font-medium">Belum ada tugas...</div>
                  )}
                </div>
              </div>
            </Card>

            <Card padding="none" className="border border-slate-200 shadow-sm">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2 uppercase text-sm tracking-widest text-slate-700">
                  <MessageSquare className="w-5 h-5 text-blue-500" />
                  Catatan Revisi
                </h3>
              </div>
              <div className="p-8">
                <div className="flex gap-2 mb-8 items-end">
                  <Textarea
                    value={newRevision}
                    onChange={(e) => setNewRevision(e.target.value)}
                    placeholder="Instruksi dari dosen pembimbing..."
                    className="h-24 bg-white border-slate-200 focus:border-blue-400"
                  />
                  <Button onClick={addRevision} size="md" className="h-[56px] w-[56px] p-0 shadow-sm" variant="primary" icon={Plus} />
                </div>

                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                  {revisions.map(rev => (
                    <div 
                      key={rev.id} 
                      className={`group p-6 rounded-[2rem] border transition-all relative
                        ${rev.status === 'Sudah dikerjakan' 
                          ? 'bg-slate-50 border-slate-200 opacity-60' 
                          : 'bg-blue-50/30 border-blue-100/50 shadow-sm'}`}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full
                          ${rev.status === 'Sudah dikerjakan' ? 'bg-slate-200 text-slate-500' : 'bg-blue-100 text-blue-600'}`}>
                          {rev.status}
                        </span>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => toggleRevision(rev.id)}
                            className={`p-1.5 rounded-lg transition-all ${rev.status === 'Sudah dikerjakan' ? 'text-slate-300' : 'text-blue-600 hover:bg-blue-100'}`}
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => deleteRevision(rev.id)}
                            className="p-1.5 text-slate-300 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className={`text-sm font-medium leading-relaxed ${rev.status === 'Sudah dikerjakan' ? 'text-slate-400 italic line-through' : 'text-slate-700'}`}>
                        {rev.note}
                      </p>
                    </div>
                  ))}
                  {revisions.length === 0 && (
                    <div className="text-center py-12 text-slate-400 font-medium">Belum ada revisi...</div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

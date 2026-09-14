"use client";

import React, { useState } from 'react';
import { BookOpen, CheckCircle2, ClipboardCopy, Loader2, Sparkles, MessageSquare, ListTree, FileText } from 'lucide-react';
import styles from './synthesizer.module.css';
import { authenticatedFetch } from "@/components/AuthProvider";

type DataType = 'kuesioner' | 'wawancara' | 'observasi';

export default function DataSynthesizerPage() {
  const [dataType, setDataType] = useState<DataType>('kuesioner');
  const [topic, setTopic] = useState('');
  const [rawData, setRawData] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [error, setError] = useState('');

  const injectExampleData = () => {
    if (dataType === 'kuesioner') {
      setTopic('Analisis Kepuasan Pengguna E-Learning Kampus');
      setRawData(`1;Sangat Puas;Akses cepat\n2;Puas;Materi lumayan lengkap tapi kadang lemot\n3;Tidak Puas;Sering down saat mau ujian\n4;Puas;UI nya gampang dipahami\n5;Sangat Tidak Puas;Banyak bug saat upload tugas`);
    } else if (dataType === 'wawancara') {
      setTopic('Dampak Game Online Terhadap Minat Belajar Mahasiswa');
      setRawData(`Informan 1 (Budi): "Ya kalau lagi suntuk nugas mabar aja mas, cuma kadang suka kelewat waktu sampe pagi, besoknya ngantuk di kelas."\nInforman 2 (Siti): "Gak ngaruh sih mas kalau pinter bagi waktu. Aku main game cuma weekend."\nInforman 3 (Andi): "Jujur IPK aku turun semester ini gara-gara push rank tiap malem. Mau berhenti tapi susah."`);
    } else {
      setTopic('Aktivitas Mahasiswa di Perpustakaan Pusat');
      setRawData(`- Pukul 09.00: Sekitar 20 orang masuk, dominan duduk di area wifi, tidak banyak yang ke rak buku.\n- Pukul 11.00: Meja diskusi penuh, ada 3 kelompok sedang rapat tugas.\n- Pukul 14.00: Beberapa mahasiswa terlihat tidur di kursi baca pojok.\n- Mayoritas mahasiswa membawa laptop sendiri dan hanya meminjam buku sebagai syarat pendaftaran judul skripsi.`);
    }
  };

  const handleGenerate = async () => {
    if (!topic || !rawData) {
      setError('Mohon isi Judul/Topik dan Data Mentah terlebih dahulu.');
      return;
    }
    setError('');
    setIsGenerating(true);
    setResult('');

    try {
      const response = await authenticatedFetch('/api/ai/synthesize-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          dataType,
          rawData
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || 'Gagal menghasilkan laporan.');
      }
    } catch (err) {
      console.error(err);
      setError('Terjadi kesalahan jaringan.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAction = async (actionType: string) => {
    if (!result) return;
    setIsGenerating(true);
    setError('');

    try {
      const response = await authenticatedFetch('/api/ai/synthesize-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          dataType,
          actionType,
          previousResult: result
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || 'Gagal mengubah laporan.');
      }
    } catch (err) {
      console.error(err);
      setError('Terjadi kesalahan jaringan.');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  // Helper to render simple markdown-like text
  const renderFormattedText = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) return <h3 key={i}>{line.replace('### ', '')}</h3>;
      if (line.startsWith('## ')) return <h2 key={i}>{line.replace('## ', '')}</h2>;
      if (line.startsWith('# ')) return <h1 key={i}>{line.replace('# ', '')}</h1>;
      if (line.startsWith('- ')) return <li key={i}>{line.replace('- ', '')}</li>;
      if (line.trim() === '') return <br key={i} />;
      
      // Handle bold
      const boldRegex = /\*\*(.*?)\*\*/g;
      if (boldRegex.test(line)) {
        const parts = line.split(boldRegex);
        return (
          <p key={i}>
            {parts.map((part, j) => (j % 2 === 1 ? <strong key={j}>{part}</strong> : part))}
          </p>
        );
      }
      return <p key={i}>{line}</p>;
    });
  };

  return (
    <div className={styles.pageContainer}>
      <main className={styles.mainContent}>
        <div className={styles.hero}>
          <h1>Data Synthesizer</h1>
          <p>Olah data mentah kuesioner, transkrip wawancara, atau catatan observasi menjadi draf narasi laporan yang siap dipakai.</p>
        </div>

        <div className={styles.card}>
          <div className={styles.inputSection}>
            <div className={styles.tabs}>
              <button 
                className={`${styles.tabBtn} ${dataType === 'kuesioner' ? styles.active : ''}`}
                onClick={() => setDataType('kuesioner')}
              >
                <ListTree size={18} /> Kuesioner
              </button>
              <button 
                className={`${styles.tabBtn} ${dataType === 'wawancara' ? styles.active : ''}`}
                onClick={() => setDataType('wawancara')}
              >
                <MessageSquare size={18} /> Wawancara
              </button>
              <button 
                className={`${styles.tabBtn} ${dataType === 'observasi' ? styles.active : ''}`}
                onClick={() => setDataType('observasi')}
              >
                <BookOpen size={18} /> Observasi
              </button>
            </div>

            <div className="flex justify-between items-center mt-4 mb-2">
              <h3 className="text-sm font-bold text-slate-700">Form Data</h3>
              <button 
                onClick={injectExampleData}
                className="text-xs flex items-center gap-1 font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                title="Bingung isi apa? Klik untuk melihat contoh"
              >
                <Sparkles size={14} /> Isi Contoh Data
              </button>
            </div>

            <div className={styles.formArea}>
              {error && (
                <div style={{ padding: '10px', background: '#fee2e2', color: '#b91c1c', borderRadius: '8px', fontSize: '0.9rem' }}>
                  {error}
                </div>
              )}
              <div className={styles.inputGroup}>
                <label>Judul / Topik Penelitian</label>
                <input 
                  type="text" 
                  placeholder="Misal: Analisis Kepuasan Pengguna E-Learning" 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>

              <div className={styles.inputGroup} style={{ flex: 1 }}>
                <label>
                  Data Mentah
                  <span className={styles.help}>
                    {dataType === 'kuesioner' && 'Paste data CSV/Excel dari Google Form.'}
                    {dataType === 'wawancara' && 'Paste transkrip wawancara mentah.'}
                    {dataType === 'observasi' && 'Paste catatan acak dari lapangan.'}
                  </span>
                </label>
                <textarea 
                  placeholder={
                    dataType === 'kuesioner' ? "1;Sangat Puas;Cepat\n2;Puas;Lambat..." :
                    dataType === 'wawancara' ? "Informan 1: Iya mas, kadang aplikasinya sering error kalau malem...\nInforman 2: Menurut saya sih bagus, cuma UI nya kurang..." :
                    "Senin, 10 Pagi: Antrean panjang di loket pendaftaran. Mahasiswa kebingungan mengisi form offline..."
                  }
                  value={rawData}
                  onChange={(e) => setRawData(e.target.value)}
                />
              </div>

              <button 
                className={styles.primaryBtn} 
                onClick={handleGenerate}
                disabled={isGenerating || !topic || !rawData}
              >
                {isGenerating ? (
                  <><Loader2 className={styles.spinner} size={20} /> Memproses Data...</>
                ) : (
                  <><Sparkles size={20} /> Generate Laporan</>
                )}
              </button>
            </div>
          </div>

          <div className={styles.outputSection}>
            <div className={styles.outputHeader}>
              <div className={styles.outputTitle}>
                <FileText size={18} /> Hasil Sintesis Laporan
              </div>
              <button className={styles.copyBtn} onClick={copyToClipboard} disabled={!result}>
                {copySuccess ? <CheckCircle2 size={16} color="#16a34a" /> : <ClipboardCopy size={16} />}
                {copySuccess ? 'Tersalin!' : 'Copy'}
              </button>
            </div>
            
            <div className={styles.outputContent}>
              {!result && !isGenerating && (
                <div className={styles.emptyState}>
                  <BookOpen size={48} opacity={0.2} />
                  <p>Hasil pengolahan data akan muncul di sini.<br/>Silakan isi data mentah di sebelah kiri.</p>
                </div>
              )}
              {isGenerating && (
                <div className={styles.emptyState}>
                  <Loader2 className={styles.spinner} size={40} color="#4f46e5" />
                  <p>AI sedang menganalisis dan menyusun narasi akademis...</p>
                </div>
              )}
              {result && (
                <div className={styles.markdownBody}>
                  {renderFormattedText(result)}
                </div>
              )}
            </div>
            
            {result && !isGenerating && (
              <div className="flex flex-wrap gap-2 mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span className="w-full text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Aksi Lanjutan:</span>
                <button className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 text-sm font-medium rounded-lg border border-slate-200 hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm" onClick={() => handleAction('expand')}>
                  <Sparkles size={14} /> Perpanjang Narasi
                </button>
                <button className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 text-sm font-medium rounded-lg border border-slate-200 hover:border-indigo-400 hover:text-indigo-600 transition-all shadow-sm" onClick={() => handleAction('formalize')}>
                  <BookOpen size={14} /> Bahasa Lebih Formal
                </button>
                <button className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 text-sm font-medium rounded-lg border border-slate-200 hover:border-amber-400 hover:text-amber-600 transition-all shadow-sm" onClick={() => handleAction('summarize_table')}>
                  <ListTree size={14} /> Buat Tabel Ringkasan
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

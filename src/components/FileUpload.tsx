"use client";

import { useState } from 'react';
import { Upload, File, X, CheckCircle2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Link from 'next/link';
import { authenticatedFetch } from "@/components/AuthProvider";
import { getErrorMessage } from '@/lib/errors';

interface FileUploadProps {
  onSuccess?: (content: unknown) => void;
  endpoint?: string;
  ctaLabel?: string;
  successTitle?: string;
  successDescription?: string;
}

const MAX_DOCX_BYTES = 20 * 1024 * 1024;

function validateDocx(file: File) {
  if (!file.name.toLowerCase().endsWith('.docx')) return 'Format file harus .docx';
  if (file.size > MAX_DOCX_BYTES) return 'Ukuran file maksimal 20 MB';
  return null;
}

export default function FileUpload({
  onSuccess,
  endpoint = '/api/fix-format',
  ctaLabel = 'PERBAIKI SEKARANG',
  successTitle = 'Selesai diperbaiki!',
  successDescription = 'File Anda sudah otomatis terunduh dengan format yang sudah rapi.',
}: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      const validationError = validateDocx(droppedFile);
      if (!validationError) {
        setFile(droppedFile);
      } else {
        setError(validationError);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccess(false);

    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const validationError = validateDocx(selectedFile);
      if (!validationError) {
        setFile(selectedFile);
      } else {
        setError(validationError);
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : null;
        throw new Error(data?.error || 'Gagal memproses dokumen.');
      }

      if (onSuccess) {
        const data = await response.json();
        setSuccess(true);
        setFile(null);
        onSuccess(data);
      } else {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rapi-${file.name}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        setSuccess(true);
        setFile(null);
      }
    } catch (uploadError: unknown) {
      setError(getErrorMessage(uploadError, 'Terjadi kesalahan.'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {!success ? (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div 
            className={`relative group flex flex-col items-center justify-center w-full h-80 p-8 border-4 border-dashed rounded-[2.5rem] transition-all duration-300 ${file ? 'border-blue-500 bg-blue-50/20' : 'border-gray-100 bg-gray-50/50 hover:border-blue-200 hover:bg-blue-50/10'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {!file ? (
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 bg-white shadow-xl rounded-3xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Pilih File Dokumen</h3>
                <p className="text-gray-400 text-sm font-medium">Seret file .docx ke sini atau klik untuk mencari</p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-20 bg-white shadow-lg rounded-xl border border-blue-100 flex items-center justify-center mb-4 relative">
                  <File className="w-8 h-8 text-blue-500" />
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-[10px] text-white font-bold uppercase">W</div>
                </div>
                <p className="font-bold text-gray-900 max-w-[200px] truncate">{file.name}</p>
                <p className="text-xs text-blue-500 font-bold mt-1 tracking-widest uppercase">{(file.size / 1024).toFixed(0)} KB</p>
                
                <button 
                  onClick={(e) => { e.preventDefault(); setFile(null); }}
                  className="mt-6 text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1.5 px-4 py-2 hover:bg-red-50 rounded-full transition-all"
                >
                  <X className="w-3 h-3" /> GANTI FILE
                </button>
              </div>
            )}
            <input 
              aria-label="Pilih dokumen DOCX"
              type="file" 
              accept=".docx" 
              onChange={handleChange} 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              disabled={isUploading}
            />
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold text-center border border-red-100">
              {error}
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={!file || isUploading}
            isLoading={isUploading}
            variant="dark"
            size="xl"
            className="w-full"
          >
            {ctaLabel}
          </Button>
        </div>
      ) : (
        <Card padding="lg" className="flex flex-col items-center text-center animate-in zoom-in-95 duration-500">
          <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-8">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <h2 className="text-3xl font-black mb-4 text-gray-900">{successTitle}</h2>
          <p className="text-gray-400 font-medium mb-10 max-w-sm">{successDescription}</p>
          
          <div className="w-full grid grid-cols-2 gap-4 mb-10 text-left">
            {['Margin Fix', 'Spasi 1.5', 'Font TNR 12', 'Heading Ok'].map((check) => (
              <div key={check} className="flex items-center gap-2 p-3 rounded-2xl bg-gray-50 text-gray-600 text-[10px] font-black uppercase tracking-widest">
                <CheckCircle2 className="w-4 h-4 text-green-500" /> {check}
              </div>
            ))}
          </div>

          <div className="flex flex-col w-full gap-4">
            <Button variant="dark" size="lg" onClick={() => setSuccess(false)}>
              Upload File Lain
            </Button>
            <Link 
              href="/" 
              className="text-sm font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-widest mt-2"
            >
              Kembali Ke Beranda
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

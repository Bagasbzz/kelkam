import type { TourStep } from "@/components/ui/GuidedTour";

/** Panduan interaktif Laporan. Target = atribut data-tour di src/app/dashboard/page.tsx. */
export const LAPORAN_TOUR: TourStep[] = [
  { title: "Selamat datang di Laporan AI", text: "Di sini AI membantumu menyusun laporan praktikum, makalah, capstone, sampai skripsi. Ikuti panduan singkat ini, atau tekan Lewati kapan saja." },
  { target: "lap-sesi", title: "Daftar laporan", text: "Setiap laporan punya sesi sendiri. Tekan Laporan baru untuk mulai; percakapan, rencana, sumber, dan draft tersimpan otomatis di akunmu." },
  { target: "lap-chat", title: "Ceritakan kebutuhanmu", text: "Tulis jenis dokumen, judul atau topik, gaya sitasi, dan ketentuan kampus. AI akan bertanya hal yang masih kurang, seperti mengobrol dengan pembimbing." },
  { target: "lap-bahan", title: "Lampirkan bahan", text: "Unggah panduan kampus, contoh laporan, kode program (ZIP), atau data. AI membaca isinya. Logo di sampul Word juga bisa dipakai nanti untuk PPT." },
  { target: "lap-panel", title: "Rencana, Sumber, Bahan, Gambar, Draft", text: "Panel ini menampilkan kerangka bab, sumber jurnal dan buku yang sudah diverifikasi (bisa difilter per jenis), diagram, dan draft. Centang atau buang sumber sesuai kebutuhan." },
  { target: "lap-eksekusi", title: "Setujui dan eksekusi", text: "Setelah rencana dan sumber sesuai, tekan Setujui & eksekusi. AI menulis setiap bab, membuat diagram, lalu auditor AI memeriksa hasil utuh sebelum file Word dikirim ke chat." },
  { title: "Revisi kapan saja", text: "Setelah selesai, minta revisi lewat chat, misalnya: perdalam BAB III dan tambah justifikasi sampel. Tombol Cara pakai? di kanan bawah membuka panduan ini lagi." },
];

/** Panduan interaktif Presentasi. Target = atribut data-tour di src/components/presentation. */
export const PRESENTASI_TOUR: TourStep[] = [
  { title: "Selamat datang di Presentasi AI", text: "AI menyusun slide dari materi atau laporanmu dengan desain yang selalu berbeda, lalu kamu bisa mengedit dan mengunduh PowerPoint." },
  { target: "ppt-mulai", title: "Mulai presentasi", text: "Tekan Buat presentasi. Bisa juga dari halaman Laporan lewat tombol Buat presentasi dari laporan ini." },
  { target: "ppt-chat", title: "Diskusi dengan AI", text: "Lampirkan Word, PDF, atau PPT, lalu sebutkan tujuan, audiens, durasi, dan kepadatan teks. AI membaca bahan, menyusun rencana, lalu menulis slide." },
  { target: "ppt-rencana", title: "Pratinjau dan rencana", text: "Panel ini menampilkan rencana slide, tampilan, dan usulan gambar. Gambar sampul dan dua slide utama dibuat otomatis setelah hasil dipakai." },
  { target: "ppt-mode", title: "Chat AI atau Edit slide", text: "Pindah ke Edit slide untuk menggeser objek, mengganti teks dan gambar, atau mencoba gaya tampilan lain." },
  { target: "ppt-unduh", title: "Tayangkan dan unduh", text: "Tayangkan langsung di browser atau unduh PPTX yang tetap bisa diedit di PowerPoint. Tombol Cara pakai? di kanan bawah membuka panduan ini lagi." },
];

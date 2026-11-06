import { z } from "zod";

export const THEME_IDS = ["playful", "editorial", "product"] as const;
export const LAYOUT_IDS = ["title", "split", "cards", "timeline", "statement"] as const;
export const ART_STYLES = ["geometric", "zine", "kinetic", "blueprint", "minimal"] as const;
export const VISUAL_MOTIFS = ["network", "campus", "botanical", "megaphone", "orbit", "none"] as const;
export const VISUAL_BACKGROUNDS = ["solid", "halftone", "grid", "spotlight"] as const;
export const SLIDE_MOTIONS = ["none", "fade", "push", "reveal"] as const;
export type PresentationFont = "Arial" | "Arial Black" | "Impact" | "Georgia";
export type PresentationTheme = (typeof THEME_IDS)[number];
export type SlideLayout = (typeof LAYOUT_IDS)[number];

export interface ThemeDefinition {
  id: PresentationTheme;
  label: string;
  description: string;
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  secondary: string;
  surface: string;
  headingFont: PresentationFont;
  bodyFont: "Arial";
}

export const THEMES: Record<PresentationTheme, ThemeDefinition> = {
  playful: {
    id: "playful", label: "Playful", description: "Warna hangat, bentuk bulat, dan energi lokakarya kreatif.",
    background: "F8F0DD", foreground: "25221F", muted: "625647", accent: "BA3628",
    secondary: "D9B6F2", surface: "ECDDC3", headingFont: "Arial Black", bodyFont: "Arial",
  },
  editorial: {
    id: "editorial", label: "Editorial", description: "Tipografi serif, ruang lapang, dan ritme majalah riset.",
    background: "F4F1E9", foreground: "252923", muted: "5E635B", accent: "8E3828",
    secondary: "D9DFD2", surface: "EAE6DC", headingFont: "Georgia", bodyFont: "Arial",
  },
  product: {
    id: "product", label: "Product", description: "Kanvas gelap, aksen mint, dan struktur presentasi produk.",
    background: "111710", foreground: "F3F5E8", muted: "B6C0AB", accent: "CAFF40",
    secondary: "405136", surface: "24321E", headingFont: "Impact", bodyFont: "Arial",
  },
};

// Exclude XML-illegal controls and unpaired surrogates before native Office export.
const validText = (value: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (max: number) => z.string().trim().max(max).refine(validText, "Teks mengandung karakter yang tidak didukung.");

export const artDirectionSchema = z.object({
  style: z.enum(ART_STYLES), concept: text(400),
}).strict();
export const slideVisualSchema = z.object({
  motif: z.enum(VISUAL_MOTIFS), background: z.enum(VISUAL_BACKGROUNDS), motion: z.enum(SLIDE_MOTIONS),
}).strict();
export const slideArtSchema = z.object({
  fileId: text(100).min(1).refine((value) => !/[:/\\?#]/u.test(value) && value !== "." && value !== "..", "Gunakan ID file, bukan URL atau path."),
  role: z.enum(["hero", "background", "cutout"]), alt: text(300),
}).strict();

export const slideSchema = z.object({
  id: z.string().uuid(),
  title: text(120).min(1),
  eyebrow: text(60),
  body: z.array(text(220).min(1)).max(4),
  notes: text(2000),
  source: text(350),
  layout: z.enum(LAYOUT_IDS),
  locked: z.boolean(),
  visual: slideVisualSchema.optional(),
  art: slideArtSchema.optional(),
}).strict();

export const deckSchema = z.object({
  id: z.string().uuid(),
  title: text(120).min(1),
  theme: z.enum(THEME_IDS),
  slides: z.array(slideSchema).min(1).max(20),
  artDirection: artDirectionSchema.optional(),
}).strict().superRefine((deck, ctx) => {
  const seen = new Set<string>();
  deck.slides.forEach((slide, index) => {
    if (seen.has(slide.id)) {
      ctx.addIssue({ code: "custom", path: ["slides", index, "id"], message: "ID slide harus unik." });
    }
    seen.add(slide.id);
  });
});

export type PresentationSlide = z.infer<typeof slideSchema>;
export type PresentationDeck = z.infer<typeof deckSchema>;
export type ArtDirection = z.infer<typeof artDirectionSchema>;
export type SlideVisual = z.infer<typeof slideVisualSchema>;
export type SlideArt = z.infer<typeof slideArtSchema>;

export function validateDeck(input: unknown) {
  return deckSchema.safeParse(input);
}

export interface PresentationIssue {
  slideId: string;
  code: "long-title" | "dense-body" | "empty-body" | "missing-source" | "small-text";
  severity: "warning";
  message: string;
}

export function inspectSlide(slide: PresentationSlide): PresentationIssue[] {
  const issues: PresentationIssue[] = [];
  const warn = (code: PresentationIssue["code"], message: string) => issues.push({ slideId: slide.id, code, severity: "warning", message });
  if (slide.title.length > 85) warn("long-title", "Ringkas judul menjadi sekitar 85 karakter agar lebih mudah dibaca.");
  if (slide.body.join("").length > 540 || slide.body.some((item) => item.length > 180)) {
    warn("dense-body", "Teks padat. Pecah gagasan ke slide lain atau pindahkan detail ke catatan pembicara.");
  }
  if (!slide.body.length && slide.layout !== "title" && slide.layout !== "statement") {
    warn("empty-body", "Tambahkan isi untuk melengkapi layout ini.");
  }
  if (slide.body.length && !slide.source && slide.layout !== "title") {
    warn("missing-source", "Sumber belum dicantumkan. Tambahkan rujukan jika slide memuat klaim atau data.");
  }
  return issues;
}

export function inspectDeck(deck: PresentationDeck): PresentationIssue[] {
  return deck.slides.flatMap(inspectSlide);
}

type DemoSlide = Pick<PresentationSlide, "title" | "eyebrow" | "body" | "notes" | "layout">;
const DEMOS: Record<PresentationTheme, { title: string; slides: DemoSlide[] }> = {
  playful: {
    title: "Ide kecil, perubahan besar",
    slides: [
      { layout: "title", eyebrow: "LOKAKARYA KREATIF", title: "Ide kecil, perubahan besar", body: ["Ruang bereksperimen untuk komunitas kampus.", "Mulai dari rasa ingin tahu, bukan jawaban sempurna."], notes: "Buka dengan satu pengalaman kecil yang ingin peserta ubah di kampus." },
      { layout: "split", eyebrow: "01 / DENGARKAN", title: "Masalah yang baik dimulai dari cerita", body: ["Ajak teman bercerita tentang satu hambatan sehari-hari.", "Catat konteks dan kebutuhan, bukan hanya keluhannya.", "Pilih masalah yang dekat dan bisa dicoba bersama."], notes: "Minta peserta berpasangan dan saling mendengar tanpa langsung menawarkan solusi." },
      { layout: "cards", eyebrow: "02 / BUKA KEMUNGKINAN", title: "Tiga cara melihat ide dari sudut baru", body: ["Balik asumsi: bagaimana jika aturan utamanya diubah?", "Gabungkan dua kebiasaan yang biasanya terpisah.", "Kecilkan solusi sampai bisa diuji dalam satu sore."], notes: "Setiap kelompok memilih satu pendekatan. Tidak ada penilaian ide pada tahap ini." },
      { layout: "timeline", eyebrow: "03 / COBA BERSAMA", title: "Dari obrolan menjadi percobaan", body: ["Dengar: kumpulkan cerita dan tentukan satu kebutuhan.", "Rancang: gambar solusi paling sederhana.", "Uji: ajak satu teman mencoba prototipe.", "Pelajari: catat hal yang perlu diubah."], notes: "Tahapan ini adalah contoh proses, bukan jadwal atau hasil riset yang sudah dijalankan." },
      { layout: "statement", eyebrow: "LANGKAH BERIKUTNYA", title: "Jangan tunggu ide sempurna untuk mulai.", body: ["Pilih satu percobaan kecil untuk minggu ini.", "Bagikan apa yang dipelajari, termasuk yang belum berhasil."], notes: "Tutup dengan komitmen tindakan yang spesifik dari setiap kelompok." },
    ],
  },
  editorial: {
    title: "Membaca ruang, merawat kota",
    slides: [
      { layout: "title", eyebrow: "CATATAN RISET / RUANG PUBLIK", title: "Membaca ruang, merawat kota", body: ["Kerangka kajian ruang teduh di sekitar kampus.", "Contoh narasi riset, tanpa angka atau temuan rekaan."], notes: "Perkenalkan pertanyaan riset. Ganti materi contoh dengan hasil pengamatan dan sumber yang terverifikasi." },
      { layout: "split", eyebrow: "01 / PERTANYAAN", title: "Siapa yang bisa merasa nyaman di ruang kita?", body: ["Amati pengalaman pejalan kaki pada waktu yang berbeda.", "Perhatikan akses, tempat duduk, dan keberadaan naungan.", "Bedakan pengamatan lapangan dari interpretasi peneliti."], notes: "Jelaskan batas lokasi, waktu pengamatan, dan siapa yang belum terwakili." },
      { layout: "cards", eyebrow: "02 / LENSA ANALISIS", title: "Tiga lensa untuk membaca ruang publik", body: ["Akses: jalur yang jelas dan dapat digunakan beragam pengguna.", "Kenyamanan: tempat beristirahat, naungan, dan orientasi ruang.", "Interaksi: kesempatan bertemu tanpa menghalangi pergerakan."], notes: "Ketiga lensa adalah kerangka diskusi. Cantumkan literatur yang benar-benar digunakan sebelum publikasi." },
      { layout: "timeline", eyebrow: "03 / METODE", title: "Bukti dikumpulkan sebelum simpulan ditulis", body: ["Petakan lokasi dan rumuskan pertanyaan pengamatan.", "Catat kondisi ruang dengan prosedur yang konsisten.", "Bandingkan catatan dan cari penjelasan alternatif.", "Susun rekomendasi beserta keterbatasan kajian."], notes: "Rencana metode ini belum menyatakan bahwa penelitian telah selesai." },
      { layout: "statement", eyebrow: "PENUTUP", title: "Ruang yang baik memberi tempat bagi lebih banyak orang.", body: ["Mulai rekomendasi dari kebutuhan pengguna yang teramati.", "Tunjukkan apa yang diketahui dan apa yang masih perlu diteliti."], notes: "Akhiri dengan satu pertanyaan terbuka yang dapat diuji lewat pengamatan berikutnya." },
    ],
  },
  product: {
    title: "Satu pintu untuk layanan kampus",
    slides: [
      { layout: "title", eyebrow: "KONSEP PRODUK / CAMPUS DESK", title: "Satu pintu untuk layanan kampus", body: ["Lebih jelas mencari bantuan, lebih mudah mengikuti progres.", "Konsep MVP untuk diuji bersama mahasiswa dan petugas."], notes: "Ini konsep produk demonstrasi. Belum ada klaim peningkatan kinerja atau jumlah pengguna." },
      { layout: "split", eyebrow: "01 / MASALAH", title: "Bantuan ada. Jalurnya belum selalu jelas.", body: ["Mahasiswa perlu mengetahui layanan yang tepat untuk kebutuhannya.", "Petugas memerlukan konteks agar permintaan tidak berulang.", "Kedua pihak membutuhkan status dan langkah berikutnya yang jelas."], notes: "Validasi hipotesis masalah melalui wawancara sebelum menentukan prioritas produk." },
      { layout: "cards", eyebrow: "02 / SOLUSI INTI", title: "Tiga kemampuan, satu alur yang sederhana", body: ["Temukan layanan melalui kategori dan petunjuk yang ringkas.", "Kirim permintaan dengan informasi yang relevan.", "Lihat status, tindak lanjut, dan penanggung jawab layanan."], notes: "Tiga kemampuan ini adalah batas MVP. Integrasi sistem lain tidak termasuk tahap awal." },
      { layout: "timeline", eyebrow: "03 / RENCANA VALIDASI", title: "Bangun kecil, buktikan manfaatnya", body: ["Pahami: wawancarai mahasiswa dan petugas layanan.", "Prototipe: uji alur tanpa integrasi sistem produksi.", "Pilot: jalankan pada satu jenis layanan yang disepakati.", "Evaluasi: tinjau penyelesaian tugas dan umpan balik."], notes: "Tentukan metrik dan kriteria keberhasilan bersama pemilik layanan sebelum pilot." },
      { layout: "statement", eyebrow: "KEPUTUSAN BERIKUTNYA", title: "Uji satu alur layanan sebelum membangun semuanya.", body: ["Sepakati mitra pilot dan batas data yang boleh digunakan.", "Tentukan bukti yang dibutuhkan untuk melanjutkan pengembangan."], notes: "Jangan memakai data pribadi nyata dalam prototipe. Gunakan data sintetis sampai izin dan kontrol akses tersedia." },
    ],
  },
};

export function createStarterDeck(theme: PresentationTheme): PresentationDeck {
  const demo = DEMOS[theme];
  const directions: Record<PresentationTheme, ArtDirection> = {
    playful: { style: "zine", concept: "Kolase lokakarya kreatif kampus: poster tipografi besar, tinta merah, kertas hangat, halftone, dan megafon sebagai undangan bersuara." },
    editorial: { style: "geometric", concept: "Atlas ruang publik: bidang diagonal, tipografi editorial, denah kampus dan tajuk tumbuhan sebagai naungan kota." },
    product: { style: "kinetic", concept: "Sistem layanan kampus yang terhubung: hitam dan lime, tipografi monumental, jalur jaringan dan orbit untuk merangkum alur layanan." },
  };
  const motifs: Record<PresentationTheme, SlideVisual["motif"][]> = {
    playful: ["megaphone", "campus", "megaphone", "network", "megaphone"],
    editorial: ["botanical", "campus", "botanical", "network", "botanical"],
    product: ["orbit", "network", "network", "orbit", "campus"],
  };
  return deckSchema.parse({
    id: globalThis.crypto.randomUUID(), title: demo.title, theme, artDirection: directions[theme],
    slides: demo.slides.map((slide, index) => ({
      ...slide, id: globalThis.crypto.randomUUID(), source: "Materi demonstrasi; ganti dengan sumber terverifikasi sesuai konteks.", locked: false,
      visual: { motif: motifs[theme][index], background: theme === "playful" ? "halftone" : theme === "product" ? "spotlight" : "solid", motion: index === 0 ? "fade" : index === 3 ? "push" : "reveal" },
    })),
  });
}

/**
 * src/lib/seo/site.ts
 * -----------------------------------------------------------------------------
 * Satu sumber kebenaran untuk SEO dan keterbacaan AI (Google AI Overview,
 * ChatGPT, Claude, Perplexity): halaman fitur, JSON-LD, sitemap, dan /llms.txt
 * semuanya membaca data di sini, jadi penjelasan fitur selalu konsisten.
 * Aturan isi: faktual sesuai fitur yang benar-benar ada, tanpa em dash.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://keluhkampus.my.id").replace(/\/$/, "");
export const SITE_NAME = "keluhkampus";
export const SITE_TAGLINE = "Buat laporan dan PPT kuliah dengan AI";
export const SITE_DESCRIPTION =
  "keluhkampus adalah platform AI untuk mahasiswa Indonesia: menyusun laporan, makalah, dan skripsi lengkap dengan sumber jurnal dan buku asli, serta membuat presentasi PowerPoint dengan desain unik yang bisa diedit. Ada juga pembuat diagram UML, pengolah data, dan alat PDF/Word.";

export interface FeatureDoc {
  slug: string;
  appHref: string;
  name: string;
  title: string;
  description: string;
  keywords: string[];
  summary: string;
  benefits: { title: string; text: string }[];
  steps: { title: string; text: string }[];
  faq: { q: string; a: string }[];
}

export const FEATURES: FeatureDoc[] = [
  {
    slug: "laporan-ai",
    appHref: "/dashboard",
    name: "Laporan AI",
    title: "Buat Laporan, Makalah, dan Skripsi dengan AI (Sumber Asli + DOCX)",
    description:
      "Asisten Laporan AI keluhkampus menyusun laporan praktikum, makalah, capstone, dan skripsi bab demi bab dengan sumber jurnal ber-DOI dan buku ber-ISBN yang asli, diagram UML, audit AI, lalu ekspor Word (DOCX) sesuai format kampus.",
    keywords: ["buat laporan dengan AI", "AI penulis makalah", "AI skripsi", "laporan praktikum AI", "cari jurnal DOI", "daftar pustaka APA otomatis", "export DOCX format kampus"],
    summary:
      "Pengguna mengobrol dengan asisten seperti dengan pembimbing. AI memahami jenis dokumen, topik, gaya sitasi, dan ketentuan kampus, menyusun rencana bab, mencari dan memverifikasi sumber nyata, menulis setiap bab, membuat diagram, lalu mengaudit hasil utuh sebelum dikirim sebagai file Word.",
    benefits: [
      { title: "Sumber nyata dan terverifikasi", text: "Jurnal dan prosiding dicek DOI-nya ke Crossref, buku dicek ISBN-nya lewat Google Books atau Open Library, skripsi dan preprint dari OpenAlex. Sumber bisa difilter per jenis: jurnal, buku, skripsi/preprint, laporan lembaga." },
      { title: "Membaca isi, bukan hanya judul", text: "PDF open access diunduh dan dibaca penuh, sehingga kutipan sesuai isi sumber. Peringkat SINTA/Scopus tidak diklaim otomatis; disediakan tautan cek manual." },
      { title: "Bab lengkap dengan visual", text: "Setiap bab ditulis sesuai rencana yang disetujui pengguna, lengkap dengan diagram UML (flowchart, use case, activity, sequence, class, ERD), diagram konsep, tabel, dan ilustrasi." },
      { title: "Diaudit AI sebelum dikirim", text: "Auditor AI terpisah membaca laporan utuh dan mencocokkannya dengan permintaan pengguna, rencana, aturan kampus, dan daftar pustaka. Bab yang bermasalah diperbaiki lalu diaudit ulang (maksimal dua putaran)." },
      { title: "Word rapi sesuai kampus", text: "Hasil diunduh sebagai DOCX dengan sampul, daftar isi, penomoran gambar dan tabel, serta daftar pustaka APA, IEEE, atau Harvard. Bab bisa direvisi lewat chat." },
    ],
    steps: [
      { title: "Ceritakan kebutuhan", text: "Tulis jenis dokumen, judul atau topik, dan ketentuan kampus di chat. Lampirkan bahan seperti panduan, kode program, atau data bila ada." },
      { title: "Setujui rencana bab", text: "AI mengusulkan kerangka bab, diagram, dan tabel. Ubah lewat chat sampai sesuai." },
      { title: "Pilih sumber", text: "AI mencari jurnal, buku, dan skripsi yang relevan. Centang atau buang sumber di tab Sumber dengan filter jenis." },
      { title: "Eksekusi dan audit", text: "AI menulis setiap bab, membuat diagram, lalu auditor AI memeriksa hasil utuh sebelum dikirim." },
      { title: "Unduh dan revisi", text: "Unduh DOCX. Minta revisi bab tertentu kapan saja lewat chat." },
    ],
    faq: [
      { q: "Apakah sumber yang dipakai Laporan AI keluhkampus asli?", a: "Ya. Jurnal hanya dipakai bila DOI-nya lolos verifikasi Crossref, buku harus punya ISBN atau tercatat di katalog, dan AI dilarang menyitir sumber di luar daftar yang dicentang pengguna." },
      { q: "Jenis dokumen apa saja yang bisa dibuat?", a: "Laporan praktikum, makalah, laporan proyek atau PKL, capstone, tinjauan pustaka, hingga skripsi dan tugas akhir dengan jumlah bab yang menyesuaikan jenis dokumen." },
      { q: "Apakah hasilnya bisa diunduh sebagai Word?", a: "Bisa. Hasil diekspor ke DOCX dengan format kampus (margin, font, spasi), sampul, daftar isi, gambar, tabel, dan daftar pustaka." },
      { q: "Apakah ada pemeriksaan kualitas otomatis?", a: "Ada. Setiap laporan diperiksa otomatis lalu diaudit oleh AI terpisah terhadap permintaan pengguna. Jika belum sesuai, bab diperbaiki dan diaudit ulang; sisa catatan ditampilkan secara jujur." },
    ],
  },
  {
    slug: "ppt-ai",
    appHref: "/presentasi",
    name: "Presentasi (PPT) AI",
    title: "Buat PPT dengan AI: Desain Unik, Logo Kampus, Unduh PowerPoint",
    description:
      "Presentasi AI keluhkampus menyusun slide PowerPoint dari dokumen atau laporan, dengan desain dan motif yang berbeda setiap kali dibuat, logo kampus otomatis, gambar AI, audit AI, dan file PPTX yang tetap bisa diedit.",
    keywords: ["buat ppt dengan AI", "AI pembuat presentasi", "ppt sidang skripsi", "ppt otomatis dari laporan", "desain ppt unik", "download pptx editable"],
    summary:
      "Pengguna melampirkan materi (Word, PDF, PowerPoint) atau memulai dari laporan di keluhkampus, lalu berdiskusi dengan AI tentang tujuan, audiens, durasi, dan kepadatan teks. AI membaca bahan, menyusun rencana, menulis slide, mengaudit deck, dan menerapkan desain yang unik untuk setiap presentasi.",
    benefits: [
      { title: "Desain unik setiap generate", text: "Warna, latar, motif dekoratif generatif, gaya kartu, dan tata letak diacak dari identitas deck, sehingga dua presentasi tidak pernah sama dan tidak terlihat seperti template AI pada umumnya." },
      { title: "Logo kampus dan gambar otomatis", text: "Logo dan gambar di dokumen yang dilampirkan diambil otomatis; gambar sampul dan slide utama dibuat AI begitu hasil diterima. Diagram dari laporan bisa dimasukkan sebagai slide gambar." },
      { title: "Isi dari bahan, bukan karangan", text: "AI membaca bab dan bagian penting dari bahan, memilih pesan utama untuk audiens, dan menandai hal yang perlu divalidasi. Catatan pembicara disertakan." },
      { title: "Diaudit AI sebelum ditampilkan", text: "Auditor AI memeriksa deck terhadap permintaan pengguna dan rencana: alur, kepadatan teks, teks yang meluber, dan konsistensi. Slide bermasalah diperbaiki dulu." },
      { title: "Edit langsung dan unduh PPTX", text: "Geser dan ubah ukuran objek, ganti teks, gambar, gaya tampilan, dan animasi. Unduh PowerPoint yang tetap bisa diedit atau tayangkan langsung di browser." },
    ],
    steps: [
      { title: "Mulai presentasi", text: "Klik Buat presentasi atau tombol Buat presentasi dari laporan di halaman Laporan." },
      { title: "Lampirkan bahan dan jelaskan kebutuhan", text: "Unggah Word/PDF/PPT dan sebutkan tujuan, audiens, durasi, serta kepadatan teks." },
      { title: "Tinjau rencana", text: "AI menyusun rencana slide, tampilan, dan usulan gambar di panel kanan." },
      { title: "Gunakan hasil", text: "Setelah deck lolos audit, tinjau pratinjau lalu pilih Gunakan hasil ini. Gambar sampul dibuat otomatis." },
      { title: "Edit, tayangkan, unduh", text: "Rapikan di mode Edit slide, coba gaya lain, lalu unduh PPTX." },
    ],
    faq: [
      { q: "Apakah desain PPT dari keluhkampus selalu sama?", a: "Tidak. Setiap presentasi mendapat kombinasi warna, latar, motif generatif, dan gaya tata letak yang berbeda, disesuaikan dengan topik." },
      { q: "Apakah file PPTX bisa diedit di PowerPoint?", a: "Bisa. Teks, bentuk, dan gambar diekspor sebagai objek PowerPoint asli, bukan gambar datar." },
      { q: "Bisakah membuat PPT dari laporan atau skripsi?", a: "Bisa. Dari halaman Laporan pilih Buat presentasi dari laporan ini; AI membaca laporan dan diagramnya, lalu menyusun slide." },
      { q: "Apakah logo kampus bisa dimasukkan otomatis?", a: "Bisa. Logo yang ada di dokumen Word/PDF yang dilampirkan dideteksi dan dipasang di sampul serta slide." },
    ],
  },
];

/** Fitur pendukung (halaman aplikasi publik). */
export const OTHER_TOOLS: { href: string; name: string; text: string }[] = [
  { href: "/uml-builder", name: "Buat Diagram UML", text: "Flowchart, use case, activity, sequence, class, ERD yang bisa diedit dan dipakai di laporan." },
  { href: "/data-synthesizer", name: "Olah Data", text: "Ubah hasil kuesioner, wawancara, atau observasi menjadi tulisan hasil dan pembahasan." },
  { href: "/template-generator", name: "Editor Dokumen", text: "Menulis dokumen seperti di Word lalu mengunduhnya dengan format rapi." },
  { href: "/ai-tools", name: "AI Tools", text: "Parafrase, ringkas, dan terjemahkan tulisan." },
  { href: "/fix-format", name: "Rapikan Format", text: "Merapikan judul, daftar, dan spasi dokumen Word." },
  { href: "/tools", name: "Alat PDF, Word & Gambar", text: "Gabung dan pisah PDF, Word ke PDF, kompres gambar, diproses di browser." },
  { href: "/tugas", name: "Pengumpulan Tugas", text: "Kumpulkan tugas lewat token mata kuliah dan lihat urutan pengumpulan." },
  { href: "/studio", name: "Studio", text: "Menyusun ide dan kerangka laporan bersama AI." },
  { href: "/tracker", name: "Pantau Progres", text: "Mencatat kemajuan tugas dan kebiasaan belajar." },
];

export const featureBySlug = (slug: string) => FEATURES.find((feature) => feature.slug === slug);

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon.svg` },
      { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: SITE_NAME, url: SITE_URL, inLanguage: "id-ID", description: SITE_DESCRIPTION, publisher: { "@id": `${SITE_URL}/#org` } },
    ],
  };
}

export function appJsonLd(feature?: FeatureDoc) {
  const features = feature ? [feature] : FEATURES;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: feature ? `${SITE_NAME} ${feature.name}` : SITE_NAME,
    url: feature ? `${SITE_URL}/fitur/${feature.slug}` : SITE_URL,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    inLanguage: "id-ID",
    description: feature ? feature.description : SITE_DESCRIPTION,
    offers: { "@type": "Offer", price: "0", priceCurrency: "IDR" },
    featureList: features.flatMap((item) => item.benefits.map((benefit) => `${item.name}: ${benefit.title}`)),
    publisher: { "@id": `${SITE_URL}/#org` },
  };
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
  };
}

export function howToJsonLd(feature: FeatureDoc) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `Cara memakai ${feature.name} di ${SITE_NAME}`,
    inLanguage: "id-ID",
    step: feature.steps.map((step, i) => ({ "@type": "HowToStep", position: i + 1, name: step.title, text: step.text })),
  };
}

/** Isi /llms.txt: ringkasan terstruktur agar asisten AI bisa menjelaskan platform dengan benar. */
export function llmsText() {
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "Bahasa: Indonesia. Pengguna: mahasiswa. Akses: lewat browser, perlu akun untuk fitur AI. Situs: " + SITE_URL,
    "",
    "## Fitur unggulan",
    "",
  ];
  for (const feature of FEATURES) {
    lines.push(`### ${feature.name}`, "", `Halaman: ${SITE_URL}/fitur/${feature.slug} (aplikasi: ${SITE_URL}${feature.appHref})`, "", feature.summary, "", "Keunggulan:");
    for (const benefit of feature.benefits) lines.push(`- ${benefit.title}: ${benefit.text}`);
    lines.push("", "Cara pakai:");
    feature.steps.forEach((step, i) => lines.push(`${i + 1}. ${step.title}: ${step.text}`));
    lines.push("", "Tanya jawab:");
    for (const item of feature.faq) lines.push(`- ${item.q} ${item.a}`);
    lines.push("");
  }
  lines.push("## Alat lain", "");
  for (const tool of OTHER_TOOLS) lines.push(`- [${tool.name}](${SITE_URL}${tool.href}): ${tool.text}`);
  lines.push("", "## Halaman penting", "", `- [Semua fitur](${SITE_URL}/fitur)`, `- [Beranda](${SITE_URL}/)`, "");
  return lines.join("\n");
}

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  convertMillimetersToTwip,
  PageBreak,
} from "docx";

export interface SmartTemplateOptions {
  studentName: string;
  nim: string;
  thesisTitle: string;
  university: string;
  faculty: string;
  prodi: string;
  supervisor: string;
  year: string;
}

export async function generateSmartThesisTemplate(
  options: SmartTemplateOptions
): Promise<Buffer> {
  const { 
    studentName, 
    nim, 
    thesisTitle, 
    university, 
    faculty, 
    prodi, 
    supervisor, 
    year 
  } = options;

  // Create document
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Times New Roman",
            size: 24, // 12pt
          },
          paragraph: {
            spacing: {
              line: 360, // 1.5 spacing
            },
            alignment: AlignmentType.JUSTIFIED,
          },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 24,
            bold: true,
            allCaps: true,
          },
          paragraph: {
            spacing: {
              before: 240,
              after: 240,
              line: 360,
            },
            alignment: AlignmentType.CENTER,
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 24,
            bold: true,
          },
          paragraph: {
            spacing: {
              before: 120,
              after: 120,
              line: 360,
            },
            alignment: AlignmentType.LEFT,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(30),
              left: convertMillimetersToTwip(40),
              right: convertMillimetersToTwip(30),
              bottom: convertMillimetersToTwip(30),
            },
          },
        },
        children: [
          // ==============================
          // COVER
          // ==============================
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: thesisTitle.toUpperCase(),
                bold: true,
                size: 28,
              }),
            ],
            spacing: { after: 1200 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "SKRIPSI",
                bold: true,
                size: 24,
              }),
            ],
            spacing: { after: 1200 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "Diajukan sebagai salah satu syarat untuk memperoleh gelar Sarjana",
                size: 24,
              }),
            ],
            spacing: { after: 1200 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "Disusun Oleh:",
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: studentName.toUpperCase(),
                bold: true,
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: nim,
                size: 24,
              }),
            ],
            spacing: { after: 1200 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: prodi.toUpperCase(),
                bold: true,
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: faculty.toUpperCase(),
                bold: true,
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: university.toUpperCase(),
                bold: true,
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: year,
                bold: true,
                size: 24,
              }),
            ],
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // LEMBAR PENGESAHAN
          // ==============================
          new Paragraph({
            text: "LEMBAR PENGESAHAN",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Skripsi ini telah disetujui untuk diujikan oleh:", size: 24 }),
            ],
            spacing: { before: 1000, after: 1000 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Dosen Pembimbing,", size: 24 }),
            ],
            spacing: { after: 1500 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: supervisor, bold: true, underline: {}, size: 24 }),
            ],
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // ABSTRAK
          // ==============================
          new Paragraph({
            text: "ABSTRAK",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: studentName, bold: true }),
              new TextRun({ text: `. ${thesisTitle}.` }),
            ],
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: "[Tuliskan abstrak penelitian Anda di sini dalam satu paragraf yang mencakup latar belakang, metode, hasil, dan simpulan penelitian. Maksimal 250 kata.]",
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Kata Kunci: ", bold: true }),
              new TextRun({ text: "[Sebutkan 3-5 kata kunci di sini]" }),
            ],
            spacing: { before: 400 },
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // KATA PENGANTAR
          // ==============================
          new Paragraph({
            text: "KATA PENGANTAR",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "Puji syukur penulis panjatkan ke hadirat Tuhan Yang Maha Esa atas segala rahmat-Nya sehingga skripsi ini dapat diselesaikan...",
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // DAFTAR ISI
          // ==============================
          new Paragraph({
            text: "DAFTAR ISI",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "[Halaman ini akan diisi secara otomatis oleh Microsoft Word setelah Anda mengatur heading dengan benar]",
            alignment: AlignmentType.CENTER,
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // BAB 1 PENDAHULUAN
          // ==============================
          new Paragraph({
            text: "BAB 1 PENDAHULUAN",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "1.1 Latar Belakang",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Latar belakang penelitian ditulis di sini. Jelaskan fenomena atau masalah yang mendasari penelitian Anda.]",
          }),
          new Paragraph({
            text: "1.2 Rumusan Masalah",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Tuliskan pertanyaan penelitian atau rumusan masalah di sini.]",
          }),
          new Paragraph({
            text: "1.3 Tujuan Penelitian",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Tuliskan tujuan yang ingin dicapai melalui penelitian ini.]",
          }),
          new Paragraph({
            text: "1.4 Manfaat Penelitian",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Tuliskan manfaat teoritis dan praktis dari penelitian ini.]",
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // BAB 2 TINJAUAN PUSTAKA
          // ==============================
          new Paragraph({
            text: "BAB 2 TINJAUAN PUSTAKA",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "2.1 Landasan Teori",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Uraikan teori-teori yang mendasari variabel atau topik penelitian Anda.]",
          }),
          new Paragraph({
            text: "2.2 Penelitian Terdahulu",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Tinjau beberapa penelitian sebelumnya yang relevan dengan topik Anda.]",
          }),
          new Paragraph({
            text: "2.3 Kerangka Pemikiran",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Gambarkan atau uraikan alur pemikiran dari penelitian ini.]",
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // BAB 3 METODOLOGI PENELITIAN
          // ==============================
          new Paragraph({
            text: "BAB 3 METODOLOGI PENELITIAN",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "3.1 Jenis Penelitian",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Jelaskan apakah penelitian ini bersifat kualitatif, kuantitatif, atau gabungan.]",
          }),
          new Paragraph({
            text: "3.2 Metode Pengumpulan Data",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Jelaskan teknik pengumpulan data seperti wawancara, kuesioner, atau observasi.]",
          }),
          new Paragraph({
            text: "3.3 Teknik Analisis Data",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Uraikan langkah-langkah dalam menganalisis data yang terkumpul.]",
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // BAB 4 HASIL DAN PEMBAHASAN
          // ==============================
          new Paragraph({
            text: "BAB 4 HASIL DAN PEMBAHASAN",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "[Sajikan data temuan penelitian dan berikan analisis mendalam pada bab ini.]",
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // BAB 5 KESIMPULAN DAN SARAN
          // ==============================
          new Paragraph({
            text: "BAB 5 KESIMPULAN DAN SARAN",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "5.1 Kesimpulan",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Tuliskan poin-poin kesimpulan dari hasil penelitian Anda.]",
          }),
          new Paragraph({
            text: "5.2 Saran",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: "[Berikan saran untuk peneliti selanjutnya atau pihak terkait.]",
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // DAFTAR PUSTAKA
          // ==============================
          new Paragraph({
            text: "DAFTAR PUSTAKA",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "[Tuliskan semua sumber referensi yang Anda gunakan di sini sesuai format (APA/MLA/Harvard).]",
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==============================
          // LAMPIRAN
          // ==============================
          new Paragraph({
            text: "LAMPIRAN",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: "[Lampirkan data tambahan, kuesioner, atau bukti penelitian lainnya di sini.]",
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

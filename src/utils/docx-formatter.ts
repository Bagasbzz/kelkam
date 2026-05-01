import mammoth from 'mammoth';
import { Document, Paragraph, Packer, AlignmentType, convertMillimetersToTwip } from 'docx';

export async function formatDocx(buffer: Buffer): Promise<Buffer> {
  // 1. Membaca dokumen Word yang diupload dan mengambil teks
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  
  // Pisahkan teks per paragraf berdasarkan baris baru
  const rawParagraphs = text.split(/\n+/).map(line => line.trim()).filter(line => line.length > 0);
  
  // 2. Menerapkan logic Heading Sederhana
  const formatParagraph = (text: string) => {
    // Deteksi BAB 1, BAB I, BAB 2, dst.
    const isBab = /^BAB\s+([0-9]+|[IVX]+)/i.test(text);
    
    if (isBab) {
      // Heading besar (bold + kapital)
      return new Paragraph({
        text: text.toUpperCase(),
        style: "BabHeading",
      });
    } else {
      // Teks standar skripsi
      return new Paragraph({
        text: text,
        style: "Normal",
      });
    }
  };

  const docParagraphs = rawParagraphs.map(formatParagraph);

  // 3. Membuat dokumen Word baru dengan format standar skripsi
  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 24, // 12pt (karena diukur dalam half-points)
          },
          paragraph: {
            alignment: AlignmentType.JUSTIFIED,
            spacing: {
              line: 360, // Line spacing 1.5
            },
          },
        },
        {
          id: "BabHeading",
          name: "Bab Heading",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 28, // 14pt untuk Heading
            bold: true,
            color: "000000",
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: {
              before: 240, 
              after: 240, 
              line: 360 
            },
          },
        }
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: {
            // Margin: Atas 4cm, Kiri 4cm, Kanan 3cm, Bawah 3cm
            top: convertMillimetersToTwip(40),
            left: convertMillimetersToTwip(40),
            right: convertMillimetersToTwip(30),
            bottom: convertMillimetersToTwip(30),
          }
        }
      },
      children: docParagraphs
    }]
  });

  // Hasilkan file .docx dalam bentuk Buffer
  return await Packer.toBuffer(doc);
}

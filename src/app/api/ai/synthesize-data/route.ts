import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";
import { getErrorMessage } from "@/lib/errors";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertAiConfigured();

    const { topic, dataType, rawData, actionType, previousResult } = await req.json();

    if (!topic || (!rawData && !previousResult)) {
      return NextResponse.json({ success: false, error: "Data tidak lengkap." }, { status: 400 });
    }

    let systemPrompt = `Anda adalah asisten peneliti dan penulis akademik tingkat lanjut. Tugas Anda adalah membantu mahasiswa menyusun draf bagian hasil, analisis, atau pembahasan untuk laporan, makalah, capstone, proposal, atau skripsi berdasarkan data mentah yang diinputkan. Gunakan bahasa Indonesia baku, formal, dan akademis.

Aturan Format Output:
1. Gunakan format Markdown standar. Gunakan ### untuk sub-judul, **tebal** untuk penekanan, dan - untuk daftar/bullet points.
2. Jangan menggunakan format tabel markdown kecuali diminta, lebih baik gunakan paragraf naratif.
3. Jangan pernah menulis pembuka basa-basi seperti "Berikut adalah hasilnya", langsung saja tulis draf laporannya.

Konteks Penelitian: ${topic}
`;

    if (actionType === 'expand') {
      systemPrompt += `\n\nINSTRUKSI KHUSUS:\nPerpanjang dan kembangkan draf laporan yang diberikan. Tambahkan elaborasi, argumen logis, dan penjelasan yang lebih dalam pada setiap paragraf tanpa mengubah fakta utama. Panjangkan hingga 1.5x - 2x lipat dari teks asli.`;
    } else if (actionType === 'formalize') {
      systemPrompt += `\n\nINSTRUKSI KHUSUS:\nUbah gaya bahasa draf laporan yang diberikan menjadi JAUH lebih formal, baku, dan tingkat akademis tinggi (setara dengan jurnal Q1). Ganti kosakata biasa dengan padanan kata ilmiah yang tepat.`;
    } else if (actionType === 'summarize_table') {
      systemPrompt += `\n\nINSTRUKSI KHUSUS:\nBuatlah sebuah TABEL RINGKASAN berformat Markdown di bagian awal laporan, lalu diikuti oleh narasi singkat di bawahnya. Tabel harus merangkum temuan-temuan inti (misalnya: Tema, Indikator, dan Kesimpulan).`;
    } else {
      // Default creation
      if (dataType === 'kuesioner') {
        systemPrompt += `
Instruksi Khusus untuk Data Kuesioner (Kuantitatif):
1. Analisis data mentah yang diberikan (berupa angka, CSV, atau daftar persetujuan).
2. Temukan tren utama, persentase dominan (jika bisa dihitung/diestimasi dari teks), dan buat ringkasan data demografi (jika ada).
3. Ubah temuan tersebut menjadi 3-4 paragraf narasi deskriptif statistik yang siap dimasukkan ke laporan.
4. Contoh bahasa: "Berdasarkan hasil pengumpulan data dari responden, mayoritas menyatakan..."`;
      } else if (dataType === 'wawancara') {
        systemPrompt += `
Instruksi Khusus untuk Data Transkrip Wawancara (Kualitatif):
1. Lakukan "Thematic Coding" (Pengkodean Tematik) pada teks wawancara yang berantakan tersebut. Temukan 2-4 "Tema Utama" yang dibahas oleh para informan.
2. Untuk setiap Tema Utama, buatkan Sub-judul (###).
3. Di bawah Sub-judul, jelaskan secara naratif makna dari tema tersebut berdasarkan jawaban informan.
4. WAJIB sertakan kutipan langsung dari kata-kata informan yang paling relevan di dalam tanda kutip miring (italic) untuk memperkuat argumen.
5. Contoh bahasa: "Terkait kendala sistem, temuan menunjukkan bahwa pengguna sering mengalami... Hal ini dikonfirmasi oleh pernyataan Informan 1 yang menyatakan bahwa, *'Iya mas kadang sering error kalau malam.'*"`;
      } else if (dataType === 'observasi') {
        systemPrompt += `
Instruksi Khusus untuk Data Catatan Observasi (Kualitatif/Lapangan):
1. Ubah poin-poin acak dan tidak terstruktur dari lapangan menjadi sebuah narasi laporan pengamatan yang deskriptif dan runtut.
2. Gunakan sudut pandang orang ketiga (pengamat/peneliti). Jangan gunakan kata "Saya", gunakan "Peneliti".
3. Kelompokkan pengamatan berdasarkan aspek (misal: kondisi fisik, interaksi, kendala).
4. Contoh bahasa: "Berdasarkan hasil observasi lapangan yang dilakukan di lokasi penelitian, peneliti menemukan bahwa..."`;
      }
    }

    const inputData = previousResult ? `Draf Saat Ini:\n\n${previousResult}\n\nUbah draf di atas sesuai instruksi.` : `Data Mentah:\n\n${rawData}\n\nBuatkan draf laporannya sekarang.`;

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: inputData }
      ],
      temperature: 0.3,
      max_tokens: 3500,
    });

    const aiResponse = response.choices[0].message.content || "";

    return NextResponse.json({ 
      success: true, 
      data: aiResponse 
    });
  } catch (error: unknown) {
    console.error("API /api/ai/synthesize-data Error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, "Gagal menghasilkan laporan, silakan coba lagi.") },
      { status: 500 }
    );
  }
}

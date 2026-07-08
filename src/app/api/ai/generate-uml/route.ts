import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertAiConfigured();

    const { prompt, diagramType, existingNodes = [], existingEdges = [] } = await req.json();

    if (!prompt) {
      return NextResponse.json({ success: false, error: "Prompt tidak boleh kosong" }, { status: 400 });
    }

    let typeDesc = 'Flowchart (dengan node start, process, decision, end)';
    let nodeTypes = "'start', 'process', 'decision', 'end'";
    if (diagramType === 'usecase') {
      typeDesc = 'Usecase Diagram (dengan actor dan usecase)';
      nodeTypes = "'actor', 'usecase'";
    } else if (diagramType === 'activity') {
      typeDesc = 'Activity Diagram (UML standard, menggunakan: start, activity, decision, fork, join, end)';
      nodeTypes = "'start', 'activity', 'decision', 'fork', 'join', 'end'";
    }

    const systemPrompt = `Anda adalah arsitek sistem informasi dan ahli pemodelan UML untuk aplikasi diagram berbasis SVG.
Tugas Anda adalah mengubah deskripsi pengguna menjadi representasi JSON untuk ${typeDesc}.
Jika pengguna memberikan data diagram yang sudah ada (existing nodes/edges), Anda HARUS menyertakan kembali data tersebut dan memodifikasinya sesuai instruksi pengguna. Jangan mulai dari awal jika ada data yang sudah ada, kecuali diminta.

Tujuan kualitas:
- Hasil harus detail, logis, dan siap ditempel ke diagram skripsi/laporan.
- Jangan membuat diagram terlalu pendek. Untuk proses nyata, gunakan 6-14 node jika prompt cukup.
- Pecah aktivitas besar menjadi langkah operasional yang spesifik.
- Jaga urutan sebab-akibat. Setiap decision harus punya cabang YES dan NO yang jelas.
- Label node singkat, tetapi bermakna. Hindari label generik seperti "Proses" atau "Validasi" tanpa objek.
- Jangan membuat node, edge, atau tipe diagram yang belum didukung web.

Mode klarifikasi:
Jika instruksi pengguna terlalu kabur sehingga diagram berisiko salah total, jangan menebak berlebihan. Balas JSON dengan:
{
  "needsClarification": true,
  "clarification": "Satu pertanyaan singkat dan spesifik dalam Bahasa Indonesia"
}
Gunakan mode klarifikasi hanya jika informasi inti hilang, misalnya tidak jelas sistem apa, aktor utama, atau alur bisnis yang dimaksud.

FORMAT OUTPUT HARUS BERUPA JSON VALID TANPA MARKDOWN CODE BLOCKS.
Jika sudah cukup untuk membuat diagram, struktur JSON yang diharapkan:
{
  "needsClarification": false,
  "nodes": [
    {
      "id": "String unik (misal: node-1)",
      "type": "String. Untuk diagram ini: ${nodeTypes}",
      "text": "Label teks singkat dan padat",
      "lines": ["Baris 1", "Baris 2"],
      "x": 500,
      "y": 100,
      "width": 140, 
      "height": 80,
      "yes": "ID node tujuan untuk opsi ya (HANYA untuk decision)",
      "no": "ID node tujuan untuk opsi tidak (HANYA untuk decision)",
      "side": "left atau right (HANYA untuk actor di usecase)"
    }
  ],
  "edges": [
    {
      "id": "String unik (misal: edge-1)",
      "fromId": "ID node asal",
      "toId": "ID node tujuan",
      "label": "Teks label (misal: YES, NO, atau dikosongkan)",
      "dashed": false
    }
  ]
}

Aturan Penting:
1. Jawab HANYA dengan JSON mentah. Jangan tambahkan penjelasan teks apapun di luar JSON.
2. Jangan gunakan \`\`\`json atau \`\`\`. Langsung mulai dengan karakter { dan diakhiri dengan }.
3. Pastikan setiap 'toId' dan 'fromId' di edges merujuk pada 'id' yang benar di array nodes.
4. Jika membuat 'decision', pastikan ada edge untuk 'YES' dan 'NO', serta isi property 'yes' dan 'no' pada node tersebut dengan ID tujuan.
5. Buat logika flow yang komprehensif berdasarkan deskripsi pengguna.
6. Pastikan alur mengalir dominan secara VERTIKAL (ke bawah). Hindari membuat terlalu banyak cabang menyamping jika alur bisa dibuat berurutan ke bawah.
7. Untuk Activity Diagram:
   - Gunakan 'start' untuk Initial Node.
   - Gunakan 'activity' untuk Action State (rounded rectangle).
   - Gunakan 'decision' untuk Decision/Merge Node (diamond).
   - Gunakan 'fork' (pencabangan sejalan) dan 'join' (penggabungan sejalan) jika ada proses paralel.
   - Gunakan 'end' untuk Final Node.
8. Berikan label yang jelas pada setiap edge, terutama pada cabang decision (YES/NO).
9. Untuk Flowchart, gunakan node 'start', 'process', 'decision', dan 'end'. Jangan gunakan 'activity'.
10. Untuk Use Case, actor harus memiliki side 'left' atau 'right', usecase harus berupa tujuan/fungsi sistem, dan edge menghubungkan actor ke usecase yang relevan.
11. Untuk Activity Diagram, gunakan 'activity', bukan 'process', kecuali start/end/decision/fork/join.`;

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Data diagram saat ini:\nNodes: ${JSON.stringify(existingNodes)}\nEdges: ${JSON.stringify(existingEdges)}\n\nInstruksi pengguna: Buatkan atau modifikasi representasi JSON untuk diagram ini berdasarkan instruksi berikut: ${prompt}` }
      ],
      temperature: 0.15,
      max_tokens: 4000,
    });

    const aiResponse = response.choices[0].message.content || "";

    // Parsing the JSON safely, accounting for possible markdown block leakage
    let jsonString = aiResponse.trim();
    if (jsonString.startsWith('```json')) {
      jsonString = jsonString.substring(7);
      if (jsonString.endsWith('```')) {
        jsonString = jsonString.substring(0, jsonString.length - 3);
      }
    } else if (jsonString.startsWith('```')) {
      jsonString = jsonString.substring(3);
      if (jsonString.endsWith('```')) {
        jsonString = jsonString.substring(0, jsonString.length - 3);
      }
    }
    
    const parsedData = JSON.parse(jsonString.trim());

    if (parsedData.needsClarification) {
      return NextResponse.json({
        success: false,
        needsClarification: true,
        clarification: parsedData.clarification || "Bisa jelaskan alur atau aktor utamanya dulu?",
      });
    }

    return NextResponse.json({ 
      success: true, 
      data: parsedData 
    });
  } catch (error: any) {
    console.error("API /api/ai/generate-uml Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal menghasilkan diagram, coba lagi dengan prompt berbeda." },
      { status: 500 }
    );
  }
}

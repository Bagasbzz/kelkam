import { NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

const grokApiKey = process.env.GROK_API_KEY || "";
const openai = new OpenAI({
  apiKey: grokApiKey,
  baseURL: "https://api.groq.com/openai/v1",
});

export async function POST(req: Request) {
  try {
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
      typeDesc = 'Activity Diagram (dengan node start, activity, decision, fork, join, end)';
      nodeTypes = "'start', 'activity', 'decision', 'fork', 'join', 'end'";
    }

    const systemPrompt = `Anda adalah ahli sistem informasi dan pemodelan UML.
Tugas Anda adalah mengubah deskripsi pengguna menjadi representasi JSON untuk ${typeDesc}.
Jika pengguna memberikan data diagram yang sudah ada (existing nodes/edges), Anda HARUS menyertakan kembali data tersebut dan memodifikasinya (menambah, mengubah, atau menghapus) sesuai instruksi pengguna. Jangan mulai dari awal jika ada data yang sudah ada, kecuali diminta.

FORMAT OUTPUT HARUS BERUPA JSON VALID TANPA MARKDOWN CODE BLOCKS.
Struktur JSON yang diharapkan:
{
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
6. Pastikan urutan proses (khususnya untuk Flowchart dan Activity) dihubungkan dengan rapi sehingga alurnya mengalir lurus ke bawah secara sekuensial.`;

    const response = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile", // Updated to current recommended Groq model
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Data diagram saat ini:\nNodes: ${JSON.stringify(existingNodes)}\nEdges: ${JSON.stringify(existingEdges)}\n\nInstruksi pengguna: Buatkan atau modifikasi representasi JSON untuk diagram ini berdasarkan instruksi berikut: ${prompt}` }
      ],
      temperature: 0.1,
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

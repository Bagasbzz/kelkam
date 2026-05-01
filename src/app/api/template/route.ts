import { NextResponse } from "next/server";
import { generateSmartThesisTemplate, SmartTemplateOptions } from "@/utils/smart-docx-generator";

export async function POST(req: Request) {
  try {
    const body: SmartTemplateOptions = await req.json();

    if (!body.studentName || !body.thesisTitle || !body.university) {
      return NextResponse.json(
        { success: false, error: "Nama, Judul, dan Universitas wajib diisi." },
        { status: 400 }
      );
    }

    const buffer = await generateSmartThesisTemplate(body);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="template-skripsi-${body.studentName.replace(/\s+/g, '-').toLowerCase()}.docx"`,
      },
    });
  } catch (error) {
    console.error("Error generating smart template:", error);
    return NextResponse.json(
      { success: false, error: "Gagal membuat template skripsi pintar." },
      { status: 500 }
    );
  }
}

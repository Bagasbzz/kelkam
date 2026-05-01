import { NextResponse } from 'next/server';
import { parseThesisStructure } from '@/utils/structure-parser';
import mammoth from 'mammoth';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!file.name.endsWith('.docx')) {
      return NextResponse.json({ error: 'Please upload a .docx file' }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract raw text using mammoth
    const { value: text } = await mammoth.extractRawText({ buffer });

    // Parse structure with tolerant logic
    const parseResult = parseThesisStructure(text);

    return NextResponse.json(parseResult);
  } catch (error) {
    console.error('API Error /fix-format:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat memproses dokumen.' }, { status: 500 });
  }
}

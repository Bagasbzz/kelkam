import { 
  Document, Packer, Paragraph, TextRun, 
  HeadingLevel, AlignmentType, ImageRun, 
  Table, TableRow, TableCell, WidthType,
  UnderlineType
} from "docx";
import { saveAs } from 'file-saver';
import { ThesisSettings } from "@/lib/types/thesis";

function mmToTwips(mm: number): number {
    return Math.round(mm * 56.7);
}

const mapAlignment = (align?: string) => {
    switch (align) {
        case 'center': return AlignmentType.CENTER;
        case 'right': return AlignmentType.RIGHT;
        case 'justify': return AlignmentType.JUSTIFIED;
        default: return AlignmentType.LEFT;
    }
};

function generateChildren(content: any, settings: ThesisSettings): any[] {
  const children: any[] = [];
  if (!content || !content.content) return children;

  content.content.forEach((node: any) => {
    if (node.type === 'heading' || node.type === 'paragraph') {
      const alignment = mapAlignment(node.attrs?.textAlign || (node.type === 'heading' && node.attrs.level === 1 ? 'center' : 'justify'));
      
      const textNodes = node.content?.map((c: any) => {
        const marks = c.marks || [];
        const fontSizeAttr = marks.find((m: any) => m.type === 'fontSize')?.attrs?.fontSize;
        const colorAttr = marks.find((m: any) => m.type === 'color')?.attrs?.color;
        
        const sizeValue = fontSizeAttr ? parseInt(fontSizeAttr) : (node.type === 'heading' ? (node.attrs.level === 1 ? 14 : 12) : settings.font.sizeBody);

        return new TextRun({
          text: c.text || "",
          bold: node.type === 'heading' || marks.some((m: any) => m.type === 'bold'),
          italics: marks.some((m: any) => m.type === 'italic'),
          underline: marks.some((m: any) => m.type === 'underline') ? { type: UnderlineType.SINGLE } : undefined,
          color: colorAttr?.replace('#', ''),
          size: sizeValue * 2 as any, // Bypass strict type check for size
          font: settings.font.family,
        } as any);
      }) || [];

      children.push(
        new Paragraph({
          children: textNodes,
          alignment: alignment,
          heading: node.type === 'heading' ? (node.attrs.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2) : undefined,
          spacing: { 
            line: Math.round(settings.font.lineSpacing * 240), 
            before: node.type === 'heading' ? 400 : 0, 
            after: node.type === 'heading' ? 200 : 0 
          },
        } as any)
      );
    } else if (node.type === 'smartImage') {
      const base64Data = node.attrs.src.split(',')[1];
      if (base64Data) {
          const imageBuffer = Buffer.from(base64Data, 'base64');
          children.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new ImageRun({
                        data: imageBuffer,
                        transformation: {
                            width: 500,
                            height: 350,
                        },
                    } as any),
                ],
            }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({
                        text: `${node.attrs.label || 'Gambar'} ${node.attrs.caption || ''}`,
                        bold: true,
                        size: 20, // 10pt
                        font: settings.font.family,
                    })
                ],
                spacing: { before: 120, after: 240 }
            })
          );
      }
    }
  });

  return children;
}

export async function exportToDocx(content: any, settings: ThesisSettings) {
  const children = generateChildren(content, settings);

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: mmToTwips(settings.margins.top),
            left: mmToTwips(settings.margins.left),
            right: mmToTwips(settings.margins.right),
            bottom: mmToTwips(settings.margins.bottom),
          },
        },
      },
      children: children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `skripsi-${new Date().getTime()}.docx`);
}

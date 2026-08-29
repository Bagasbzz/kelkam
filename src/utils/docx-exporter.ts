import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  type IImageOptions,
  type IParagraphOptions,
  UnderlineType,
} from "docx";
import { saveAs } from "file-saver";
import type { RichTextNode, ThesisSettings } from "@/lib/types/thesis";

function mmToTwips(mm: number): number {
  return Math.round(mm * 56.7);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNodeAttr(node: RichTextNode, key: string): unknown {
  return isRecord(node.attrs) ? node.attrs[key] : undefined;
}

function getTextChildren(node: RichTextNode): RichTextNode[] {
  return Array.isArray(node.content) ? node.content : [];
}

function getImageType(src: string): "jpg" | "png" | "gif" | "bmp" | null {
  if (src.startsWith("data:image/png")) return "png";
  if (src.startsWith("data:image/jpeg")) return "jpg";
  if (src.startsWith("data:image/jpg")) return "jpg";
  if (src.startsWith("data:image/gif")) return "gif";
  if (src.startsWith("data:image/bmp")) return "bmp";
  return null;
}

const mapAlignment = (align?: string) => {
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
};

function generateChildren(content: RichTextNode, settings: ThesisSettings): Paragraph[] {
  const children: Paragraph[] = [];
  if (!content?.content) return children;

  content.content.forEach((node) => {
    if (node.type === "heading" || node.type === "paragraph") {
      const nodeLevel = Number(getNodeAttr(node, "level") || 0);
      const alignment = mapAlignment(String(getNodeAttr(node, "textAlign") || (node.type === "heading" && nodeLevel === 1 ? "center" : "justify")));
      const textNodes = getTextChildren(node).map((child) => {
        const marks = Array.isArray(child.marks) ? child.marks : [];
        const fontSizeAttr = marks.find((mark) => mark.type === "fontSize" && isRecord(mark.attrs))?.attrs?.fontSize;
        const colorAttr = marks.find((mark) => mark.type === "color" && isRecord(mark.attrs))?.attrs?.color;
        const sizeValue = typeof fontSizeAttr === "string"
          ? parseInt(fontSizeAttr, 10)
          : node.type === "heading"
            ? nodeLevel === 1
              ? 14
              : 12
            : settings.font.sizeBody;

        return new TextRun({
          text: child.text || "",
          bold: node.type === "heading" || marks.some((mark) => mark.type === "bold"),
          italics: marks.some((mark) => mark.type === "italic"),
          underline: marks.some((mark) => mark.type === "underline") ? { type: UnderlineType.SINGLE } : undefined,
          color: typeof colorAttr === "string" ? colorAttr.replace("#", "") : undefined,
          size: sizeValue * 2,
          font: settings.font.family,
        });
      });

      const paragraphOptions: IParagraphOptions = {
        children: textNodes,
        alignment,
        heading: node.type === "heading" ? (nodeLevel === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2) : undefined,
        spacing: {
          line: Math.round(settings.font.lineSpacing * 240),
          before: node.type === "heading" ? 400 : 0,
          after: node.type === "heading" ? 200 : 0,
        },
      };

      children.push(new Paragraph(paragraphOptions));
    } else if (node.type === "smartImage") {
      const src = typeof getNodeAttr(node, "src") === "string" ? String(getNodeAttr(node, "src")) : "";
      const base64Data = src.split(",")[1];
      const imageType = getImageType(src);
      if (base64Data && imageType) {
        const imageBuffer = Buffer.from(base64Data, "base64");
        const imageOptions: IImageOptions = {
          type: imageType,
          data: imageBuffer,
          transformation: {
            width: 500,
            height: 350,
          },
        };

        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun(imageOptions)],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `${String(getNodeAttr(node, "label") || "Gambar")} ${String(getNodeAttr(node, "caption") || "")}`.trim(),
                bold: true,
                size: 20,
                font: settings.font.family,
              }),
            ],
            spacing: { before: 120, after: 240 },
          })
        );
      }
    }
  });

  return children;
}

export async function exportToDocx(content: RichTextNode, settings: ThesisSettings) {
  const children = generateChildren(content, settings);

  const doc = new Document({
    sections: [
      {
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
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `dokumen-akademik-${Date.now()}.docx`);
}

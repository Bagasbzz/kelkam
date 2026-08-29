export type PaperSize = "A4" | "Letter";

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FontSettings {
  family: string;
  sizeBody: number;
  sizeHeading1: number;
  sizeHeading2: number;
  lineSpacing: number;
}

export interface ThesisMetadata {
  title: string;
  studentName: string;
  nim: string;
  university: string;
  faculty: string;
  prodi: string;
  supervisor: string;
  year: string;
  method: string;
  object: string;
  problem: string;
}

export interface ThesisSettings {
  paperSize: PaperSize;
  margins: Margins;
  font: FontSettings;
  paragraphIndent: number;
  alignment: "justify" | "left" | "center";
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichTextNode[];
}

export interface ThesisSection {
  id: string;
  title: string;
  level: number;
  content?: RichTextNode; // Content specifically for this section
  children: ThesisSection[];
}

export interface ThesisDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
  metadata: ThesisMetadata;
  settings: ThesisSettings;
  sections: ThesisSection[]; // Tree structure for stability
  content: RichTextNode; // Full ProseMirror/Tiptap JSON for the editor
}

export const THESIS_PRESETS: Record<string, ThesisSettings> = {
  "Standar Indonesia": {
    paperSize: "A4",
    margins: { top: 40, left: 40, right: 30, bottom: 30 }, // in mm
    font: {
      family: "Times New Roman",
      sizeBody: 12,
      sizeHeading1: 14,
      sizeHeading2: 12,
      lineSpacing: 1.5,
    },
    paragraphIndent: 12.5,
    alignment: "justify",
  },
  "UI": {
    paperSize: "A4",
    margins: { top: 40, left: 40, right: 30, bottom: 30 },
    font: {
      family: "Times New Roman",
      sizeBody: 12,
      sizeHeading1: 14,
      sizeHeading2: 12,
      lineSpacing: 1.5,
    },
    paragraphIndent: 10,
    alignment: "justify",
  },
  // Additional presets can be added here
};

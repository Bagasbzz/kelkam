
import { ThesisSection } from "@/lib/types/thesis";
import { v4 as uuidv4 } from 'uuid';

export interface ParseResult {
  sections: ThesisSection[];
  stats: {
    chapters: number;
    subChapters: number;
    paragraphs: number;
  };
  rawParagraphs: string[];
}

/**
 * Tolerant parser for thesis structure.
 * Detects BAB I, Bab 1, 1.1, 1.1.1 and fallback patterns.
 */
export function parseThesisStructure(text: string): ParseResult {
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
  const sections: ThesisSection[] = [];
  const stats = { chapters: 0, subChapters: 0, paragraphs: 0 };
  
  let currentChapter: ThesisSection | null = null;
  let currentSubChapter: ThesisSection | null = null;

  // Regex patterns
  const chapterRegex = /^(BAB|Chapter)\s+([0-9]+|[IVX]+)/i;
  const subChapter2Regex = /^(\d+)\.(\d+)(\s+|$)/;
  const subChapter3Regex = /^(\d+)\.(\d+)\.(\d+)(\s+|$)/;

  paragraphs.forEach(p => {
    let level = 0; // 0 = paragraph, 1 = BAB, 2 = 1.1, 3 = 1.1.1
    let title = p;

    // 1. Detection Logic
    if (chapterRegex.test(p)) {
      level = 1;
    } else if (subChapter3Regex.test(p)) {
      level = 3;
    } else if (subChapter2Regex.test(p)) {
      level = 2;
    } else {
      // 2. Fallback Detection for non-numbered
      // Check for ALL CAPS lines that are relatively short as potential headings
      const isAllCaps = p === p.toUpperCase() && p.length < 100 && p.length > 5;
      const isShort = p.length < 50;
      
      if (isAllCaps && isShort) {
        // If it contains typical thesis keywords but no numbers
        const keywords = ['PENDAHULUAN', 'PUSTAKA', 'METODOLOGI', 'HASIL', 'PEMBAHASAN', 'KESIMPULAN', 'SARAN'];
        if (keywords.some(k => p.includes(k))) {
            level = 1;
        } else if (isShort) {
            // Potential sub-chapter if it's short and capitalised
            level = 2;
        }
      }
    }

    // 3. Tree Building
    if (level === 1) {
      const section: ThesisSection = {
        id: `section_${uuidv4().slice(0, 8)}`,
        title: title,
        level: 1,
        children: [],
        content: { type: 'doc', content: [] }
      };
      sections.push(section);
      currentChapter = section;
      currentSubChapter = null;
      stats.chapters++;
    } else if (level === 2 && currentChapter) {
      const section: ThesisSection = {
        id: `section_${uuidv4().slice(0, 8)}`,
        title: title,
        level: 2,
        children: [],
        content: { type: 'doc', content: [] }
      };
      currentChapter.children.push(section);
      currentSubChapter = section;
      stats.subChapters++;
    } else if (level === 3 && currentSubChapter) {
      const section: ThesisSection = {
        id: `section_${uuidv4().slice(0, 8)}`,
        title: title,
        level: 3,
        children: [],
        content: { type: 'doc', content: [] }
      };
      currentSubChapter.children.push(section);
      stats.subChapters++;
    } else {
      // It's a paragraph
      stats.paragraphs++;
      // Add to current open section if possible
      const target = currentSubChapter || currentChapter;
      if (target) {
        if (!target.content) target.content = { type: 'doc', content: [] };
        target.content.content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: p }]
        });
      } else {
        // No section yet, add to a default "Intro" section?
        // Let's create one if needed
        if (sections.length === 0) {
            const intro: ThesisSection = {
                id: 'section_intro',
                title: 'Dokumen Tanpa Judul',
                level: 1,
                children: [],
                content: { type: 'doc', content: [] }
            };
            sections.push(intro);
            currentChapter = intro;
        }
        currentChapter!.content.content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: p }]
        });
      }
    }
  });

  return { sections, stats, rawParagraphs: paragraphs };
}

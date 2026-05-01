"use client";
import { GripVertical, Plus, Trash2, ChevronUp, ChevronDown, FileText } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';

interface StructureItem {
  id: string;
  type: 'chapter' | 'subchapter';
  title: string;
  level: number;
  displayLabel: string;
}

interface StructureSidebarProps {
  content: any; // Direct Tiptap JSON
  onUpdate: (newContent: any) => void;
}

export default function StructureSidebar({ content, onUpdate }: StructureSidebarProps) {
  
  const toRoman = (num: number) => {
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
    return roman[num - 1] || num.toString();
  };

  const extractHeadings = (json: any): StructureItem[] => {
    if (!json || !json.content) return [];
    
    let chapterCount = 0;
    let subchapterCount = 0;
    
    return json.content
      .filter((node: any) => node.type === 'heading')
      .map((node: any) => {
        const level = node.attrs?.level || 1;
        let label = "";
        
        if (level === 1) {
          chapterCount++;
          subchapterCount = 0;
          label = `BAB ${toRoman(chapterCount)}`;
        } else {
          subchapterCount++;
          label = `${chapterCount}.${subchapterCount}`;
        }

        return {
          id: node.attrs?.id || `h-${Math.random().toString(36).substr(2, 9)}`,
          type: level === 1 ? 'chapter' : 'subchapter',
          title: node.content?.[0]?.text || "Tanpa Judul",
          level: level,
          displayLabel: label
        };
      });
  };

  const reorder = (id: string, dir: 'up' | 'down') => {
    if (!content || !content.content) return;
    const nodes = [...content.content];
    
    // Find the heading and its associated content block (until next heading)
    const headingIndex = nodes.findIndex(n => n.type === 'heading' && n.attrs?.id === id);
    if (headingIndex === -1) return;

    // Find the end of this section (the next heading or EOF)
    let sectionEnd = headingIndex + 1;
    while (sectionEnd < nodes.length && nodes[sectionEnd].type !== 'heading') {
        sectionEnd++;
    }
    const sectionNodes = nodes.slice(headingIndex, sectionEnd);

    // Find target insertion point
    let targetIndex = -1;
    if (dir === 'up') {
        // Find previous heading
        let prevHeading = headingIndex - 1;
        while (prevHeading >= 0 && nodes[prevHeading].type !== 'heading') {
            prevHeading--;
        }
        if (prevHeading !== -1) targetIndex = prevHeading;
    } else {
        // Find next heading
        if (sectionEnd < nodes.length) targetIndex = sectionEnd;
        // If target is down, we need to find the END of the next section to swap
        if (targetIndex !== -1) {
            let nextSectionEnd = targetIndex + 1;
            while (nextSectionEnd < nodes.length && nodes[nextSectionEnd].type !== 'heading') {
                nextSectionEnd++;
            }
            // Splice current section AFTER next section
            const remainingNodes = nodes.filter((_, i) => i < headingIndex || i >= sectionEnd);
            remainingNodes.splice(nextSectionEnd - sectionNodes.length, 0, ...sectionNodes);
            onUpdate({ ...content, content: remainingNodes });
            return;
        }
    }

    if (targetIndex !== -1) {
        const remainingNodes = nodes.filter((_, i) => i < headingIndex || i >= sectionEnd);
        remainingNodes.splice(targetIndex, 0, ...sectionNodes);
        onUpdate({ ...content, content: remainingNodes });
    }
  };

  const removeSection = (id: string) => {
    if (!content || !content.content) return;
    const nodes = [...content.content];
    const headingIndex = nodes.findIndex(n => n.type === 'heading' && n.attrs?.id === id);
    if (headingIndex === -1) return;

    let sectionEnd = headingIndex + 1;
    while (sectionEnd < nodes.length && nodes[sectionEnd].type !== 'heading') {
        sectionEnd++;
    }

    const newNodes = nodes.filter((_, i) => i < headingIndex || i >= sectionEnd);
    onUpdate({ ...content, content: newNodes });
  };

  const addSection = () => {
    if (!content || !content.content) return;
    const newId = `section_${uuidv4().slice(0, 8)}`;
    const newNode = {
      type: 'heading',
      attrs: { level: 1, id: newId },
      content: [{ type: 'text', text: 'BAB BARU' }]
    };
    const newNodes = [...content.content, newNode, { type: 'paragraph' }];
    onUpdate({ ...content, content: newNodes });
  };

  const headings = extractHeadings(content);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {headings.map((item, idx) => (
          <div 
            key={item.id}
            className={`group flex items-center gap-3 p-3 rounded-2xl transition-all border cursor-pointer ${
                item.type === 'chapter' 
                ? 'bg-blue-50/30 border-blue-50 hover:border-blue-200' 
                : 'bg-white border-transparent hover:bg-gray-50'
            }`}
          >
            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={(e) => { e.stopPropagation(); reorder(item.id, 'up'); }} 
                  className="p-0.5 hover:bg-gray-100 rounded"
                  title="Pindah ke Atas"
                >
                    <ChevronUp className="w-3 h-3 text-gray-400" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); reorder(item.id, 'down'); }} 
                  className="p-0.5 hover:bg-gray-100 rounded"
                  title="Pindah ke Bawah"
                >
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>
            </div>
            <div className={`shrink-0 min-w-10 h-8 px-2 rounded-xl flex items-center justify-center font-black text-[9px] ${
                item.type === 'chapter' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'bg-gray-100 text-gray-400'
            }`}>
                {item.displayLabel}
            </div>
            <div className="flex-1 min-w-0">
               <p className={`text-xs truncate ${item.type === 'chapter' ? 'font-black text-gray-900 uppercase' : 'font-bold text-gray-600'}`}>
                 {item.title}
               </p>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); removeSection(item.id); }}
              className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 rounded-lg transition-all text-gray-400"
              title="Hapus Bagian ini"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        <button 
          onClick={addSection}
          className="w-full py-4 border-2 border-dashed border-gray-100 rounded-[2rem] text-gray-400 hover:border-blue-200 hover:text-blue-500 transition-all flex items-center justify-center gap-2 mt-4"
        >
            <Plus className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Tambah Bagian</span>
        </button>
      </div>

      <div className="p-4 bg-gray-900 m-4 rounded-[2rem] text-white">
          <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-white/10 rounded-xl">
                  <FileText className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest">Bantuan Struktur</p>
          </div>
          <p className="text-[10px] text-gray-400 leading-relaxed font-medium">
             Gunakan menu ini untuk melompat antar Bab atau mengatur ulang urutan skripsi Anda.
          </p>
      </div>
    </div>
  );
}

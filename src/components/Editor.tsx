"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { Heading } from '@tiptap/extension-heading';
import { TextAlign } from '@tiptap/extension-text-align';
import { SmartImage } from './editor/extensions/SmartImage';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { Highlight } from '@tiptap/extension-highlight';
import { Underline } from '@tiptap/extension-underline';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { 
  Bold, Italic, Underline as UnderlineIcon, 
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Type, Heading1, Heading2, Heading3, Image as ImageIcon,
  Highlighter, Quote, Minus
} from 'lucide-react';
import { SlashCommand } from './editor/extensions/SlashCommand';
import { suggestion } from './editor/extensions/suggestion';

// Custom Font Size Extension
export const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return {
      types: ['textStyle'],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => element.style.fontSize.replace(/['"]+/g, ''),
            renderHTML: attributes => {
              if (!attributes.fontSize) {
                return {};
              }
              return {
                style: `font-size: ${attributes.fontSize}`,
              };
            },
          },
        },
      },
    ];
  },
});

interface SkripsiEditorProps {
  content: any;
  onChange: (json: any) => void;
}

export default function SkripsiEditor({ content, onChange }: SkripsiEditorProps) {
  const [isMount, setIsMount] = useState(false);

  useEffect(() => {
    setIsMount(true);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      SmartImage.configure({
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: 'Mulai menulis skripsi Anda di sini atau ketik "/" untuk bantuan...',
      }),
      SlashCommand.configure({
        suggestion,
      }),
      Heading.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            id: {
              default: null,
              parseHTML: element => element.getAttribute('id'),
              renderHTML: attributes => {
                if (!attributes.id) {
                  return {};
                }
                return { id: attributes.id };
              },
            },
          };
        },
      }).configure({
        levels: [1, 2, 3],
      }),
    ],
    content: content,
    onUpdate: ({ editor }) => {
      // Auto-Labeling for Images
      const json = editor.getJSON();
      let currentChapter = 0;
      let currentImageInChapter = 0;
      
      const newContent = json.content?.map((node: any) => {
        if (node.type === 'heading' && node.attrs.level === 1) {
          currentChapter++;
          currentImageInChapter = 0;
        }
        if (node.type === 'smartImage') {
          currentImageInChapter++;
          const label = `Gambar ${currentChapter}.${currentImageInChapter}`;
          if (node.attrs.label !== label) {
            return { ...node, attrs: { ...node.attrs, label } };
          }
        }
        return node;
      });

      // Avoid infinite loop by checking if changes actually occurred
      if (JSON.stringify(newContent) !== JSON.stringify(json.content)) {
        // We use a slight delay or command to update without re-triggering onUpdate immediately if possible
        // but for now, we just pass to onChange
        onChange({ ...json, content: newContent });
      } else {
        onChange(json);
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none font-serif min-h-[1123px] page-render',
      },
    },
  });

  // Sync external content changes back to editor
  useEffect(() => {
    if (editor && content && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  if (!editor || !isMount) return null;

  return (
    <div className="w-full h-full relative">
      <style dangerouslySetInnerHTML={{ __html: `
        .page-render {
          background-image: linear-gradient(to bottom, transparent 1122px, #f3f4f6 1122px, #f3f4f6 1123px, transparent 1123px);
          background-size: 100% 1123px;
        }
      `}} />
      {editor && (
        <BubbleMenu editor={editor} updateDelay={100} className="flex items-center gap-1 p-1 bg-white border border-gray-100 shadow-2xl rounded-xl">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive('bold') ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive('italic') ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive('underline') ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <UnderlineIcon className="w-4 h-4" />
          </button>
          
          <div className="w-px h-4 bg-gray-100 mx-1" />
          
          <button
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive({ textAlign: 'left' }) ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive({ textAlign: 'center' }) ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive({ textAlign: 'justify' }) ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <AlignJustify className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-gray-100 mx-1" />

          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive('heading', { level: 1 }) ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <Heading1 className="w-4 h-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-2 rounded-lg transition-all ${editor.isActive('heading', { level: 2 }) ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-500'}`}
          >
            <Heading2 className="w-4 h-4" />
          </button>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}

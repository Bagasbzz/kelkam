import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import 'tippy.js/dist/tippy.css' // Add CSS for tippy
import { CommandList } from '../CommandList'
import type { CommandListHandle, CommandListProps } from '../CommandList'
import React from 'react'
import type { Editor, JSONContent, Range } from '@tiptap/core'
import type { Instance } from 'tippy.js'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { 
  Heading1, Heading2, Heading3,
  Type, Image as ImageIcon, Sparkles,
  Quote, FileText
} from 'lucide-react'

interface CommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  command: (props: { editor: Editor; range: Range }) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTextFromNode(node: JSONContent | null | undefined): string {
  if (!node || !Array.isArray(node.content)) return "";
  return node.content.map((child) => (typeof child.text === "string" ? child.text : "")).join("");
}

function getNodeAttr(node: JSONContent, key: string): unknown {
  return isRecord(node.attrs) ? node.attrs[key] : undefined;
}

export const suggestion = {
  items: ({ query }: { query: string }) => {
    return [
      {
        title: 'Heading 1',
        description: 'Judul Bab Utama (BAB I, dst)',
        icon: <Heading1 className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
        },
      },
      {
        title: 'Heading 2',
        description: 'Sub-bab (1.1, dst)',
        icon: <Heading2 className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
        },
      },
      {
        title: 'Heading 3',
        description: 'Sub-sub-bab (1.1.1, dst)',
        icon: <Heading3 className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
        },
      },
      {
        title: 'Paragraf',
        description: 'Teks biasa',
        icon: <Type className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          editor.chain().focus().deleteRange(range).setNode('paragraph').run()
        },
      },
      {
        title: 'Gambar',
        description: 'Sisipkan gambar dari komputer',
        icon: <ImageIcon className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.onchange = async () => {
             if (input.files?.[0]) {
                const reader = new FileReader()
                reader.onload = (e) => {
                    const base64 = e.target?.result as string
                    editor.chain().focus().deleteRange(range).setImage({ src: base64 }).run()
                }
                reader.readAsDataURL(input.files[0])
             }
          }
          input.click()
        },
      },
      {
        title: 'Daftar Isi Otomatis',
        description: 'Update daftar isi berdasarkan judul bab',
        icon: <FileText className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          const json = editor.getJSON()
          const headings = (Array.isArray(json.content) ? json.content : []).filter((node) => node.type === 'heading') as JSONContent[]
          
          const tocContent = headings.map((heading) => {
            const level = typeof getNodeAttr(heading, 'level') === 'number' ? Number(getNodeAttr(heading, 'level')) : 1
            const text = getTextFromNode(heading)
            const indent = level > 1 ? '      ' : ''
            return { type: 'paragraph', content: [{ type: 'text', text: `${indent}${text}` }] }
          })

          editor.chain().focus().deleteRange(range)
            .insertContent([
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'DAFTAR ISI' }] },
              ...tocContent,
              { type: 'paragraph' }
            ]).run()
        },
      },
      {
        title: 'Daftar Gambar',
        description: 'Hasilkan daftar gambar otomatis',
        icon: <ImageIcon className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          const json = editor.getJSON()
          const images = (Array.isArray(json.content) ? json.content : []).filter((node) => node.type === 'smartImage') as JSONContent[]
          
          const listContent = images.map((image) => {
            const label = typeof getNodeAttr(image, 'label') === 'string' ? String(getNodeAttr(image, 'label')) : 'Gambar'
            const caption = typeof getNodeAttr(image, 'caption') === 'string' ? String(getNodeAttr(image, 'caption')) : ''
            return { type: 'paragraph', content: [{ type: 'text', text: `${label} ${caption}`.trim() }] }
          })

          editor.chain().focus().deleteRange(range)
            .insertContent([
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'DAFTAR GAMBAR' }] },
              ...listContent,
              { type: 'paragraph' }
            ]).run()
        },
      },
      {
        title: 'AI Paraphrase',
        description: 'Perbaiki kalimat agar lebih akademis',
        icon: <Sparkles className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
          const text = prompt("Masukkan kalimat yang ingin diperbaiki:")
          if (text) {
             editor.chain().focus().deleteRange(range)
               .insertContent([{ type: 'paragraph', content: [{ type: 'text', text: `[AI Refining...]: ${text}` }] }])
               .run()
             
             // Simulate AI processing
             setTimeout(() => {
                editor.commands.insertContentAt(editor.state.selection.from, `Versi Akademik: ${text} (Selesai diperbaiki oleh AI)`)
             }, 1500)
          }
        },
      },
      {
        title: 'Smart DOI Fetcher',
        description: 'Buat sitasi dari link atau DOI',
        icon: <Quote className="w-4 h-4" />,
        command: ({ editor, range }: { editor: Editor; range: Range }) => {
           const doi = prompt("Masukkan DOI atau URL Jurnal:")
           if (doi) {
              editor.chain().focus().deleteRange(range)
                .insertContent([{ type: 'paragraph', content: [{ type: 'text', text: `[Fetching Citation...]: ${doi}` }] }])
                .run()
              
              // Simulate Fetching
              setTimeout(() => {
                 editor.commands.insertContentAt(editor.state.selection.from, `Sitasi: Penulis, A. (2024). Judul Artikel Menarik. Jurnal Skripsi Terpadu. https://doi.org/${doi}`)
              }, 1200)
           }
        },
      },
    ].filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
  },

  render: () => {
    let component: ReactRenderer<CommandListHandle, CommandListProps> | null = null
    let popup: Instance | null = null

    return {
      onStart: (props: SuggestionProps<CommandItem, CommandItem>) => {
        component = new ReactRenderer(CommandList, {
          props,
          editor: props.editor,
        })

        if (!props.clientRect) {
          return
        }

        popup = tippy(document.body, {
          getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },

      onUpdate(props: SuggestionProps<CommandItem, CommandItem>) {
        component?.updateProps(props)

        if (!props.clientRect) {
          return
        }

        popup?.setProps({
          getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
        })
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          popup?.hide()
          return true
        }
        return component?.ref?.onKeyDown(props) ?? false
      },

      onExit() {
        popup?.destroy()
        component?.destroy()
      },
    }
  },
}

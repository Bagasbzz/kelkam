import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import 'tippy.js/dist/tippy.css' // Add CSS for tippy
import { CommandList } from '../CommandList'
import React from 'react'
import { 
  Heading1, Heading2, Heading3, 
  Type, Image as ImageIcon, Sparkles, 
  List, ListOrdered, Quote, Code, 
  Table as TableIcon, FileText
} from 'lucide-react'

export const suggestion = {
  items: ({ query }: { query: string }) => {
    return [
      {
        title: 'Heading 1',
        description: 'Judul Bab Utama (BAB I, dst)',
        icon: <Heading1 className="w-4 h-4" />,
        command: ({ editor, range }: any) => {
          editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
        },
      },
      {
        title: 'Heading 2',
        description: 'Sub-bab (1.1, dst)',
        icon: <Heading2 className="w-4 h-4" />,
        command: ({ editor, range }: any) => {
          editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
        },
      },
      {
        title: 'Heading 3',
        description: 'Sub-sub-bab (1.1.1, dst)',
        icon: <Heading3 className="w-4 h-4" />,
        command: ({ editor, range }: any) => {
          editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
        },
      },
      {
        title: 'Paragraf',
        description: 'Teks biasa',
        icon: <Type className="w-4 h-4" />,
        command: ({ editor, range }: any) => {
          editor.chain().focus().deleteRange(range).setNode('paragraph').run()
        },
      },
      {
        title: 'Gambar',
        description: 'Sisipkan gambar dari komputer',
        icon: <ImageIcon className="w-4 h-4" />,
        command: ({ editor, range }: any) => {
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
        command: ({ editor, range }: any) => {
          const json = editor.getJSON()
          const headings = json.content?.filter((n: any) => n.type === 'heading') || []
          
          let chapterCount = 0
          const tocContent = headings.map((h: any) => {
            const level = h.attrs.level
            const text = h.content?.[0]?.text || ''
            if (level === 1) chapterCount++
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
        command: ({ editor, range }: any) => {
          const json = editor.getJSON()
          const images = json.content?.filter((n: any) => n.type === 'smartImage') || []
          
          const listContent = images.map((img: any) => {
            return { type: 'paragraph', content: [{ type: 'text', text: `${img.attrs.label} ${img.attrs.caption || ''}` }] }
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
        command: ({ editor, range }: any) => {
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
        command: ({ editor, range }: any) => {
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
    ].filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
  },

  render: () => {
    let component: any
    let popup: any

    return {
      onStart: (props: any) => {
        component = new ReactRenderer(CommandList, {
          props,
          editor: props.editor,
        })

        if (!props.clientRect) {
          return
        }

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },

      onUpdate(props: any) {
        component.updateProps(props)

        if (!props.clientRect) {
          return
        }

        popup[0].setProps({
          getReferenceClientRect: props.clientRect,
        })
      },

      onKeyDown(props: any) {
        if (props.event.key === 'Escape') {
          popup[0].hide()
          return true
        }
        return component.ref?.onKeyDown(props)
      },

      onExit() {
        popup[0].destroy()
        component.destroy()
      },
    }
  },
}

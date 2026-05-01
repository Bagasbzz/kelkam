import Image from '@tiptap/extension-image'

export const SmartImage = Image.extend({
  name: 'smartImage',
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: '',
        parseHTML: element => element.getAttribute('data-caption'),
        renderHTML: attributes => ({
          'data-caption': attributes.caption,
        }),
      },
      label: {
        default: '',
        parseHTML: element => element.getAttribute('data-label'),
        renderHTML: attributes => ({
          'data-label': attributes.label,
        }),
      }
    }
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure', 
      { class: 'image-figure my-8 flex flex-col items-center' },
      ['img', HTMLAttributes],
      ['figcaption', { class: 'text-[10px] font-black uppercase tracking-widest text-gray-400 mt-2 text-center' }, HTMLAttributes['data-label'] || '', ' ', HTMLAttributes['data-caption'] || '']
    ]
  }
})

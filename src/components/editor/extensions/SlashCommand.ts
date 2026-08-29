import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { Editor } from '@tiptap/core'

interface SlashCommandSuggestionProps {
  editor: Editor;
  range: { from: number; to: number };
}

interface SlashCommandItemProps {
  editor: Editor;
  range: { from: number; to: number };
  props: {
    command: (value: SlashCommandSuggestionProps) => void;
  };
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: SlashCommandItemProps) => {
          props.command({ editor, range })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})

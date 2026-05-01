import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { 
  Heading1, Heading2, Heading3, 
  Type, Image as ImageIcon, Sparkles, 
  List, ListOrdered, Quote, Code, 
  Table as TableIcon, FileText
} from 'lucide-react'

export const CommandList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      props.command(item)
    }
  }

  const upHandler = () => {
    setSelectedIndex(((selectedIndex + props.items.length) - 1) % props.items.length)
  }

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }
      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }
      if (event.key === 'Enter') {
        enterHandler()
        return true
      }
      return false
    },
  }))

  return (
    <div className="bg-white border border-gray-100 shadow-2xl rounded-2xl overflow-hidden p-2 min-w-[280px] animate-in fade-in zoom-in duration-200">
      {props.items.length ? (
        <div className="space-y-1">
          <p className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            Perintah Cepat
          </p>
          {props.items.map((item: any, index: number) => (
            <button
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-all ${
                index === selectedIndex 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                  : 'hover:bg-gray-50 text-gray-700'
              }`}
              key={index}
              onClick={() => selectItem(index)}
            >
              <div className={`p-2 rounded-lg ${index === selectedIndex ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {item.icon}
              </div>
              <div>
                <p className="text-xs font-black leading-tight">{item.title}</p>
                <p className={`text-[10px] ${index === selectedIndex ? 'text-blue-100' : 'text-gray-400'}`}>
                    {item.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-4 text-center">
          <p className="text-xs text-gray-400">Tidak ada perintah ditemukan</p>
        </div>
      )}
    </div>
  )
})

CommandList.displayName = 'CommandList'

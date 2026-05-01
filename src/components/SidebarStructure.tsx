"use client";

import { LayoutPanelLeft, FileText, ChevronRight } from 'lucide-react';

interface SidebarStructureProps {
  content: any;
}

export default function SidebarStructure({ content }: SidebarStructureProps) {
  // Extract headings for navigation
  const headings = content?.content
    ?.filter((node: any) => node.type === 'heading')
    ?.map((node: any, index: number) => ({
      text: node.content ? node.content[0].text : 'Untitled',
      level: node.attrs.level,
      id: index
    })) || [];

  return (
    <div className="w-64 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 flex flex-col hidden lg:flex">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2 font-semibold">
        <LayoutPanelLeft className="w-5 h-5 text-blue-500" />
        Struktur Skripsi
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <nav className="space-y-1">
          {headings.map((heading: any) => (
            <div 
              key={heading.id} 
              className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors cursor-default
                ${heading.level === 1 
                  ? 'font-bold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 shadow-sm border border-gray-100 dark:border-gray-800' 
                  : 'pl-6 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
            >
              <div className={`w-1 h-4 rounded-full ${heading.level === 1 ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-700'}`} />
              <span className="truncate">{heading.text}</span>
            </div>
          ))}
          {headings.length === 0 && (
            <div className="text-gray-400 dark:text-gray-600 text-sm italic p-2">
              Belum ada struktur...
            </div>
          )}
        </nav>
      </div>
    </div>
  );
}

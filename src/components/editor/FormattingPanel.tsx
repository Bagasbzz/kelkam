"use client";

import { ThesisDocument, ThesisSettings, THESIS_PRESETS } from "@/lib/types/thesis";
import { Settings2, ShieldCheck, Type, Maximize2, AlignJustify, AlignLeft, AlignCenter, ChevronDown } from "lucide-react";
import Input from "@/components/ui/Input";
import { useState } from "react";

interface FormattingPanelProps {
  settings: ThesisSettings;
  onUpdate: (newSettings: ThesisSettings) => void;
}

export default function FormattingPanel({ settings, onUpdate }: FormattingPanelProps) {
  const [mode, setMode] = useState<"standard" | "manual">(
    JSON.stringify(settings) === JSON.stringify(THESIS_PRESETS["Standar Indonesia"]) ? "standard" : "manual"
  );

  const handleModeChange = (newMode: "standard" | "manual") => {
    setMode(newMode);
    if (newMode === "standard") {
      onUpdate(THESIS_PRESETS["Standar Indonesia"]);
    }
  };

  const updateNested = (path: string, value: any) => {
    const newSettings = { ...settings };
    const keys = path.split('.');
    let current: any = newSettings;
    for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    onUpdate(newSettings);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Mode Toggle */}
      <div className="grid grid-cols-2 gap-2 bg-gray-50 p-1 rounded-2xl border border-gray-100">
        <button 
          onClick={() => handleModeChange("standard")}
          className={`py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'standard' ? 'bg-white text-blue-600 shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'}`}
        >
          Standar
        </button>
        <button 
          onClick={() => handleModeChange("manual")}
          className={`py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'manual' ? 'bg-white text-indigo-600 shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'}`}
        >
          Manual
        </button>
      </div>

      {mode === "standard" && (
        <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex gap-3 items-start">
            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="text-[10px] text-blue-800 leading-relaxed font-bold uppercase tracking-tight">
                Format Standar Indonesia Aktif (4-4-3-3, TNR, Spasi 1.5).
            </div>
        </div>
      )}

      {/* Font Section */}
      <div className="space-y-4">
        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
            <Type className="w-3 h-3" /> Tipografi
        </label>
        <div className="space-y-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100">
            <div className="relative">
                <select 
                    value={settings.font.family}
                    onChange={(e) => updateNested('font.family', e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold appearance-none outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Arial">Arial</option>
                    <option value="Calibri">Calibri</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <Input 
                    label="Ukuran Isi" 
                    type="number" 
                    value={settings.font.sizeBody} 
                    onChange={(e) => updateNested('font.sizeBody', Number(e.target.value))} 
                />
                <Input 
                    label="Spasi" 
                    type="number" 
                    step="0.1" 
                    value={settings.font.lineSpacing} 
                    onChange={(e) => updateNested('font.lineSpacing', Number(e.target.value))} 
                />
            </div>
        </div>
      </div>

      {/* Margins Section */}
      <div className="space-y-4">
        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
            <Maximize2 className="w-3 h-3" /> Margin (mm)
        </label>
        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100">
            <Input label="Atas" type="number" value={settings.margins.top} onChange={(e) => updateNested('margins.top', Number(e.target.value))} />
            <Input label="Kiri" type="number" value={settings.margins.left} onChange={(e) => updateNested('margins.left', Number(e.target.value))} />
            <Input label="Bawah" type="number" value={settings.margins.bottom} onChange={(e) => updateNested('margins.bottom', Number(e.target.value))} />
            <Input label="Kanan" type="number" value={settings.margins.right} onChange={(e) => updateNested('margins.right', Number(e.target.value))} />
        </div>
      </div>

      {/* Alignment */}
      <div className="space-y-4">
        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
            <AlignJustify className="w-3 h-3" /> Perataan
        </label>
        <div className="flex gap-2 p-1 bg-gray-50 border border-gray-100 rounded-xl">
            {[
                { id: 'left', icon: AlignLeft },
                { id: 'center', icon: AlignCenter },
                { id: 'justify', icon: AlignJustify }
            ].map((align) => (
                <button 
                    key={align.id}
                    onClick={() => onUpdate({ ...settings, alignment: align.id as any })}
                    className={`flex-1 py-2 flex items-center justify-center rounded-lg transition-all ${settings.alignment === align.id ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                    <align.icon className="w-4 h-4" />
                </button>
            ))}
        </div>
      </div>
    </div>
  );
}

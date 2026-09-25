/**
 * src/components/ui/Textarea.tsx
 * -----------------------------------------------------------------------------
 * Textarea primitive dengan accessibility built-in (mirror dari Input.tsx).
 *
 * Font default: serif (leading-relaxed, no resize) supaya nyaman untuk
 * ngetik catatan panjang. Kalau butuh inline edit non-serif, override className.
 * -----------------------------------------------------------------------------
 */

import { useId } from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export default function Textarea({ label, error, className = "", id, ...props }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id || `textarea-${generatedId.replace(/:/g, "")}`;
  const errorId = `${textareaId}-error`;
  const describedBy =
    [props["aria-describedby"], error ? errorId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div className="w-full space-y-2">
      {label && (
        <label
          htmlFor={textareaId}
          className="text-[10px] font-black uppercase text-slate-400 tracking-widest block px-2"
        >
          {label}
        </label>
      )}
      <textarea
        {...props}
        id={textareaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition-all font-bold text-slate-800 placeholder:text-slate-300 font-serif leading-relaxed resize-none ${className}`}
      />
      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-red-500 text-[10px] font-black uppercase tracking-widest px-2"
        >
          {error}
        </p>
      )}
    </div>
  );
}
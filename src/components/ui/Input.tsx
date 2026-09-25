/**
 * src/components/ui/Input.tsx
 * -----------------------------------------------------------------------------
 * Text input primitive dengan accessibility built-in.
 *
 * - Pakai `useId()` untuk auto-generate id yang stabil antara SSR & client.
 * - `aria-invalid` + `aria-describedby` di-link ke error message otomatis.
 * - Error message di-render dengan `role="alert"` supaya screen reader
 *   mengumumkan begitu muncul.
 *
 * Kalau butuh `<textarea>`, pakai `src/components/ui/Textarea.tsx`.
 * Kalau butuh `<select>` atau `<checkbox>`, bikin primitive sendiri.
 * -----------------------------------------------------------------------------
 */

import { useId } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export default function Input({ label, error, className = "", id, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id || `input-${generatedId.replace(/:/g, "")}`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [props["aria-describedby"], error ? errorId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div className="w-full space-y-2">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[10px] font-black uppercase text-slate-400 tracking-widest block px-2"
        >
          {label}
        </label>
      )}
      <input
        {...props}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition-all font-bold text-slate-800 placeholder:text-slate-300 ${className}`}
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
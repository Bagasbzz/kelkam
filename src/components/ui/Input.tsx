import { useId } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export default function Input({ label, error, className = "", id, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id || `input-${generatedId.replace(/:/g, "")}`;
  const errorId = `${inputId}-error`;
  const describedBy = [props["aria-describedby"], error ? errorId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div className="w-full space-y-2">
      {label && (
        <label htmlFor={inputId} className="text-[10px] font-black uppercase text-gray-400 tracking-widest block px-2">
          {label}
        </label>
      )}
      <input
        {...props}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition-all font-bold text-gray-800 placeholder:text-gray-300 ${className}`}
      />
      {error && <p id={errorId} role="alert" className="text-red-500 text-[10px] font-black uppercase tracking-widest px-2">{error}</p>}
    </div>
  );
}

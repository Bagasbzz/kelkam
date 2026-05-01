interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export default function Textarea({ label, error, className = "", ...props }: TextareaProps) {
  return (
    <div className="w-full space-y-2">
      {label && (
        <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest block px-2">
          {label}
        </label>
      )}
      <textarea
        className={`w-full px-6 py-4 rounded-2xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition-all font-bold text-gray-800 placeholder:text-gray-300 font-serif leading-relaxed resize-none ${className}`}
        {...props}
      />
      {error && <p className="text-red-500 text-[10px] font-black uppercase tracking-widest px-2">{error}</p>}
    </div>
  );
}

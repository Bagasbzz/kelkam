"use client";

interface KelasPickerProps {
  /** Available options — list of { id, name }. */
  options: { id: string; name: string }[];
  /** Selected id, atau null/undefined untuk "none". */
  value: string | null | undefined;
  /** Dipanggil saat user pilih option. */
  onChange: (id: string) => void;
  /** Optional: id yang disable (mis. kalau tidak boleh dipilih). */
  disabledId?: string;
  className?: string;
}

/**
 * Radio card pattern untuk pilih kelas. BUKAN dropdown — UX lebih cepet
 * karena user lihat semua opsi sekaligus.
 */
export default function KelasPicker({
  options,
  value,
  onChange,
  disabledId,
  className = "",
}: KelasPickerProps) {
  if (!options.length) {
    return (
      <p className={`text-xs text-slate-500 ${className}`}>
        Belum ada kelas untuk course ini.
      </p>
    );
  }
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${className}`}>
      {options.map((opt) => {
        const isSelected = value === opt.id;
        const isDisabled = disabledId === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(opt.id)}
            className={[
              "rounded-2xl border-2 px-3 py-3 text-sm font-bold transition-all active:scale-95",
              isSelected
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-slate-50",
              isDisabled ? "opacity-40 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {opt.name}
          </button>
        );
      })}
    </div>
  );
}
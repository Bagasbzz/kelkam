import type { ButtonHTMLAttributes } from "react";
import { LucideIcon } from "lucide-react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost" | "dark";
  size?: "sm" | "md" | "lg" | "xl";
  icon?: LucideIcon;
  isLoading?: boolean;
}

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  isLoading,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles = "inline-flex items-center justify-center font-bold transition-all active:scale-95 disabled:opacity-20 disabled:active:scale-100 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-500/20",
    secondary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-500/20",
    outline: "bg-white border-2 border-gray-100 text-gray-900 hover:border-blue-100 hover:bg-gray-50",
    danger: "text-red-500 hover:bg-red-50",
    ghost: "text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-widest text-sm",
    dark: "bg-gray-900 hover:bg-black text-white shadow-xl shadow-gray-200"
  };

  const sizes = {
    sm: "px-4 py-2 text-xs rounded-xl",
    md: "px-6 py-3 rounded-xl",
    lg: "px-8 py-4 rounded-2xl",
    xl: "px-10 py-5 rounded-3xl text-lg"
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
      ) : Icon && <Icon className={`${children ? 'mr-2' : ''} w-5 h-5`} />}
      {children}
    </button>
  );
}

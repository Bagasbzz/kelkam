interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "glass" | "borderless";
  padding?: "none" | "sm" | "md" | "lg";
}

export default function Card({
  children,
  className = "",
  variant = "default",
  padding = "md"
}: CardProps) {
  const baseStyles = "rounded-[2.5rem] transition-all overflow-hidden";
  
  const variants = {
    default: "bg-white border border-gray-100 shadow-2xl shadow-gray-100",
    glass: "bg-white/80 backdrop-blur-md border border-white/20 shadow-xl",
    borderless: "bg-gray-50 border-transparent shadow-none"
  };

  const paddings = {
    none: "p-0",
    sm: "p-4",
    md: "p-8",
    lg: "p-12"
  };

  return (
    <div className={`${baseStyles} ${variants[variant]} ${paddings[padding]} ${className}`}>
      {children}
    </div>
  );
}

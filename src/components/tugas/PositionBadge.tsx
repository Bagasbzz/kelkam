"use client";

interface PositionBadgeProps {
  position: number;
  total: number;
  className?: string;
}

export default function PositionBadge({ position, total, className = "" }: PositionBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 border border-blue-100 ${className}`}
    >
      Urutan ke-{position} dari {total}
    </span>
  );
}
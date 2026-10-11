import { cn } from "@/lib/utils";

/** Theme-aware skeleton block for phone screens (placeholders instead of spinners). */
export function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-[var(--bg-card)]", className)} style={style} />;
}

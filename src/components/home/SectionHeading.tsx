import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Section label + h2 + lede, in sentence case. */
export function SectionHeading({
  label,
  title,
  lede,
  align = "start",
  id,
  className,
}: {
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "start" | "center";
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)} data-reveal>
      <p className="hm-label mb-3">{label}</p>
      <h2 id={id} className="hm-display hm-h2">
        {title}
      </h2>
      {lede && <p className="hm-lede mt-5">{lede}</p>}
    </div>
  );
}

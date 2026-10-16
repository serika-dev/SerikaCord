import { cn } from "@/lib/utils";

/**
 * The SerikaCord lockup for the marketing pages: the mark plus the two-tone
 * wordmark ("Serika" in white, "Cord" in violet), the same at every width.
 * Product names are never translated. Decorative: the wrapping link carries
 * the accessible name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
      <img src="/logo-icon.svg" alt="" width={30} height={30} className="h-[30px] w-[30px] shrink-0 rounded-[8px]" />
      <span className="hm-wordmark">
        Serika<span>Cord</span>
      </span>
    </span>
  );
}

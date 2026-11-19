import { getGT } from "gt-next/server";
import { AlertTriangle, ArrowRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_PAGE_JSON, STATUS_PAGE_URL, parseStatusPage, type StatusIssue } from "@/lib/statusPage";

async function fetchStatus(): Promise<StatusIssue | null> {
  try {
    // Cached for a minute across requests; a slow status page never holds up the page.
    const res = await fetch(STATUS_PAGE_JSON, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(2000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return parseStatusPage(await res.json());
  } catch {
    return null;
  }
}

/**
 * Thin strip at the very top of the site header while status.serika.dev
 * (Better Stack) reports anything other than "operational". Renders nothing
 * otherwise. `.hm-status` also pushes the first hero down (see home.css).
 */
export async function StatusBanner() {
  const issue = await fetchStatus();
  if (!issue) return null;
  const gt = await getGT();

  const fallback =
    issue.level === "maintenance"
      ? gt("Scheduled maintenance is in progress")
      : issue.level === "downtime"
        ? gt("Some Serika services are down")
        : gt("Some Serika services are having issues");
  const Icon = issue.level === "maintenance" ? Wrench : AlertTriangle;

  return (
    <a
      href={STATUS_PAGE_URL}
      target="_blank"
      rel="noopener noreferrer"
      role="status"
      className={cn(
        "hm-status group flex items-center justify-center gap-2 px-4 text-sm font-medium",
        issue.level === "downtime" ? "bg-red-600 text-white" : "bg-amber-400 text-black",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{issue.title ?? fallback}</span>
      <span className="flex shrink-0 items-center gap-1 underline-offset-2 group-hover:underline">
        {gt("View status")}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </a>
  );
}

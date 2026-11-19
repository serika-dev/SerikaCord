/**
 * Better Stack status page (status.serika.dev) → one "is something wrong?"
 * summary for the site banner. Better Stack serves the page as JSON:API at
 * `/index.json`; `data.attributes.aggregate_state` is the overall state and
 * `included` holds the status reports (incidents and maintenance).
 */

export const STATUS_PAGE_URL = "https://status.serika.dev";
export const STATUS_PAGE_JSON = `${STATUS_PAGE_URL}/index.json`;

export type StatusLevel = "degraded" | "downtime" | "maintenance";

export interface StatusIssue {
  level: StatusLevel;
  /** Title of the newest open status report, when there is one. */
  title: string | null;
}

interface IncludedItem {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
}

function toLevel(state: unknown): StatusLevel | null {
  if (state === "degraded" || state === "downtime" || state === "maintenance") return state;
  return null;
}

/** Returns null when everything is operational or the payload is unusable. */
export function parseStatusPage(json: unknown, now: number = Date.now()): StatusIssue | null {
  if (!json || typeof json !== "object") return null;
  const root = json as { data?: { attributes?: { aggregate_state?: unknown } }; included?: unknown };
  const level = toLevel(root.data?.attributes?.aggregate_state);
  if (!level) return null;

  const included = Array.isArray(root.included) ? (root.included as IncludedItem[]) : [];
  let title: string | null = null;
  let newest = -Infinity;
  for (const item of included) {
    if (item?.type !== "status_report" || !item.attributes) continue;
    const a = item.attributes;
    const starts = typeof a.starts_at === "string" ? Date.parse(a.starts_at) : NaN;
    const ends = typeof a.ends_at === "string" ? Date.parse(a.ends_at) : NaN;
    // Open = started (or no start given) and not yet ended.
    if (Number.isFinite(starts) && starts > now) continue;
    if (Number.isFinite(ends) && ends <= now) continue;
    if (typeof a.title !== "string" || !a.title.trim()) continue;
    const key = Number.isFinite(starts) ? starts : 0;
    if (key >= newest) {
      newest = key;
      title = a.title.trim();
    }
  }

  return { level, title };
}

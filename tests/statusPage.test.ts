import { describe, expect, test } from "bun:test";
import { parseStatusPage } from "../src/lib/statusPage";

const NOW = Date.parse("2026-11-18T12:00:00Z");

function page(state: string, reports: Array<Record<string, unknown>> = []) {
  return {
    data: { id: "1", type: "status_page", attributes: { aggregate_state: state } },
    included: [
      { id: "s1", type: "status_page_section", attributes: { name: "SerikaCord" } },
      ...reports.map((attributes, i) => ({ id: `r${i}`, type: "status_report", attributes })),
    ],
  };
}

describe("parseStatusPage", () => {
  test("operational → null", () => {
    expect(parseStatusPage(page("operational"), NOW)).toBeNull();
  });

  test("garbage → null", () => {
    expect(parseStatusPage(null, NOW)).toBeNull();
    expect(parseStatusPage("<html>", NOW)).toBeNull();
    expect(parseStatusPage({ data: {} }, NOW)).toBeNull();
  });

  test("degraded with an open report uses its title", () => {
    const res = parseStatusPage(
      page("degraded", [{ title: "Global CDN Outage", starts_at: "2026-11-15T12:16:21Z", ends_at: null }]),
      NOW,
    );
    expect(res).toEqual({ level: "degraded", title: "Global CDN Outage" });
  });

  test("ignores resolved and future reports, picks the newest open one", () => {
    const res = parseStatusPage(
      page("downtime", [
        { title: "Old", starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-02T00:00:00Z" },
        { title: "Upcoming", starts_at: "2026-11-20T00:00:00Z", ends_at: null },
        { title: "Earlier open", starts_at: "2026-11-17T00:00:00Z", ends_at: null },
        { title: "API down", starts_at: "2026-11-18T11:00:00Z", ends_at: null },
      ]),
      NOW,
    );
    expect(res).toEqual({ level: "downtime", title: "API down" });
  });

  test("not operational without a report still flags, with no title", () => {
    expect(parseStatusPage(page("maintenance"), NOW)).toEqual({ level: "maintenance", title: null });
  });
});

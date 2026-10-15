import { describe, expect, mock, test } from "bun:test";

// The content modules translate with gt-next's getGT(); in tests it returns
// the English source string with {vars} filled in.
mock.module("gt-next/server", () => ({
  getGT: async () => (s: string, vars?: Record<string, unknown>) =>
    vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s,
  getLocale: async () => "en",
}));

const compare = await import("../src/lib/compare");
const { APPS, isAppId } = await import("../src/lib/compare/apps");
const { OVERALL_RANKING, TIER_RANKINGS, groupByTier, tierOf } = await import("../src/lib/compare/tiers");
const { CONTENT_MODULES } = await import("../src/lib/compare/content");
const { serikaFacts, serikaSources, serikaE2eeLimits, serikaCaveats } = await import("../src/lib/compare/content/serika");
const { tierReasons, overallReasons } = await import("../src/lib/compare/tierText");

const { APP_IDS, ROW_IDS, TIERS, TIER_SECTIONS } = compare;
type TierAppId = (typeof APP_IDS)[number] | "serikacord";
const ALL: TierAppId[] = [...APP_IDS, "serikacord"];

function index(ranking: readonly (readonly [string, string])[], id: string): number {
  return ranking.findIndex(([a]) => a === id);
}

describe("app registry", () => {
  test("has every competitor once, with a kind and an https website", () => {
    expect(APPS.map((a) => a.id)).toEqual([...APP_IDS]);
    expect(new Set(APP_IDS).size).toBe(APP_IDS.length);
    for (const a of APPS) {
      expect(compare.APP_KINDS).toContain(a.kind);
      expect(a.website.startsWith("https://")).toBe(true);
      expect(a.seoDescription.length).toBeLessThanOrEqual(200);
      expect(a.hue).toBeGreaterThanOrEqual(0);
      expect(a.hue).toBeLessThan(360);
    }
    expect(isAppId("discord")).toBe(true);
    expect(isAppId("tier-list")).toBe(false);
    expect(isAppId("serikacord")).toBe(false);
  });
});

describe("tier list data", () => {
  const rankings = [...TIER_SECTIONS.map((s) => [s, TIER_RANKINGS[s]] as const), ["overall", OVERALL_RANKING] as const];

  test("every app is ranked exactly once in every section and overall", () => {
    for (const [, ranking] of rankings) {
      const ids = ranking.map(([id]) => id);
      expect(ids.length).toBe(ALL.length);
      expect(new Set(ids).size).toBe(ALL.length);
      expect([...ids].sort()).toEqual([...ALL].sort());
    }
  });

  test("tiers are valid and ordered best to worst", () => {
    for (const [, ranking] of rankings) {
      let last = 0;
      for (const [, tier] of ranking) {
        const i = (TIERS as readonly string[]).indexOf(tier);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeGreaterThanOrEqual(last);
        last = i;
      }
    }
  });

  test("groupByTier keeps every app and the order inside a tier", () => {
    const grouped = groupByTier(OVERALL_RANKING);
    expect(Object.values(grouped).flat().length).toBe(ALL.length);
    expect(tierOf(OVERALL_RANKING, "kloak")).toBe("F");
  });

  test("SerikaCord is never placed above apps that are clearly better in that section", () => {
    const below: [string, string[]][] = [
      ["privacy", ["signal", "simplex", "matrix"]],
      ["security", ["signal", "simplex", "discord", "matrix"]],
      ["community", ["discord"]],
      ["moderation", ["discord", "discourse"]],
      ["voice", ["discord", "teamspeak", "mumble", "telegram"]],
      ["bots", ["discord", "telegram"]],
      ["apps", ["discord", "telegram", "matrix", "signal"]],
      ["openness", ["matrix", "xmpp-movim", "stoat", "fluxer", "nerimity", "mumble", "simplex"]],
      ["scale", ["telegram", "discord", "signal", "stoat"]],
      ["ease", ["discord", "telegram"]],
    ];
    for (const [section, better] of below) {
      const ranking = TIER_RANKINGS[section as keyof typeof TIER_RANKINGS];
      const ours = index(ranking, "serikacord");
      for (const app of better) {
        expect({ section, app, above: index(ranking, app) < ours }).toEqual({ section, app, above: true });
      }
    }
  });

  test("a shut-down service is F everywhere", () => {
    for (const [, ranking] of rankings) expect(tierOf(ranking, "kloak")).toBe("F");
  });

  test("every placement has a one-line reason", async () => {
    const reasons = await tierReasons();
    const overall = await overallReasons();
    for (const s of TIER_SECTIONS) {
      for (const id of ALL) {
        expect(typeof reasons[s][id]).toBe("string");
        expect(reasons[s][id].length).toBeGreaterThan(5);
      }
    }
    for (const id of ALL) expect(overall[id].length).toBeGreaterThan(5);
  });
});

describe("comparison content", () => {
  test("SerikaCord's column fills every row and cites real sources", async () => {
    const facts = await serikaFacts();
    const ids = new Set(serikaSources.map((s) => s.id));
    expect(ids.size).toBe(serikaSources.length);
    for (const row of ROW_IDS) {
      const cell = facts[row];
      expect(cell).toBeDefined();
      expect(Boolean(cell.status || cell.value)).toBe(true);
      for (const id of cell.src ?? []) expect({ row, id, known: ids.has(id) }).toEqual({ row, id, known: true });
    }
    expect((await serikaE2eeLimits()).length).toBeGreaterThan(5);
    expect((await serikaCaveats()).length).toBeGreaterThan(3);
  });

  for (const id of APP_IDS) {
    test(`${id}: complete facts, sourced claims and a full page`, async () => {
      const mod = CONTENT_MODULES[id];
      const c = await mod.content();
      const ids = new Set(mod.sources.map((s) => s.id));
      expect(ids.size).toBe(mod.sources.length);
      expect(mod.sources.length).toBeGreaterThanOrEqual(5);
      for (const s of mod.sources) {
        expect(s.url.startsWith("https://")).toBe(true);
        expect(s.title.length).toBeGreaterThan(3);
        expect(["primary", "secondary"]).toContain(s.kind);
        expect(s.url).not.toContain("discordless.com");
      }

      const used = new Set<string>();
      const check = (where: string, src: string[] | undefined) => {
        for (const ref of src ?? []) {
          expect({ where, ref, known: ids.has(ref) }).toEqual({ where, ref, known: true });
          used.add(ref);
        }
      };
      for (const row of ROW_IDS) {
        const cell = c.facts[row];
        expect({ row, defined: cell !== undefined }).toEqual({ row, defined: true });
        expect({ row, hasContent: Boolean(cell.status || cell.value) }).toEqual({ row, hasContent: true });
        check(row, cell.src);
      }
      c.whyUs.forEach((p, i) => check(`whyUs ${i}`, p.src));
      c.whyThem.forEach((p, i) => check(`whyThem ${i}`, p.src));
      check("notes", c.notes?.src);
      // Every listed source backs something on the page.
      for (const s of mod.sources) expect({ source: s.id, used: used.has(s.id) }).toEqual({ source: s.id, used: true });

      expect(c.take.length).toBeGreaterThan(20);
      expect(c.intro.length).toBeGreaterThanOrEqual(1);
      expect(c.verdict.length).toBeGreaterThan(20);
      expect(c.whyUs.length).toBeGreaterThanOrEqual(3);
      expect(c.whyThem.length).toBeGreaterThanOrEqual(3);
      expect(c.pickThem.length).toBeGreaterThanOrEqual(2);
      expect(c.pickUs.length).toBeGreaterThanOrEqual(2);
      expect(c.faq.length).toBeGreaterThanOrEqual(5);
      expect(c.faq.length).toBeLessThanOrEqual(8);
      expect(new Set(c.faq.map((f) => f.question)).size).toBe(c.faq.length);
    });
  }
});

describe("source numbering", () => {
  test("numbers app sources first, then SerikaCord's, and resolves refs", () => {
    const app = [
      { id: "a", title: "A", url: "https://a.example", publisher: "A", kind: "primary" as const },
      { id: "b", title: "B", url: "https://b.example", publisher: "B", kind: "secondary" as const },
    ];
    const ours = [{ id: "a", title: "Ours", url: "https://serika.chat", publisher: "SerikaCord", kind: "primary" as const }];
    const { list, lookup } = compare.numberSources(app, ours);
    expect(list.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(compare.sourceNumbers(lookup, "app", ["b", "a", "a", "missing"])).toEqual([1, 2]);
    expect(compare.sourceNumbers(lookup, "serika", ["a"])).toEqual([3]);
    expect(compare.sourceNumbers(lookup, "serika", undefined)).toEqual([]);
  });

  test("item list JSON-LD has positions and absolute URLs", () => {
    const ld = compare.compareItemListJsonLd([{ name: "X", path: "/compare/x" }]) as { itemListElement: { position: number; url: string }[] };
    expect(ld.itemListElement[0]).toMatchObject({ position: 1, url: "https://serika.chat/compare/x" });
  });

  test("article JSON-LD can say which apps it is about", () => {
    const ld = compare.compareArticleJsonLd({ path: "/compare/x", headline: "H", description: "D", breadcrumbName: "X", about: ["SerikaCord", "X"] }) as {
      "@graph": [{ about: { name: string }[] }];
    };
    expect(ld["@graph"][0].about.map((a) => a.name)).toEqual(["SerikaCord", "X"]);
  });
});

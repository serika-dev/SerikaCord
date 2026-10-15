import { describe, expect, test } from "bun:test";
import { homepageJsonLd, serializeJsonLd } from "../src/lib/jsonLd";
import { COMPARE_LAST_CHECKED_ISO, compareArticleJsonLd, faqJsonLd, formatCompareDate } from "../src/lib/compare";

describe("serializeJsonLd", () => {
  test("cannot close the surrounding script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script>");
    // Still valid JSON that round-trips to the original value.
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  test("escapes line and paragraph separators", () => {
    const out = serializeJsonLd({ text: "a\u2028b\u2029c" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out).text).toBe("a\u2028b\u2029c");
  });

  test("homepage graph has an Organization and a WebSite", () => {
    const types = (homepageJsonLd["@graph"] as { "@type": string }[]).map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite"]);
  });
});

describe("comparison page structured data", () => {
  test("FAQPage mirrors the visible questions", () => {
    const ld = faqJsonLd([{ question: "Q1?", answer: "A1." }]) as { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity[0].name).toBe("Q1?");
    expect(ld.mainEntity[0].acceptedAnswer.text).toBe("A1.");
  });

  test("Article carries the last-checked date and a breadcrumb", () => {
    const ld = compareArticleJsonLd({ path: "/compare/discord", headline: "H", description: "D", breadcrumbName: "Discord" }) as {
      "@graph": [{ dateModified: string; url: string }, { itemListElement: unknown[] }];
    };
    expect(ld["@graph"][0].dateModified).toBe(COMPARE_LAST_CHECKED_ISO);
    expect(ld["@graph"][0].url).toBe("https://serika.chat/compare/discord");
    expect(ld["@graph"][1].itemListElement).toHaveLength(3);
  });

  test("index page breadcrumb stops at Compare", () => {
    const ld = compareArticleJsonLd({ path: "/compare", headline: "H", description: "D", breadcrumbName: "Compare" }) as {
      "@graph": [unknown, { itemListElement: unknown[] }];
    };
    expect(ld["@graph"][1].itemListElement).toHaveLength(2);
  });

  test("formats the date for a locale and never throws", () => {
    expect(formatCompareDate("en")).toContain("2026");
    expect(formatCompareDate("not-a-locale-%%")).toBeTruthy();
    expect(formatCompareDate(undefined)).toContain("2026");
  });
});

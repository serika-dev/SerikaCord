import { describe, expect, test } from "bun:test";
import { formatCompactCount } from "../src/lib/utils/formatCompactCount";
import { parsePublicStats } from "../src/lib/services/accountsStats";
import { platformFromUserAgent } from "../src/lib/detectPlatform";
import { faqPageJsonLd, serikaCordAppJsonLd } from "../src/lib/jsonLd";

describe("formatCompactCount", () => {
  test("compacts thousands and millions (en)", () => {
    expect(formatCompactCount(999, "en")).toBe("999");
    expect(formatCompactCount(1000, "en")).toBe("1K");
    expect(formatCompactCount(1500, "en")).toBe("1.5K");
    expect(formatCompactCount(1_000_000, "en")).toBe("1M");
    expect(formatCompactCount(2_400_000, "en")).toBe("2.4M");
  });

  test("never rounds a stat up", () => {
    expect(formatCompactCount(1999, "en")).toBe("1.9K");
    expect(formatCompactCount(999_999, "en")).toBe("999.9K");
  });

  test("follows the locale", () => {
    expect(formatCompactCount(1500, "nl")).toContain("1,5");
    expect(formatCompactCount(15000, "ja")).toBe("1.5万");
  });

  test("falls back to English for a bad locale tag", () => {
    expect(formatCompactCount(1500, "not a locale %%")).toBe("1.5K");
  });
});

describe("parsePublicStats", () => {
  test("accepts a positive user count", () => {
    expect(parsePublicStats({ users: 1234 })).toBe(1234);
    expect(parsePublicStats({ users: 12.7 })).toBe(12);
  });

  test("hides zero, junk and errors", () => {
    expect(parsePublicStats({ users: 0 })).toBeNull();
    expect(parsePublicStats({ users: -5 })).toBeNull();
    expect(parsePublicStats({ users: "1000" })).toBeNull();
    expect(parsePublicStats({ users: Number.NaN })).toBeNull();
    expect(parsePublicStats({ error: "Not found" })).toBeNull();
    expect(parsePublicStats(null)).toBeNull();
    expect(parsePublicStats("<html>")).toBeNull();
  });
});

describe("platformFromUserAgent", () => {
  test("picks the right download", () => {
    expect(platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(platformFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(platformFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(platformFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(platformFromUserAgent("curl/8.0")).toBe("unknown");
  });

  test("an iPad that reports a Mac user agent is iOS", () => {
    expect(platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
  });
});

describe("homepage structured data", () => {
  test("FAQPage mirrors the visible questions", () => {
    const ld = faqPageJsonLd([{ question: "Is it free?", answer: "Yes." }]);
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity[0].name).toBe("Is it free?");
    expect(ld.mainEntity[0].acceptedAnswer.text).toBe("Yes.");
  });

  test("the app is free and lists its platforms", () => {
    expect(serikaCordAppJsonLd.offers.price).toBe("0");
    expect(serikaCordAppJsonLd.operatingSystem).toContain("Android");
  });
});

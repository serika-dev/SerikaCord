import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hidesPurchases } from "@/lib/native/storePolicy";

const g = globalThis as unknown as { window?: unknown };
const realWindow = g.window;

function fakeShell(platform: "ios" | "android" | null) {
  g.window = platform
    ? { Capacitor: { isNativePlatform: () => true, getPlatform: () => platform } }
    : {};
}

describe("iOS store policy (Guideline 3.1.1)", () => {
  afterEach(() => {
    g.window = realWindow;
  });

  test("purchases are hidden only in the iOS app", () => {
    fakeShell("ios");
    expect(hidesPurchases()).toBe(true);
    fakeShell("android");
    expect(hidesPurchases()).toBe(false);
    fakeShell(null);
    expect(hidesPurchases()).toBe(false);
  });

  test("server render never hides purchases", () => {
    g.window = undefined;
    expect(hidesPurchases()).toBe(false);
  });
});

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("App Store listing", () => {
  const listing = JSON.parse(readFileSync(join(ROOT, "mobile/ios/appstore/listing.json"), "utf8"));
  const en = listing.localizations["en-US"];
  const file = (name: string) => readFileSync(join(ROOT, "mobile/ios/appstore/en-US", name), "utf8");

  test("fields fit Apple's limits and match the text files", () => {
    expect([...en.name].length).toBeLessThanOrEqual(30);
    expect([...en.subtitle].length).toBeLessThanOrEqual(30);
    expect([...en.promotionalText].length).toBeLessThanOrEqual(170);
    expect([...en.description].length).toBeLessThanOrEqual(4000);
    expect(en.keywords.length).toBeLessThanOrEqual(100);
    expect(en.keywords).not.toMatch(/,\s/);
    expect(file("review_notes.txt").length).toBeLessThanOrEqual(4000);
    expect(en.description).toBe(file("description.txt"));
    expect(en.keywords).toBe(file("keywords.txt"));
    expect(en.subtitle).toBe(file("subtitle.txt"));
    expect(en.promotionalText).toBe(file("promotional_text.txt"));
  });

  test("no competitor trademark in name, subtitle or keywords", () => {
    for (const field of [en.name, en.subtitle, en.keywords]) expect(field.toLowerCase()).not.toContain("discord");
  });

  test("privacy manifest declares exactly the data types marked collected in privacy-labels.md", () => {
    const manifest = readFileSync(join(ROOT, "mobile/ios/App/App/PrivacyInfo.xcprivacy"), "utf8");
    const declared = [...manifest.matchAll(/<string>NSPrivacyCollectedDataType(?!Purpose)([A-Za-z]+)<\/string>/g)].map((m) => m[1]).sort();
    const labels = readFileSync(join(ROOT, "mobile/ios/appstore/privacy-labels.md"), "utf8");
    // "| Category | Data type | **Yes** | ..." rows, mapped to manifest names.
    const toKey = (s: string) => s.replace(/ or /g, "or").replace(/ /g, "").replace(/^EmailsorTextMessages$/, "EmailsOrTextMessages").replace(/^OtherDataTypes$/, "OtherDataTypes");
    const collected = [...labels.matchAll(/^\| [^|]+ \| ([^|]+) \| \*\*Yes\*\* \|/gm)].map((m) => toKey(m[1].trim())).sort();
    expect(declared).toEqual(collected);
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  });
});

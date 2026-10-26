import { describe, expect, test } from "bun:test";
import {
  filterSettingsSections,
  findSettingsRowMatch,
  settingsItemMatches,
} from "../src/components/settings/settingsSearch";

const sections = [
  {
    title: "User Settings",
    items: [
      { id: "profiles", label: "Profiles", keywords: "avatar, banner, bio" },
      { id: "privacy", label: "Data & Privacy" },
    ],
  },
  {
    title: "App Settings",
    items: [
      { id: "appearance", label: "Appearance", keywords: "theme, dark mode, light mode" },
      { id: "accessibility", label: "Accessibility", keywords: "reduced motion, dyslexic" },
    ],
  },
];

describe("settings search", () => {
  test("an empty query keeps every section", () => {
    expect(filterSettingsSections(sections, "")).toBe(sections);
    expect(filterSettingsSections(sections, "   ")).toBe(sections);
  });

  test("matches labels case-insensitively", () => {
    const result = filterSettingsSections(sections, "APPEAR");
    expect(result.map((s) => s.title)).toEqual(["App Settings"]);
    expect(result[0].items.map((i) => i.id)).toEqual(["appearance"]);
  });

  test("matches keywords, so synonyms find the page", () => {
    expect(filterSettingsSections(sections, "dark mode")[0].items[0].id).toBe("appearance");
    expect(filterSettingsSections(sections, "avatar")[0].items[0].id).toBe("profiles");
  });

  test("every word must match somewhere", () => {
    expect(settingsItemMatches(sections[1].items[1], "App Settings", "reduced motion")).toBe(true);
    expect(settingsItemMatches(sections[1].items[1], "App Settings", "reduced banner")).toBe(false);
  });

  test("a section title matches all of its items", () => {
    expect(filterSettingsSections(sections, "app settings")[0].items).toHaveLength(2);
  });

  test("drops sections with no match", () => {
    expect(filterSettingsSections(sections, "nothing like this")).toEqual([]);
  });

  test("ignores accents", () => {
    expect(settingsItemMatches({ label: "Thème" }, "", "theme")).toBe(true);
  });

  test("finds the row to highlight after a jump", () => {
    const labels = ["Compact mode", "Show Timestamps", "Show Role Colours"];
    expect(findSettingsRowMatch(labels, "timestamps")).toBe(1);
    expect(findSettingsRowMatch(labels, "role show")).toBe(2);
    expect(findSettingsRowMatch(labels, "zzz")).toBe(-1);
    expect(findSettingsRowMatch(labels, "")).toBe(-1);
  });
});

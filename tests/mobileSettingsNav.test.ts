import { describe, expect, test } from "bun:test";
import {
  mobileSettingsBack,
  openMobileDetail,
  openMobileSection,
  type MobileSettingsNav,
} from "../src/lib/settings/mobileSettingsNav";

const list: MobileSettingsNav = { section: "overview", page: false, detail: null };

describe("mobile settings navigation", () => {
  test("opening a section pushes its page and clears any detail", () => {
    const nav = openMobileSection({ section: "roles", page: true, detail: "r1" }, "bans");
    expect(nav).toEqual({ section: "bans", page: true, detail: null });
  });

  test("back walks detail -> section -> list -> close", () => {
    const detail = openMobileDetail(openMobileSection(list, "roles"), "role-1");
    expect(detail).toEqual({ section: "roles", page: true, detail: "role-1" });

    const section = mobileSettingsBack(detail);
    expect(section).toEqual({ section: "roles", page: true, detail: null });

    const back = mobileSettingsBack(section!);
    expect(back).toEqual({ section: "roles", page: false, detail: null });

    expect(mobileSettingsBack(back!)).toBeNull();
  });
});

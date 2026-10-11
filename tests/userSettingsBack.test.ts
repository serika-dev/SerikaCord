import { describe, expect, test } from "bun:test";
import { settingsBackAction } from "../src/components/settings/mobileSettingsNav";

describe("settingsBackAction", () => {
  test("nested overlay takes the press first", () => {
    expect(settingsBackAction({ phone: true, onRoot: false, nestedOpen: true })).toBe("pass");
    expect(settingsBackAction({ phone: false, onRoot: true, nestedOpen: true })).toBe("pass");
  });
  test("phone pushed page pops to the list", () => {
    expect(settingsBackAction({ phone: true, onRoot: false, nestedOpen: false })).toBe("root");
  });
  test("phone list closes settings", () => {
    expect(settingsBackAction({ phone: true, onRoot: true, nestedOpen: false })).toBe("close");
  });
  test("desktop always closes", () => {
    expect(settingsBackAction({ phone: false, onRoot: false, nestedOpen: false })).toBe("close");
  });
});

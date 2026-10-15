import { describe, expect, test } from "bun:test";
import { buildTypedInvocation, coerceOptionValue, nestOptions } from "@/lib/chat/appCommandInvoke";
import { contextMenuCommands, flattenAppCommands } from "@/lib/chat/appCommandContext";
import { attachmentsOutsideComponents } from "@/lib/chat/interactionEvents";
import type { AppCommandGroup } from "@/lib/services/appCommands";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const groups: AppCommandGroup[] = [{
  application: { id: "app", name: "Bot", icon: null, botId: "bot", clientId: "123" },
  commands: [
    { id: "c1", name: "roll", description: "Roll", type: 1, guildId: null, options: [
      { type: 4, name: "sides", description: "s", required: true, min_value: 2, max_value: 100 },
      { type: 5, name: "public", description: "p" },
    ] },
    { id: "c2", name: "mod", description: "Moderate", type: 1, guildId: null, options: [
      { type: 1, name: "warn", description: "w", options: [
        { type: 6, name: "user", description: "u", required: true },
        { type: 3, name: "reason", description: "r" },
      ] },
      { type: 2, name: "role", description: "r", options: [
        { type: 1, name: "give", description: "g", options: [{ type: 8, name: "role", description: "r", required: true }] },
      ] },
    ] },
    { id: "c3", name: "color", description: "c", type: 1, guildId: null, options: [
      { type: 3, name: "c", description: "c", required: true, choices: [{ name: "Red", value: "red" }, { name: "Dark blue", value: "navy" }] },
      { type: 11, name: "file", description: "f" },
    ] },
    { id: "u1", name: "Report User", description: "", type: 2, guildId: null, options: [] },
    { id: "m1", name: "Quote", description: "", type: 3, guildId: null, options: [] },
  ],
}];
const leaves = flattenAppCommands(groups);

describe("app command palette data", () => {
  test("context-menu commands are not slash leaves", () => {
    expect(leaves.map((l) => l.fullName).sort()).toEqual(["color", "mod role give", "mod warn", "roll"]);
    expect(leaves.find((l) => l.fullName === "mod warn")!.commandId).toBe("c2");
    expect(contextMenuCommands(groups, 2).map((c) => c.name)).toEqual(["Report User"]);
    expect(contextMenuCommands(groups, 3).map((c) => c.commandId)).toEqual(["m1"]);
  });
});

describe("typed invocation from composer text", () => {
  test("numbers and booleans are typed, ranges checked", () => {
    const r = buildTypedInvocation("/roll 20 public:yes", leaves);
    expect(r).toMatchObject({ ok: true, options: [{ name: "sides", type: 4, value: 20 }, { name: "public", type: 5, value: true }] });
    expect(buildTypedInvocation("/roll 1", leaves)).toMatchObject({ ok: false, reason: "invalid", option: "sides" });
    expect(buildTypedInvocation("/roll", leaves)).toMatchObject({ ok: false, reason: "missing", option: "sides" });
  });

  test("subcommands nest and mentions become ids; the last string takes the rest", () => {
    const r = buildTypedInvocation(`/mod warn <@${USER}> being rude again`, leaves);
    expect(r.ok).toBeTrue();
    if (!r.ok) return;
    expect(nestOptions(r.leaf, r.options)).toEqual([{ name: "warn", type: 1, options: [
      { name: "user", type: 6, value: USER },
      { name: "reason", type: 3, value: "being rude again" },
    ] }]);
    const g = buildTypedInvocation(`/mod role give <@&${ROLE}>`, leaves);
    expect(g.ok && nestOptions(g.leaf, g.options)).toEqual([{ name: "role", type: 2, options: [{ name: "give", type: 1, options: [{ name: "role", type: 8, value: ROLE }] }] }]);
  });

  test("choices match by value or name", () => {
    expect(buildTypedInvocation("/color red", leaves)).toMatchObject({ ok: true, options: [{ value: "red" }] });
    expect(buildTypedInvocation('/color "Dark blue"', leaves)).toMatchObject({ ok: true, options: [{ value: "navy" }] });
    expect(buildTypedInvocation("/color green", leaves)).toMatchObject({ ok: false, reason: "invalid" });
  });

  test("optional attachments are asked for only when named", () => {
    const plain = buildTypedInvocation("/color red", leaves);
    expect(plain.ok && plain.attachmentOptions.length).toBe(0);
    const named = buildTypedInvocation("/color red file:", leaves);
    expect(named.ok && named.attachmentOptions.map((o) => o.name)).toEqual(["file"]);
  });

  test("not a known command", () => {
    expect(buildTypedInvocation("/unknown 1", leaves)).toMatchObject({ ok: false, reason: "not_command" });
    expect(buildTypedInvocation("hello", leaves)).toMatchObject({ ok: false, reason: "not_command" });
  });

  test("coerceOptionValue rejects junk ids", () => {
    expect(coerceOptionValue({ type: 6, name: "u" }, "not-an-id")).toBeNull();
    expect(coerceOptionValue({ type: 7, name: "c" }, `<#${USER}>`)).toBe(USER);
  });
});

describe("component media vs attachment list", () => {
  test("attachments shown by a v2 component are not repeated", () => {
    const atts = [{ id: "1", url: "https://cdn/a.png" }, { id: "2", url: "https://cdn/b.pdf" }];
    const comps = [{ type: 13, file: { url: "https://cdn/b.pdf", attachment_id: "2" } }];
    expect(attachmentsOutsideComponents(atts, comps)).toEqual([{ id: "1", url: "https://cdn/a.png" }]);
    expect(attachmentsOutsideComponents(atts, [])).toEqual(atts);
  });
});

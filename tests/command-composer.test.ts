import { describe, expect, test } from "bun:test";
import { flattenAppCommands } from "@/lib/chat/appCommandContext";
import { typedOptionsFromValues } from "@/lib/chat/appCommandInvoke";
import {
  addOptionToDraft,
  autoPickOnSpace,
  buildCommandCatalog,
  builtinArgs,
  commandReadiness,
  decideCommandEnter,
  flattenGroups,
  groupRankedCommands,
  hiddenOptionalOptions,
  initialDraft,
  keepActiveKey,
  labelForValue,
  moveActiveKey,
  optionValueError,
  paletteQuery,
  parseCommandText,
  pickerEntries,
  rankCommands,
  removeOptionFromDraft,
  resolvedValues,
  scoreCommandName,
  serializeCommand,
  setDraftValue,
  shownOptions,
  type CommandSpec,
} from "@/lib/chat/commandComposer";
import type { AppCommandGroup } from "@/lib/services/appCommands";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const groups: AppCommandGroup[] = [
  {
    application: { id: "roxy", name: "Roxy", icon: null, botId: "bot1", clientId: "1" },
    commands: [
      { id: "c1", name: "roll", description: "Roll a waifu", type: 1, guildId: null, options: [
        { type: 3, name: "type", description: "What to roll", choices: [{ name: "Waifu", value: "waifu" }, { name: "Husbando", value: "husbando" }] },
        { type: 5, name: "public", description: "Show everyone" },
      ] },
      { id: "c2", name: "mod", description: "Moderate", type: 1, guildId: null, options: [
        { type: 1, name: "warn", description: "Warn a member", options: [
          { type: 6, name: "user", description: "Who", required: true },
          { type: 3, name: "reason", description: "Why", max_length: 10 },
        ] },
      ] },
      { id: "c3", name: "amq", description: "Anime music quiz", type: 1, guildId: null, options: [
        { type: 1, name: "start", description: "Start a game", options: [
          { type: 4, name: "rounds", description: "Rounds", required: true, min_value: 1, max_value: 50 },
          { type: 11, name: "playlist", description: "File" },
        ] },
        { type: 1, name: "leaderboard", description: "Top players" },
      ] },
    ],
  },
];
const leaves = flattenAppCommands(groups);
const catalog = buildCommandCatalog(leaves, true);
const spec = (key: string) => catalog.find((s) => s.key === key) as CommandSpec;

describe("catalog", () => {
  test("app commands first, then built-ins; DMs drop server-only built-ins", () => {
    expect(catalog[0].source).toBe("app");
    expect(catalog.some((s) => s.key === "builtin:kick")).toBe(true);
    const dm = buildCommandCatalog(leaves, false);
    expect(dm.some((s) => s.key === "builtin:kick")).toBe(false);
    expect(dm.some((s) => s.key === "builtin:roll")).toBe(true);
  });
  test("a name clash keeps both commands, keyed by app", () => {
    const rolls = catalog.filter((s) => s.name === "roll").map((s) => s.key);
    expect(rolls).toEqual(["app:roxy:roll", "builtin:roll"]);
  });
  test("option kinds", () => {
    const warn = spec("app:roxy:mod warn");
    expect(warn.options.map((o) => [o.name, o.kind, o.required])).toEqual([["user", "user", true], ["reason", "string", false]]);
    expect(spec("builtin:timeout").options.find((o) => o.name === "duration")?.kind).toBe("duration");
    expect(spec("builtin:roll").options[0]).toMatchObject({ kind: "integer", minValue: 1 });
  });
});

describe("fuzzy ranking", () => {
  test("exact > prefix > word prefix > substring > letters in order", () => {
    expect(scoreCommandName("roll", "roll")!.score).toBeGreaterThan(scoreCommandName("rolls", "roll")!.score);
    expect(scoreCommandName("rolls", "roll")!.score).toBeGreaterThan(scoreCommandName("amq roll", "roll")!.score);
    expect(scoreCommandName("amq roll", "roll")!.score).toBeGreaterThan(scoreCommandName("enroll", "roll")!.score);
    expect(scoreCommandName("enroll", "roll")!.score).toBeGreaterThan(scoreCommandName("amq leaderboard", "lb")!.score);
    expect(scoreCommandName("amq leaderboard", "zz")).toBeNull();
  });
  test("highlight indices", () => {
    expect(scoreCommandName("amq start", "st")!.match).toEqual([4, 5]);
    expect(scoreCommandName("leaderboard", "lbd")!.match).toEqual([0, 6, 10]);
  });
  test("rank + group: best group first, ties keep catalog order", () => {
    const ranked = rankCommands(catalog, "ro");
    expect(ranked[0].spec.name).toBe("roll");
    expect(ranked[1].spec.name).toBe("roll");
    const g = groupRankedCommands(ranked);
    expect(g[0].key).toBe("app:roxy");
    expect(g.find((x) => x.key === "builtin")?.items[0].spec.name).toBe("roll");
    expect(flattenGroups(g).length).toBe(ranked.length);
  });
  test("description and app name match weakly", () => {
    const ranked = rankCommands(catalog, "a game");
    expect(ranked.map((r) => r.spec.name)).toContain("amq start");
    expect(rankCommands(catalog, "roxy").every((r) => r.spec.source === "app")).toBe(true);
  });
  test("highlight stays on the same command while the list changes", () => {
    const rows = flattenGroups(groupRankedCommands(rankCommands(catalog, "r")));
    const key = rows[2].spec.key;
    const narrowed = flattenGroups(groupRankedCommands(rankCommands(catalog, "ro")));
    expect(keepActiveKey(narrowed, key)).toBe(narrowed.some((r) => r.spec.key === key) ? key : narrowed[0].spec.key);
    expect(keepActiveKey(narrowed, "gone")).toBe(narrowed[0].spec.key);
    expect(moveActiveKey(narrowed, narrowed[0].spec.key, -1)).toBe(narrowed[narrowed.length - 1].spec.key);
    expect(moveActiveKey(narrowed, narrowed[narrowed.length - 1].spec.key, 1)).toBe(narrowed[0].spec.key);
  });
});

describe("palette query and auto-pick", () => {
  test("query only while it can still name a command", () => {
    expect(paletteQuery("/ro", catalog)).toBe("ro");
    expect(paletteQuery("/", catalog)).toBe("");
    expect(paletteQuery("/amq st", catalog)).toBe("amq st");
    expect(paletteQuery("/roll 20", catalog)).toBeNull();
    expect(paletteQuery("hello", catalog)).toBeNull();
    expect(paletteQuery("/ ro", catalog)).toBeNull();
    // Ambiguous name + space keeps the list open to choose an app.
    expect(paletteQuery("/roll ", catalog)).toBe("roll ");
    expect(paletteQuery("/amq ", catalog)).toBe("amq ");
  });
  test("space after a unique full name picks it", () => {
    expect(autoPickOnSpace("/kick ", catalog)?.key).toBe("builtin:kick");
    expect(autoPickOnSpace("/amq start ", catalog)?.key).toBe("app:roxy:amq start");
    expect(autoPickOnSpace("/roll ", catalog)).toBeNull(); // bot + built-in
    expect(autoPickOnSpace("/amq ", catalog)).toBeNull(); // subcommands follow
    expect(autoPickOnSpace("/kick", catalog)).toBeNull();
  });
});

describe("required vs optional readiness", () => {
  test("optional options never block sending", () => {
    const roll = spec("app:roxy:roll");
    const d = initialDraft(roll);
    expect(d.shown).toEqual([]);
    expect(commandReadiness(roll, d)).toEqual({ ready: true, missing: null, invalid: null });
    expect(hiddenOptionalOptions(roll, d).map((o) => o.name)).toEqual(["type", "public"]);
  });
  test("a missing required option is reported first", () => {
    const warn = spec("app:roxy:mod warn");
    const d = initialDraft(warn);
    expect(d.shown).toEqual(["user"]);
    expect(commandReadiness(warn, d).missing).toBe("user");
    const filled = setDraftValue(d, "user", `<@${USER}>`, "Alice");
    expect(commandReadiness(warn, filled).ready).toBe(true);
  });
  test("invalid values block, empty optional ones don't", () => {
    const start = spec("app:roxy:amq start");
    let d = setDraftValue(initialDraft(start), "rounds", "99");
    expect(commandReadiness(start, d).invalid).toEqual({ name: "rounds", error: { code: "max", limit: 50 } });
    d = setDraftValue(d, "rounds", "5");
    d = addOptionToDraft(d, "playlist");
    expect(commandReadiness(start, d).ready).toBe(true);
  });
  test("required attachments need a file", () => {
    const s: CommandSpec = { ...spec("app:roxy:amq start"), options: [{ name: "file", description: "", required: true, kind: "attachment" }] };
    expect(commandReadiness(s, initialDraft(s)).missing).toBe("file");
    expect(commandReadiness(s, initialDraft(s), { file: true }).ready).toBe(true);
  });
  test("value validation per kind", () => {
    const warn = spec("app:roxy:mod warn");
    const reason = warn.options[1];
    expect(optionValueError(reason, "short")).toBeNull();
    expect(optionValueError(reason, "much too long")).toEqual({ code: "maxLength", limit: 10 });
    expect(optionValueError(warn.options[0], "alice")).toEqual({ code: "user" });
    expect(optionValueError(warn.options[0], `<@${USER}>`)).toBeNull();
    const type = spec("app:roxy:roll").options[0];
    expect(optionValueError(type, "Husbando")).toBeNull();
    expect(optionValueError(type, "cat")).toEqual({ code: "choice" });
    const dur = spec("builtin:timeout").options[1];
    expect(optionValueError(dur, "45m")).toBeNull();
    expect(optionValueError(dur, "soon")).toEqual({ code: "duration" });
    expect(optionValueError(spec("builtin:roll").options[0], "2.5")).toEqual({ code: "integer" });
  });
  test("adding and removing optional options", () => {
    const roll = spec("app:roxy:roll");
    let d = addOptionToDraft(initialDraft(roll), "public");
    d = setDraftValue(d, "public", "true");
    expect(shownOptions(roll, d).map((o) => o.name)).toEqual(["public"]);
    d = removeOptionFromDraft(roll, d, "public");
    expect(d).toEqual({ values: {}, labels: {}, shown: [] });
    const warn = spec("app:roxy:mod warn");
    const kept = removeOptionFromDraft(warn, initialDraft(warn), "user");
    expect(kept.shown).toEqual(["user"]);
  });
});

describe("Enter rules", () => {
  const ready = { ready: true, missing: null, invalid: null };
  const missing = { ready: false, missing: "user", invalid: null };
  test("all required filled → Enter sends, even with optional options left", () => {
    expect(decideCommandEnter({ readiness: ready, dropdown: "none", hasHighlight: false, interacted: false })).toBe("submit");
  });
  test("the optional-options list never hijacks Enter unless the user used it", () => {
    expect(decideCommandEnter({ readiness: ready, dropdown: "optional", hasHighlight: true, interacted: false })).toBe("submit");
    expect(decideCommandEnter({ readiness: ready, dropdown: "optional", hasHighlight: true, interacted: true })).toBe("select");
  });
  test("a highlighted value (choice, person, autocomplete) is picked", () => {
    expect(decideCommandEnter({ readiness: missing, dropdown: "values", hasHighlight: true, interacted: false })).toBe("select");
    expect(decideCommandEnter({ readiness: ready, dropdown: "values", hasHighlight: true, interacted: false, highlightIsCurrent: true })).toBe("submit");
  });
  test("missing / invalid required → point at it instead of sending", () => {
    expect(decideCommandEnter({ readiness: missing, dropdown: "none", hasHighlight: false, interacted: false })).toBe("focus-missing");
    expect(decideCommandEnter({ readiness: { ready: false, missing: null, invalid: { name: "rounds", error: { code: "max" } } }, dropdown: "none", hasHighlight: false, interacted: false })).toBe("focus-invalid");
  });
});

describe("serialisation", () => {
  test("app commands: name:value, quoted when spaced", () => {
    const warn = spec("app:roxy:mod warn");
    let d = setDraftValue(initialDraft(warn), "user", `<@${USER}>`, "Alice");
    d = setDraftValue(addOptionToDraft(d, "reason"), "reason", "spam links");
    expect(serializeCommand(warn, d)).toBe(`/mod warn user:<@${USER}> reason:"spam links"`);
  });
  test("built-ins: positional, last arg keeps its spaces", () => {
    const kick = spec("builtin:kick");
    let d = setDraftValue(initialDraft(kick), "user", `<@${USER}>`);
    d = setDraftValue(addOptionToDraft(d, "reason"), "reason", "being \"rude\" again");
    expect(builtinArgs(kick, d)).toEqual([`<@${USER}>`, "being \"rude\" again"]);
    expect(serializeCommand(kick, d)).toBe(`/kick <@${USER}> being "rude" again`);
    const slow = spec("builtin:slowmode");
    expect(builtinArgs(slow, setDraftValue(initialDraft(slow), "duration", "5 seconds"))).toEqual(["5s"]);
  });
  test("parse round-trip (typed commands → drafts)", () => {
    const parsed = parseCommandText(`/mod warn user:<@${USER}> reason:"spam links"`, catalog)!;
    expect(parsed.spec.key).toBe("app:roxy:mod warn");
    expect(parsed.draft.values).toEqual({ user: `<@${USER}>`, reason: "spam links" });
    expect(parsed.draft.shown).toEqual(["user", "reason"]);
    const positional = parseCommandText(`/mod warn <@${USER}> spam links`, catalog)!;
    expect(positional.draft.values).toEqual({ user: `<@${USER}>`, reason: "spam links" });
    const kick = parseCommandText(`/kick <@${USER}> being rude`, catalog)!;
    expect(kick.spec.key).toBe("builtin:kick");
    expect(kick.draft.values).toEqual({ user: `<@${USER}>`, reason: "being rude" });
    // A typed clash runs the built-in (like a plain send does).
    expect(parseCommandText("/roll 20", catalog)!.spec.key).toBe("builtin:roll");
    expect(parseCommandText("/nope", catalog)).toBeNull();
    expect(parseCommandText("hi", catalog)).toBeNull();
  });
  test("resolved values send choice values, skip unshown optional ones", () => {
    const roll = spec("app:roxy:roll");
    let d = setDraftValue(addOptionToDraft(initialDraft(roll), "type"), "type", "Husbando", "Husbando");
    d = { ...d, values: { ...d.values, public: "true" } };
    expect(resolvedValues(roll, d)).toEqual({ type: "husbando" });
    const typed = typedOptionsFromValues(roll.leaf!, resolvedValues(roll, d));
    expect(typed).toEqual({ ok: true, options: [{ name: "type", type: 3, value: "husbando" }] });
  });
  test("typed options from values report missing / invalid like the text path", () => {
    const start = spec("app:roxy:amq start");
    expect(typedOptionsFromValues(start.leaf!, {})).toEqual({ ok: false, reason: "missing", option: "rounds" });
    expect(typedOptionsFromValues(start.leaf!, { rounds: "0" })).toEqual({ ok: false, reason: "invalid", option: "rounds" });
    expect(typedOptionsFromValues(start.leaf!, { rounds: "3" })).toEqual({ ok: true, options: [{ name: "rounds", type: 4, value: 3 }] });
  });
});

describe("pickers", () => {
  const data = {
    users: [
      { id: USER, username: "alice", displayName: "Alice A" },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", username: "malice", displayName: null },
    ],
    roles: [{ id: ROLE, name: "Moderators", color: "#f00" }],
    channels: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "general" }],
  };
  test("users rank prefix matches first and produce mention tokens", () => {
    const res = pickerEntries("user", data, "ali");
    expect(res.map((e) => e.sub)).toEqual(["alice", "malice"]);
    expect(res[0].value).toBe(`<@${USER}>`);
  });
  test("mentionable mixes users and roles; channels are #", () => {
    expect(pickerEntries("mentionable", data, "mod").map((e) => e.type)).toEqual(["role"]);
    expect(pickerEntries("channel", data, "#gen")[0].value).toBe("<#eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee>");
  });
  test("labels for stored values", () => {
    expect(labelForValue("user", `<@${USER}>`, data)).toBe("Alice A");
    expect(labelForValue("role", `<@&${ROLE}>`, data)).toBe("Moderators");
    expect(labelForValue("user", "plain", data)).toBeNull();
  });
});

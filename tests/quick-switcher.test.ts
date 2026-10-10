import { describe, expect, test } from "bun:test";
import {
  matchScore,
  parseSwitcherQuery,
  pushRecent,
  rankSwitcherItems,
  switcherKeyForPath,
  type SwitcherItem,
} from "@/lib/quickSwitcher";

const items: SwitcherItem[] = [
  { key: "s-1", kind: "server", label: "Serika Lounge", href: "/channels/1" },
  { key: "c-gen", kind: "channel", label: "general", sublabel: "Serika Lounge", channelType: "text", href: "/channels/1/gen" },
  { key: "c-games", kind: "channel", label: "gaming-news", sublabel: "Serika Lounge", channelType: "announcement", href: "/channels/1/games" },
  { key: "c-vc", kind: "channel", label: "General Voice", sublabel: "Serika Lounge", channelType: "voice", href: "/channels/1/vc" },
  { key: "d-alice", kind: "dm", label: "Alice", aliases: ["alice_w"], href: "/dm/alice" },
  { key: "g-grp", kind: "group", label: "Raid Night", sublabel: "Alice, Bob", href: "/dm/group/grp" },
  { key: "d-bob", kind: "user", label: "Bobby", aliases: ["bob"], href: "/dm/bob" },
];

describe("parseSwitcherQuery", () => {
  test("prefixes", () => {
    expect(parseSwitcherQuery("@Ali")).toEqual({ mode: "user", term: "ali" });
    expect(parseSwitcherQuery("#gen")).toEqual({ mode: "text", term: "gen" });
    expect(parseSwitcherQuery("!gen")).toEqual({ mode: "voice", term: "gen" });
    expect(parseSwitcherQuery("*ser")).toEqual({ mode: "server", term: "ser" });
    expect(parseSwitcherQuery("  General ")).toEqual({ mode: "all", term: "general" });
  });
});

describe("matchScore", () => {
  test("exact > prefix > word start > substring > fuzzy", () => {
    const exact = matchScore("general", "general");
    const prefix = matchScore("general-chat", "general");
    const word = matchScore("off-topic", "topic");
    const sub = matchScore("xgeneral", "general");
    const fuzzy = matchScore("general", "gnrl");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(matchScore("general", "xyz")).toBe(0);
  });
});

describe("rankSwitcherItems", () => {
  test("# limits to text channels, ! to voice", () => {
    expect(rankSwitcherItems(items, "#gen").map((i) => i.key)).toEqual(["c-gen"]);
    expect(rankSwitcherItems(items, "#ga")[0].key).toBe("c-games");
    expect(rankSwitcherItems(items, "!gen").map((i) => i.key)).toEqual(["c-vc"]);
  });

  test("@ finds people by alias and groups by member", () => {
    expect(rankSwitcherItems(items, "@bob").map((i) => i.key)).toEqual(["d-bob", "g-grp"]);
    expect(rankSwitcherItems(items, "@alice_w")[0].key).toBe("d-alice");
  });

  test("* is servers only", () => {
    expect(rankSwitcherItems(items, "*").map((i) => i.key)).toEqual(["s-1"]);
  });

  test("mentions and recent visits float up", () => {
    const withState = items.map((i) => (i.key === "c-games" ? { ...i, mentions: 2 } : i));
    expect(rankSwitcherItems(withState, "ga")[0].key).toBe("c-games");
    const recent = new Map([["c-vc", 0]]);
    expect(rankSwitcherItems(items, "general", { recent })[0].key).toBe("c-gen");
    // An empty box lists only places with something going on or recently visited.
    const empty = rankSwitcherItems(withState, "", { recent });
    expect(empty.map((i) => i.key)).toEqual(["c-games", "c-vc"]);
  });
});

describe("recents", () => {
  test("pushRecent dedupes and caps", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });
  test("keys from paths", () => {
    expect(switcherKeyForPath("/channels/s1/c1")).toBe("c-c1");
    expect(switcherKeyForPath("/channels/s1")).toBe("s-s1");
    expect(switcherKeyForPath("/dm/u1")).toBe("d-u1");
    expect(switcherKeyForPath("/dm/group/g1")).toBe("g-g1");
    expect(switcherKeyForPath("/channels/@me")).toBeNull();
  });
});

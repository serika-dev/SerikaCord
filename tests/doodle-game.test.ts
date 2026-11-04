import { describe, expect, test } from "bun:test";
import {
  createRoom, draw, editDistance, guess, guessPoints, join, leave, maskWord, normalizeGuess, pick, recipients, snapshot, start, tick,
  validateOp, type Out, type Room,
} from "@/lib/activityApps/doodle/game";

const rng = () => 0;
const msgs = (outs: Out[], t: string) => outs.filter((o) => o.msg.t === t);

function room3(now = 1_000): Room {
  const r = createRoom("i-room");
  join(r, { id: "a", name: "Ann", avatar: null }, now);
  join(r, { id: "b", name: "Bob", avatar: null }, now);
  join(r, { id: "c", name: "Cy", avatar: null }, now);
  return r;
}

function startedDrawing(now = 1_000): Room {
  const r = room3(now);
  start(r, "a", { rounds: 2, drawTime: 60 }, now, rng);
  pick(r, r.drawerId!, 0, now);
  return r;
}

describe("helpers", () => {
  test("guess normalization, edit distance, masks, points", () => {
    expect(normalizeGuess("  Hot-Dog! ")).toBe("hot dog");
    expect(normalizeGuess("Café")).toBe("cafe");
    expect(editDistance("pizza", "pizze")).toBe(1);
    expect(editDistance("pizza", "pasta", 1)).toBe(2);
    expect(maskWord("hot dog", [0])).toBe("h__ ___");
    expect(guessPoints(60_000, 60_000, 0)).toBe(400);
    expect(guessPoints(0, 60_000, 0)).toBe(100);
    expect(guessPoints(30_000, 60_000, 3)).toBe(175);
    expect(guessPoints(0, 60_000, 20)).toBe(50);
  });
  test("drawing ops are validated and clamped", () => {
    expect(validateOp({ k: "line", c: "#FF0000", w: 6, p: [1, 2, 900, -5] })).toEqual({ k: "line", c: "#ff0000", w: 6, p: [1, 2, 800, 0] });
    expect(validateOp({ k: "line", c: "red", w: 6, p: [1, 2] })).toBeNull();
    expect(validateOp({ k: "line", c: "#000000", w: 7, p: [1, 2] })).toBeNull();
    expect(validateOp({ k: "line", c: "#000000", w: 6, p: [1] })).toBeNull();
    expect(validateOp({ k: "line", c: "#000000", w: 6, p: [1, "x"] })).toBeNull();
    expect(validateOp({ k: "fill", c: "#000000", x: 5000, y: 3 })).toEqual({ k: "fill", c: "#000000", x: 799, y: 3 });
    expect(validateOp({ k: "rect", c: "#000000" })).toBeNull();
  });
});

describe("lobby and turns", () => {
  test("first player hosts; only the host starts; needs two players", () => {
    const r = createRoom("i-x");
    join(r, { id: "a", name: "Ann", avatar: null }, 0);
    expect(r.hostId).toBe("a");
    expect(msgs(start(r, "a", {}, 0, rng), "error")[0].msg.code).toBe("need_players");
    join(r, { id: "b", name: "Bob", avatar: null }, 0);
    expect(msgs(start(r, "b", {}, 0, rng), "error")[0].msg.code).toBe("not_host");
    start(r, "a", { rounds: 99, drawTime: 5 }, 0, rng);
    expect(r.phase).toBe("choosing");
    expect(r.rounds).toBe(3);
    expect(r.drawTime).toBe(80);
    expect(r.drawerId).toBe("a");
    expect(r.choices).toHaveLength(3);
  });
  test("only the drawer sees the choices and the word", () => {
    const r = room3();
    start(r, "a", {}, 1_000, rng);
    expect(snapshot(r, "a", 1_000).choices).toHaveLength(3);
    expect(snapshot(r, "b", 1_000).choices).toEqual([]);
    pick(r, "a", 1, 1_000);
    expect(r.phase).toBe("drawing");
    expect(snapshot(r, "a", 1_000).word).toBe(r.word);
    expect(snapshot(r, "b", 1_000).word).toBeNull();
    expect(snapshot(r, "b", 1_000).mask).toBe(maskWord(r.word!, []));
  });
  test("choosing times out to the first word", () => {
    const r = room3();
    start(r, "a", {}, 0, rng);
    const first = r.choices[0];
    tick(r, 16_000, rng);
    expect(r.phase).toBe("drawing");
    expect(r.word).toBe(first);
  });
  test("hints appear at half and three quarters of the time", () => {
    const r = startedDrawing(0);
    r.word = "giraffe";
    tick(r, 31_000, rng);
    expect(r.hints).toHaveLength(1);
    tick(r, 46_000, rng);
    expect(r.hints).toHaveLength(2);
  });
});

describe("guessing", () => {
  test("a correct guess scores, hides the word from chat and the drawer earns a share", () => {
    const r = startedDrawing(0);
    const word = r.word!;
    const outs = guess(r, "b", word.toUpperCase(), 10_000, rng);
    expect(outs.some((o) => o.msg.kind === "correct")).toBe(true);
    expect(outs.some((o) => o.msg.t === "chat" && o.msg.text === word.toUpperCase())).toBe(false);
    const b = r.players.find((p) => p.id === "b")!;
    expect(b.guessed).toBe(true);
    expect(b.score).toBeGreaterThan(0);
    expect(r.players.find((p) => p.id === "a")!.score).toBe(Math.round(b.score / 4));
    expect(snapshot(r, "b", 10_000).word).toBe(word);
  });
  test("guessers chat only among themselves and the drawer", () => {
    const r = startedDrawing(0);
    guess(r, "b", r.word!, 1_000, rng);
    const outs = guess(r, "b", "easy!", 2_000, rng);
    expect(outs[0].to).toEqual(["a", "b"]);
    expect(outs[0].msg.kind).toBe("inside");
  });
  test("close guesses get a private hint", () => {
    const r = startedDrawing(0);
    r.word = "pizza";
    const outs = guess(r, "c", "pizze", 1_000, rng);
    expect(outs.find((o) => o.msg.kind === "close")?.to).toEqual(["c"]);
  });
  test("everyone guessing ends the turn; reveal leads to the next drawer", () => {
    const r = startedDrawing(0);
    const firstDrawer = r.drawerId;
    guess(r, "b", r.word!, 1_000, rng);
    guess(r, "c", r.word!, 2_000, rng);
    expect(r.phase).toBe("reveal");
    tick(r, 2_000 + 7_000, rng);
    expect(r.phase).toBe("choosing");
    expect(r.drawerId).not.toBe(firstDrawer);
  });
  test("the game ends after every round", () => {
    const r = room3(0);
    start(r, "a", { rounds: 1 }, 0, rng);
    let now = 0;
    for (let turn = 0; turn < 3; turn++) {
      pick(r, r.drawerId!, 0, now);
      now += 200_000;
      tick(r, now, rng); // time up -> reveal
      now += 10_000;
      tick(r, now, rng); // next drawer or end
    }
    expect(r.phase).toBe("end");
  });
});

describe("drawing and leaving", () => {
  test("only the drawer draws; undo and clear edit the history", () => {
    const r = startedDrawing(0);
    const d = r.drawerId!;
    const other = r.players.find((p) => p.id !== d)!.id;
    expect(draw(r, other, { ops: [{ k: "line", c: "#000000", w: 6, p: [0, 0, 5, 5] }], begin: true })).toEqual([]);
    const outs = draw(r, d, { ops: [{ k: "line", c: "#000000", w: 6, p: [0, 0, 5, 5] }], begin: true });
    expect(outs[0].to).not.toContain(d);
    draw(r, d, { ops: [{ k: "fill", c: "#ff0000", x: 1, y: 1 }], begin: true });
    expect(r.groups).toHaveLength(2);
    draw(r, d, { action: "undo" });
    expect(r.groups).toHaveLength(1);
    draw(r, d, { action: "clear" });
    expect(r.groups).toHaveLength(0);
    expect(r.numbers).toBe(0);
  });
  test("the drawer leaving ends the turn; too few players go back to the lobby", () => {
    const r = startedDrawing(0);
    leave(r, r.drawerId!, 1_000, rng);
    expect(r.phase).toBe("reveal");
    const remaining = r.players.filter((p) => p.connected);
    leave(r, remaining[0].id, 2_000, rng);
    expect(r.phase).toBe("lobby");
  });
  test("recipients and the player cap", () => {
    const r = createRoom("i-cap");
    for (let i = 0; i < 12; i++) join(r, { id: `u${i}`, name: `U${i}`, avatar: null }, 0);
    expect(msgs(join(r, { id: "late", name: "Late", avatar: null }, 0), "error")[0].msg.code).toBe("full");
    expect(recipients(r, { to: "all", msg: {} })).toHaveLength(12);
  });
});

describe("results message", () => {
  test("ranks players, strips markdown and pings", async () => {
    const { resultsText } = await import("@/lib/activityApps/doodle/server");
    const text = resultsText([{ name: "Bob", score: 300 }, { name: "**@everyone**", score: 900 }, { name: "Cy", score: 100 }]);
    expect(text.split("\n")).toEqual([
      "🎨 **Doodle Party results**",
      "👑 **everyone**: 900 points",
      "🥈 **Bob**: 300 points",
      "🥉 **Cy**: 100 points",
    ]);
  });
});

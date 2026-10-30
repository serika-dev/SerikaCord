import { describe, expect, test } from "bun:test";
import { headFirstRows, initialMountStart } from "../src/lib/chat/messageWindow";

const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ messages: [{ id: `m${i}a` }, { id: `m${i}b` }] }));

describe("initialMountStart", () => {
  test("mounts everything when the page is short", () => {
    expect(initialMountStart(groups(8), null, 12)).toBe(0);
    expect(initialMountStart(groups(12), null, 12)).toBe(0);
  });

  test("mounts the newest groups first", () => {
    expect(initialMountStart(groups(30), null, 12)).toBe(18);
  });

  test("starts at the unread divider when it is older", () => {
    expect(initialMountStart(groups(30), "m5b", 12)).toBe(5);
  });

  test("a divider inside the newest groups changes nothing", () => {
    expect(initialMountStart(groups(30), "m25a", 12)).toBe(18);
  });

  test("an unknown divider id is ignored", () => {
    expect(initialMountStart(groups(30), "nope", 12)).toBe(18);
  });
});

describe("headFirstRows", () => {
  const rows = (n: number, enc = true) => Array.from({ length: n }, (_, i) => ({ id: i, e2ee: enc }));
  const isEnc = (r: { e2ee: boolean }) => r.e2ee;
  test("newest rows of a long encrypted page", () => {
    expect(headFirstRows(rows(50), 20, isEnc)?.map((r) => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => 30 + i));
  });
  test("a short page decrypts in one go", () => {
    expect(headFirstRows(rows(20), 20, isEnc)).toBeNull();
  });
  test("a page without envelopes needs no first pass", () => {
    expect(headFirstRows(rows(50, false), 20, isEnc)).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { capTail, reconcileLatestPage } from "../src/lib/chat/messageWindow";
import { reuseUnchanged } from "../src/lib/state/reuseUnchanged";
import { formatDayDivider, formatMessageTimestamp } from "../src/lib/chat/messages";
import { previewUrlOf } from "../src/lib/chat/linkUrls";
import type { ChatMessage } from "../src/lib/chat/types";

const msg = (id: string, minute: number, content = `hello ${id}`): ChatMessage =>
  ({
    id,
    content,
    authorId: "u1",
    author: { id: "u1", username: "u1", displayName: "U1" },
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    attachments: [],
    embeds: [],
    reactions: [],
  }) as unknown as ChatMessage;

describe("message revalidation keeps unchanged objects", () => {
  const key = (m: ChatMessage) => m.id;

  test("an identical latest page re-renders nothing", () => {
    const prev = [msg("a", 1), msg("b", 2), msg("c", 3)];
    const page = [msg("a", 1), msg("b", 2), msg("c", 3)];
    const next = reuseUnchanged(prev, capTail(reconcileLatestPage(page, prev), 200), key);
    expect(next).toBe(prev);
  });

  test("only the edited message gets a new object", () => {
    const prev = [msg("a", 1), msg("b", 2), msg("c", 3)];
    const page = [msg("a", 1), msg("b", 2, "edited"), msg("c", 3)];
    const next = reuseUnchanged(prev, capTail(reconcileLatestPage(page, prev), 200), key);
    expect(next).not.toBe(prev);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).toBe(page[1]);
    expect(next[2]).toBe(prev[2]);
  });

  test("new messages are appended, old ones kept by reference", () => {
    const prev = [msg("a", 1), msg("b", 2)];
    const page = [msg("a", 1), msg("b", 2), msg("c", 3)];
    const next = reuseUnchanged(prev, capTail(reconcileLatestPage(page, prev), 200), key);
    expect(next.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).toBe(prev[1]);
  });
});

describe("cached date formatters", () => {
  const stamps = ["2020-03-04T05:06:07Z", "2026-12-31T23:59:00Z", new Date().toISOString(), "not a date"];
  for (const locale of [undefined, "en", "nl", "ja"]) {
    test(`same text as toLocale*String (${locale ?? "default"})`, () => {
      for (const t of stamps) {
        const d = new Date(t);
        const day = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
        expect(formatDayDivider(t, locale)).toBe(day);
        expect(formatMessageTimestamp(t, undefined, locale)).toContain(d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }));
      }
    });
  }
});

describe("previewUrlOf", () => {
  test("no link, no preview", () => {
    expect(previewUrlOf("just text", [])).toBe("");
    expect(previewUrlOf("", [])).toBe("");
  });

  test("first link, trailing punctuation trimmed", () => {
    expect(previewUrlOf("see https://example.com/a, and https://b.example/x", [])).toBe("https://example.com/a");
  });

  test("<url> opts out of the preview", () => {
    expect(previewUrlOf("<https://example.com/a>", [])).toBe("");
  });

  test("a link a rich embed already shows is skipped", () => {
    expect(previewUrlOf("https://www.example.com/a/ and https://c.example", ["http://example.com/a"])).toBe("https://c.example");
  });
});

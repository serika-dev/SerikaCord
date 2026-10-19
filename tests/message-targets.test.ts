import { describe, expect, test } from "bun:test";
import { isEditableOwnMessage, isReplyableMessage, stepMessageTarget } from "@/lib/chat/messageTargets";
import type { ChatMessage } from "@/lib/chat/types";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function msg(id: string, authorId: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    content: "message " + id,
    authorId,
    author: { id: authorId, username: authorId === ME ? "me" : "bob", displayName: "" },
    channelId: "channel",
    createdAt: new Date(2026, 0, 1, 12, Number(id.replace(/\D/g, "")) || 0).toISOString(),
    reactions: [],
    ...extra,
  };
}

const list = [
  msg("m1", BOB),
  msg("m2", ME),
  msg("m3", BOB, { type: "call" }),
  msg("m4", BOB),
  msg("temp-5", ME, { pending: true }),
];

describe("Ctrl+Up/Down reply selection (CORD-11)", () => {
  test("only real messages can be replied to", () => {
    expect(list.filter(isReplyableMessage).map((m) => m.id)).toEqual(["m1", "m2", "m4"]);
  });

  test("Up starts at the newest message and walks older, stopping at the oldest", () => {
    expect(stepMessageTarget(list, null, -1)?.id).toBe("m4");
    expect(stepMessageTarget(list, "m4", -1)?.id).toBe("m2");
    expect(stepMessageTarget(list, "m2", -1)?.id).toBe("m1");
    expect(stepMessageTarget(list, "m1", -1)?.id).toBe("m1");
  });

  test("Down walks newer and past the newest cancels", () => {
    expect(stepMessageTarget(list, "m1", 1)?.id).toBe("m2");
    expect(stepMessageTarget(list, "m4", 1)).toBeNull();
    expect(stepMessageTarget(list, null, 1)).toBeUndefined();
    // A target that scrolled out of the window: Down clears, Up restarts at the newest.
    expect(stepMessageTarget(list, "gone", 1)).toBeNull();
    expect(stepMessageTarget(list, "gone", -1)?.id).toBe("m4");
  });

  test("empty conversations do nothing", () => {
    expect(stepMessageTarget([], null, -1)).toBeUndefined();
  });

  test("Ctrl+Shift+Up/Down steps through your own editable messages", () => {
    const own = (m: ChatMessage) => isEditableOwnMessage(m, ME);
    const mine = [...list, msg("m6", ME), msg("m7", ME, { poll: { question: "q" } as never })];
    expect(stepMessageTarget(mine, null, -1, own)?.id).toBe("m6");
    expect(stepMessageTarget(mine, "m6", -1, own)?.id).toBe("m2");
    expect(stepMessageTarget(mine, "m6", 1, own)).toBeNull();
    expect(isEditableOwnMessage(msg("w", ME, { webhookId: "hook" }), ME)).toBe(false);
    expect(isEditableOwnMessage(msg("x", ME), null)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  CROSSPOST_FLAGS,
  canPublishMessage,
  canReceiveFollow,
  copyableAttachments,
  followWebhookName,
  isCrosspostCopy,
  isCrossposted,
} from "../src/lib/chat/announcements";

describe("canPublishMessage", () => {
  const msg = { id: "m1", type: "default", flags: 0 };
  test("only saved regular messages in announcement channels", () => {
    expect(canPublishMessage(msg, "announcement")).toBe(true);
    expect(canPublishMessage({ ...msg, type: "reply" }, "announcement")).toBe(true);
    expect(canPublishMessage(msg, "text")).toBe(false);
    expect(canPublishMessage({ ...msg, id: "temp-1" }, "announcement")).toBe(false);
    expect(canPublishMessage({ ...msg, pending: true }, "announcement")).toBe(false);
    expect(canPublishMessage({ ...msg, type: "pin" }, "announcement")).toBe(false);
  });
  test("not twice, and never a published copy", () => {
    expect(canPublishMessage({ ...msg, flags: CROSSPOST_FLAGS.CROSSPOSTED }, "announcement")).toBe(false);
    expect(canPublishMessage({ ...msg, flags: CROSSPOST_FLAGS.IS_CROSSPOST }, "announcement")).toBe(false);
  });
});

describe("flags", () => {
  test("bit checks", () => {
    expect(isCrossposted(1)).toBe(true);
    expect(isCrossposted(2)).toBe(false);
    expect(isCrosspostCopy(2 | 4096)).toBe(true);
    expect(isCrosspostCopy(undefined)).toBe(false);
  });
});

describe("followWebhookName", () => {
  test("Server #channel, trimmed to 80 chars", () => {
    expect(followWebhookName("Serika", "news")).toBe("Serika #news");
    expect(followWebhookName("", "news")).toBe("#news");
    expect(followWebhookName("Serika", "")).toBe("Serika");
    const long = followWebhookName("S".repeat(200), "updates");
    expect(long.length <= 80).toBe(true);
    expect(long.endsWith("… #updates")).toBe(true);
  });
});

describe("targets and copies", () => {
  test("only text-like channels receive follows", () => {
    expect(canReceiveFollow("text")).toBe(true);
    expect(canReceiveFollow("announcement")).toBe(true);
    expect(canReceiveFollow("voice")).toBe(false);
    expect(canReceiveFollow("forum")).toBe(false);
  });
  test("copies at most 10 object attachments", () => {
    expect(copyableAttachments([{ a: 1 }, null, "x", ...Array.from({ length: 12 }, () => ({}))]).length).toBe(10);
    expect(copyableAttachments("nope")).toEqual([]);
  });
});

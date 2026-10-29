import { describe, expect, test } from "bun:test";
import { randomBytes } from "crypto";
import { isEncrypted } from "../src/lib/security/encryption";

describe("isEncrypted", () => {
  test("stored ciphertext (padded base64) is recognised", () => {
    const v2 = Buffer.concat([Buffer.from([0x02]), randomBytes(16 + 16 + 20)]).toString("base64");
    expect(isEncrypted(v2)).toBe(true);
    const legacy = randomBytes(32 + 16 + 16 + 30).toString("base64");
    expect(isEncrypted(legacy)).toBe(true);
  });

  test("ordinary long text is not treated as ciphertext", () => {
    const text = "Did you see the game last night? It was absolutely incredible, the final minutes were insane.";
    expect(text.length).toBeGreaterThan(88);
    expect(isEncrypted(text)).toBe(false);
    // base64 alphabet only, but not a multiple of 4 long
    expect(isEncrypted("a".repeat(101))).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});

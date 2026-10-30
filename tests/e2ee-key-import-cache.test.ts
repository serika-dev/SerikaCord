import { describe, expect, test } from "bun:test";
import { exportPublicKey, generateBackupKeyPair, generateDeviceKeys, importRecipientPublicKey, signBytes, verifyBytes, describeDevice } from "../src/lib/e2ee/keys";

describe("imported public key cache", () => {
  test("the same recipient key is imported once", async () => {
    const pair = await generateBackupKeyPair(true);
    const pub = await exportPublicKey(pair.publicKey);
    const a = importRecipientPublicKey(pub);
    const b = importRecipientPublicKey(pub);
    expect(a).toBe(b);
    expect((await a).type).toBe("public");
  });

  test("a bad key is refused and not remembered", async () => {
    const bad = Buffer.alloc(65, 7).toString("base64");
    const first = importRecipientPublicKey(bad);
    await expect(first).rejects.toBeDefined();
    await Promise.resolve();
    expect(importRecipientPublicKey(bad)).not.toBe(first);
    await importRecipientPublicKey(bad).catch(() => {});
  });

  test("signatures still verify (and fail) with the cached signing key", async () => {
    const dev = await generateDeviceKeys(false);
    const { signPub } = await describeDevice(dev);
    const data = new TextEncoder().encode("hello");
    const sig = await signBytes(dev.sign.privateKey, data);
    expect(await verifyBytes(signPub, sig, data)).toBe(true);
    expect(await verifyBytes(signPub, sig, data)).toBe(true);
    expect(await verifyBytes(signPub, sig, new TextEncoder().encode("hellO"))).toBe(false);
  });
});

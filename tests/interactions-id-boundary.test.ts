import { describe, expect, test } from "bun:test";
import { STRUCTURAL_KIND, rewriteOutbound, scanOutbound } from "@/lib/botapi/idTranslate";

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const SF = (n: number) => String(1_000_000_000_000_000n + BigInt(n));

describe("interaction payloads through the snowflake boundary", () => {
  test("entity select values and resolved maps are ids; string select values are text", () => {
    const payload = {
      id: U(1), token: "tok", application_id: U(2), type: 3,
      data: {
        custom_id: "pick", component_type: 5, values: [U(10), U(11)],
        resolved: { users: { [U(10)]: { id: U(10), username: "a" } }, members: { [U(10)]: { roles: [U(20)] } } },
      },
      message: { components: [{ type: 1, components: [{ type: 3, custom_id: "s", options: [{ label: "x", value: U(30) }] }] }] },
    };
    const scan = scanOutbound(payload);
    expect(scan.uuids.has(U(10))).toBeTrue();
    expect(scan.uuids.has(U(11))).toBeTrue();
    expect(scan.uuids.has(U(20))).toBeTrue();
    expect(scan.uuids.has(U(30))).toBeFalse(); // an option value is text
    const map = new Map([[U(1), SF(1)], [U(2), SF(2)], [U(10), SF(10)], [U(11), SF(11)], [U(20), SF(20)]]);
    const out = rewriteOutbound(payload, { get: (u) => map.get(u) }) as typeof payload;
    expect(out.data.values).toEqual([SF(10), SF(11)]);
    expect(Object.keys(out.data.resolved.users)).toEqual([SF(10)]);
    expect(out.data.resolved.members[SF(10) as keyof typeof out.data.resolved.members]).toBeDefined();
    expect(out.application_id).toBe(SF(2));
  });

  test("string select and modal string values stay text; modal entity selects are ids", () => {
    const scan = scanOutbound({
      data: {
        components: [
          { type: 18, component: { type: 3, custom_id: "s", values: [U(40)] } },
          { type: 18, component: { type: 6, custom_id: "r", values: [U(41)] } },
        ],
      },
    });
    expect(scan.uuids.has(U(40))).toBeFalse();
    expect(scan.uuids.has(U(41))).toBeTrue();
  });

  test("ephemeral message ids get a mapping (they are in no table)", () => {
    const scan = scanOutbound({ id: U(50), channel_id: U(51), timestamp: "2026-10-16T00:00:00.000Z", flags: 64, content: "hi" });
    expect(scan.kinds.get(U(50))).toBe(STRUCTURAL_KIND.message);
    const persisted = scanOutbound({ id: U(52), channel_id: U(51), timestamp: "2026-10-16T00:00:00.000Z", flags: 0 });
    expect(persisted.kinds.has(U(52))).toBeFalse();
  });
});

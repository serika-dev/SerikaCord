import { describe, expect, test } from "bun:test";
import { canLeaveServer, isServerOwner } from "@/lib/servers/ownership";

const OWNER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MEMBER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("server ownership (CORD-77)", () => {
  test("the owner is recognised by ownerId", () => {
    expect(isServerOwner({ ownerId: OWNER }, OWNER)).toBe(true);
    expect(isServerOwner({ ownerId: OWNER }, MEMBER)).toBe(false);
  });

  test("ids compare case-insensitively and legacy Mongo ids match their UUID form", () => {
    expect(isServerOwner({ ownerId: OWNER.toUpperCase() }, OWNER)).toBe(true);
    expect(isServerOwner({ ownerId: "507f1f77-bcf8-6cd7-9943-901100000000" }, "507f1f77bcf86cd799439011")).toBe(true);
  });

  test("an isOwner flag from the API counts", () => {
    expect(isServerOwner({ isOwner: true }, MEMBER)).toBe(true);
    expect(isServerOwner({ isOwner: false, ownerId: OWNER }, OWNER)).toBe(true);
  });

  test("missing data never makes someone the owner", () => {
    expect(isServerOwner(null, OWNER)).toBe(false);
    expect(isServerOwner({ ownerId: OWNER }, null)).toBe(false);
    expect(isServerOwner({ ownerId: null }, OWNER)).toBe(false);
    expect(isServerOwner({ ownerId: "" }, "")).toBe(false);
  });

  test("owners can't leave, members can", () => {
    expect(canLeaveServer({ ownerId: OWNER }, OWNER)).toBe(false);
    expect(canLeaveServer({ ownerId: OWNER }, MEMBER)).toBe(true);
    expect(canLeaveServer(null, MEMBER)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  isAdminTier,
  isSuperAdmin,
  signSession,
  verifySession,
  type SessionPayload,
  type UserRole,
} from "../session";

function payload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    uid: "11111111-1111-1111-1111-111111111111",
    full_name: "Test",
    role: "seller",
    store_id: 1,
    iat: Date.now(),
    ...overrides,
  };
}

describe("verifySession", () => {
  it("round-trips a freshly signed token", async () => {
    const token = await signSession(payload());
    const parsed = await verifySession(token);
    expect(parsed?.uid).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed?.role).toBe("seller");
  });

  it("rejects a tampered signature without throwing", async () => {
    const token = await signSession(payload());
    const [body] = token.split(".");
    // valid base64url, but wrong signature bytes
    await expect(verifySession(`${body}.AAAA`)).resolves.toBeNull();
  });

  it("returns null (does not throw) on a malformed, non-base64 signature (L5)", async () => {
    const token = await signSession(payload());
    const [body] = token.split(".");
    // '@@@@' is not valid base64url -> atob throws inside verifySession;
    // must be caught and surfaced as null, not a 500.
    await expect(verifySession(`${body}.@@@@`)).resolves.toBeNull();
  });

  it("returns null on a fully garbage token", async () => {
    await expect(verifySession("not.a.valid.token")).resolves.toBeNull();
    await expect(verifySession("@@@.@@@")).resolves.toBeNull();
  });

  it("returns null for empty / missing token", async () => {
    await expect(verifySession(undefined)).resolves.toBeNull();
    await expect(verifySession("")).resolves.toBeNull();
    await expect(verifySession("onlybody")).resolves.toBeNull();
  });
});

describe("isAdminTier", () => {
  it.each<[UserRole | undefined | null, boolean]>([
    ["super_admin", true],
    ["admin", true],
    ["seller", false],
    [undefined, false],
    [null, false],
  ])("returns %p for role=%s", (role, expected) => {
    expect(isAdminTier(role)).toBe(expected);
  });
});

describe("isSuperAdmin", () => {
  it.each<[UserRole | undefined | null, boolean]>([
    ["super_admin", true],
    ["admin", false],
    ["seller", false],
    [undefined, false],
    [null, false],
  ])("returns %p for role=%s", (role, expected) => {
    expect(isSuperAdmin(role)).toBe(expected);
  });
});

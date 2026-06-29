import { describe, expect, it } from "vitest";
import { isAdminTier, isSuperAdmin, type UserRole } from "../session";

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

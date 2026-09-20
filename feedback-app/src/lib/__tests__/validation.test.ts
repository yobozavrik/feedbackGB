import { describe, expect, it } from "vitest";
import { isUuid, safeNextPath } from "../validation";

// Build control-char inputs at runtime so this source file stays pure ASCII.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

describe("safeNextPath (L3 open-redirect guard)", () => {
  it("passes through same-origin absolute paths", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/my-requests")).toBe("/my-requests");
    expect(safeNextPath("/feedback/complaint?x=1")).toBe("/feedback/complaint?x=1");
  });

  it("collapses external / protocol-relative / backslash targets to '/'", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("http://evil.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("mailto:x@y.z")).toBe("/");
    expect(safeNextPath("evil.com")).toBe("/");
    expect(safeNextPath("../../etc")).toBe("/");
  });

  it("rejects control-character smuggling", () => {
    expect(safeNextPath("/" + TAB + "evil")).toBe("/");
    expect(safeNextPath("/" + LF + "https://evil.com")).toBe("/");
    expect(safeNextPath(NUL + "//evil.com")).toBe("/");
  });

  it("defaults empty / nullish input to '/'", () => {
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});

describe("isUuid", () => {
  it("accepts a canonical uuid and rejects junk", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

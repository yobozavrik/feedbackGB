import { describe, expect, it } from "vitest";
import { safeLoginNext } from "../loginRedirect";

describe("safeLoginNext", () => {
  it("preserves an internal path with analytics filters", () => {
    expect(safeLoginNext("/admin/stores?tab=analytics&period=30d&spot_ids=1%2C2"))
      .toBe("/admin/stores?tab=analytics&period=30d&spot_ids=1%2C2");
  });

  it.each([null, "", "https://evil.example/x", "//evil.example/x", "/\\evil", "/admin\n/x"])(
    "rejects an unsafe next target: %s", (value) => expect(safeLoginNext(value)).toBe("/"));

  it("drops a fragment that must not influence the server route", () => {
    expect(safeLoginNext("/admin/stores?tab=analytics#secret")).toBe("/admin/stores?tab=analytics");
  });
});

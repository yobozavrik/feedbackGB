import { describe, expect, it, vi } from "vitest";
import { foodcostMatrixReturnHref, parseFoodcostMatrixCategoryKey, parseFoodcostMatrixMethod,
  pushFoodcostMatrixUrlState, updateFoodcostMatrixUrl } from "../foodcostMatrixUrl";

describe("foodcost matrix URL state", () => {
  it("accepts both special categories and only canonical positive category ids", () => {
    expect(parseFoodcostMatrixCategoryKey("__unknown")).toBe("__unknown");
    expect(parseFoodcostMatrixCategoryKey("__conflict")).toBe("__conflict");
    expect(parseFoodcostMatrixCategoryKey("42")).toBe("42");
    for (const invalid of ["", "0", "-1", "01", "1.5", "1e2", "__other", "9007199254740992"]) {
      expect(parseFoodcostMatrixCategoryKey(invalid)).toBe("all");
    }
  });

  it("defaults unknown methods safely and preserves shared query context when updating matrix state", () => {
    expect(parseFoodcostMatrixMethod("netto")).toBe("netto");
    expect(parseFoodcostMatrixMethod("sql")).toBe("profit");
    const next = updateFoodcostMatrixUrl("https://example.test/admin/technologist/food-cost?tab=matrix&days=14&spot_id=3&category_id=__conflict",
      { method: "netto", categoryKey: "all" });
    expect(next).toBe("/admin/technologist/food-cost?tab=matrix&days=14&spot_id=3&method=netto");
  });

  it("clears a numeric category filter on All and restores it when browser history returns", () => {
    const original = "https://example.test/admin/technologist/food-cost?tab=matrix&days=14&spot_id=3&category_id=42";
    const allUrl = new URL(updateFoodcostMatrixUrl(original, { categoryKey: "all" }), original);
    expect(parseFoodcostMatrixCategoryKey(allUrl.searchParams.get("category_id"))).toBe("all");
    const backUrl = new URL(original);
    expect(parseFoodcostMatrixCategoryKey(backUrl.searchParams.get("category_id"))).toBe("42");
  });

  it("passes null history state so Next updates its router state and useSearchParams", () => {
    const pushState = vi.fn();
    pushFoodcostMatrixUrlState({ pushState },
      "https://example.test/admin/technologist/food-cost?tab=matrix&days=14&spot_id=3",
      { method: "netto" });
    expect(pushState).toHaveBeenCalledWith(null, "",
      "/admin/technologist/food-cost?tab=matrix&days=14&spot_id=3&method=netto");
  });

  it("builds a validated internal return link with period, store, method, and category", () => {
    expect(foodcostMatrixReturnHref({ days: 30, spotId: 3, method: "netto", categoryKey: "__conflict" }))
      .toBe("/admin/technologist/food-cost?tab=matrix&days=30&method=netto&spot_id=3&category_id=__conflict");
  });
});

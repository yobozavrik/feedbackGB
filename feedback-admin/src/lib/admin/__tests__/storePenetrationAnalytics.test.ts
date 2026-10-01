import { describe, expect, it } from "vitest";
import { enrichStorePenetrationCategoryNames, parseStorePenetrationAnalytics } from "../storePenetrationAnalytics";

function complete() {
  return {
    methodologyVersion: "store-penetration-v1", asOf: "2026-09-30T10:00:00+00:00", timezone: "Europe/Kyiv",
    spotIds: [1, 2], status: "complete",
    coverage: { from: "2026-09-16", to: "2026-09-17", expectedDays: 2, completedDays: 2, missingDates: [] as string[] },
    denominator: { eligibleReceipts: 100 as number | null,
      definition: "distinct eligible purchase receipts in selected network scope" },
    mapping: { status: "complete", bridgeRows: 180, mappedRows: 180, unmappedRows: 0 },
    selectedCategoryId: 7 as number | null,
    categories: [{ categoryId: 7, receiptCount: 25, penetrationPercent: "25.00", storeCount: 2 }],
    products: [{ productId: 10, modificationId: 0, categoryId: 7, productName: "Пельмені",
      receiptCount: 20, penetrationPercent: "20.00", storeCount: 2 }],
    stores: [
      { spotId: 1, eligibleReceipts: 40, categoryReceipts: 10, penetrationPercent: "25.00" },
      { spotId: 2, eligibleReceipts: 60, categoryReceipts: 15, penetrationPercent: "25.00" },
    ],
    trend: [
      { date: "2026-09-16", eligibleReceipts: 45, categoryReceipts: 9, penetrationPercent: "20.00" },
      { date: "2026-09-17", eligibleReceipts: 55, categoryReceipts: 16, penetrationPercent: "29.09" },
    ],
    historicalRosterVerified: false,
  };
}

describe("store penetration analytics response", () => {
  it("accepts reconciled ratio-of-distinct-receipt totals", () => {
    const parsed = parseStorePenetrationAnalytics(complete());
    expect(parsed.denominator.eligibleReceipts).toBe(100);
    expect(parsed.stores.reduce((sum, row) => sum + row.categoryReceipts, 0)).toBe(25);
    expect(parsed.categories[0]).toMatchObject({ categoryName: "Категорія #7", categoryNameSource: "missing" });
  });

  it("enriches labels without changing receipt facts", () => {
    const enriched = enrichStorePenetrationCategoryNames(parseStorePenetrationAnalytics(complete()), new Map([[7, "Пельмені"]]));
    expect(enriched.categories[0]).toMatchObject({ categoryName: "Пельмені", categoryNameSource: "current_poster_catalog",
      receiptCount: 25, penetrationPercent: "25.00" });
  });

  it("accepts the category-list response before a category is selected", () => {
    const value = complete();
    value.selectedCategoryId = null;
    value.stores = [];
    value.trend = [];
    const parsed = parseStorePenetrationAnalytics(value);
    expect(parsed.selectedCategoryId).toBeNull();
    expect(parsed.categories).toHaveLength(1);
  });

  it("rejects an invented percentage", () => {
    const value = complete();
    value.categories[0].penetrationPercent = "30.00";
    expect(() => parseStorePenetrationAnalytics(value)).toThrow("store_penetration_response_invalid");
  });

  it("rejects a network result built from unreconciled store numerators", () => {
    const value = complete();
    value.stores[1].categoryReceipts = 14;
    value.stores[1].penetrationPercent = "23.33";
    expect(() => parseStorePenetrationAnalytics(value)).toThrow("store_penetration_response_invalid");
  });

  it("accepts incomplete coverage only with hidden business results", () => {
    const value = complete();
    Object.assign(value, {
      status: "incomplete", selectedCategoryId: null,
      coverage: { from: "2026-09-16", to: "2026-09-17", expectedDays: 2, completedDays: 1,
        missingDates: ["2026-09-17"] },
      denominator: { eligibleReceipts: null,
        definition: "distinct eligible purchase receipts in selected network scope" },
      mapping: { status: "unavailable", bridgeRows: 0, mappedRows: 0, unmappedRows: 0 },
      categories: [], products: [], stores: [], trend: [],
    });
    expect(parseStorePenetrationAnalytics(value).status).toBe("incomplete");
  });

  it("rejects partial business results in an incomplete response", () => {
    const value = complete();
    value.status = "incomplete";
    value.coverage.completedDays = 1;
    value.coverage.missingDates = ["2026-09-17"];
    value.denominator.eligibleReceipts = null;
    expect(() => parseStorePenetrationAnalytics(value)).toThrow("store_penetration_response_invalid");
  });
});

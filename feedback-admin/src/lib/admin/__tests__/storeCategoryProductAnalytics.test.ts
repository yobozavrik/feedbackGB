import { describe, expect, it } from "vitest";
import { enrichStoreCatalogCategoryNames, parseStoreCategoryProductAnalytics } from "../storeCategoryProductAnalytics";

const valid = () => ({
  methodologyVersion: "store-category-product-v1", asOf: "2026-09-30T10:00:00Z", timezone: "Europe/Kyiv",
  historicalRosterVerified: false, spotIds: [1, 2],
  current: { from: "2026-09-23", to: "2026-09-29", status: "complete", expectedCells: 14,
    completedCells: 14, missingCount: 0, missing: [], totalRevenueMinor: "100000" },
  comparison: { from: "2026-09-16", to: "2026-09-22", status: "incomplete", expectedCells: 14,
    completedCells: 13, missingCount: 1, missing: [{ date: "2026-09-16", spotId: 2 }], totalRevenueMinor: null },
  categories: [{ categoryId: null, categoryName: "Без категорії", categoryNameConflict: false,
    revenueMinor: "1000", revenueSharePercent: "1.00", profitMinor: "600", classicFoodcostPercent: "40.00",
    storeCoverageCount: 2, selectedStoreCount: 2, distinctProductCount: 1, previousRevenueMinor: null,
    deltaRevenueMinor: null, deltaRevenuePercent: null, deltaSharePoints: null }],
  products: { total: 1, limit: 25, offset: 0, rows: [{ productId: 10, modificationId: 0,
    productName: "Пельмені", productNameConflict: false, categoryId: null, categoryName: "Без категорії",
    categoryNameConflict: false, unit: "kg", weightBased: true, quantity: "2.5", revenueMinor: "1000",
    revenueSharePercent: "1.0000", profitMinor: "600", classicFoodcostPercent: "40.00",
    effectivePriceMinor: "400.0000", storeCoverageCount: 2, selectedStoreCount: 2, previousQuantity: null,
    previousRevenueMinor: null, deltaRevenueMinor: null, deltaRevenuePercent: null }] },
  trend: [{ date: "2026-09-23", revenueMinor: "1000", quantity: "2.5", unit: "kg", unitConflict: false }],
  penetration: { status: "unavailable", reason: "receipt_line_quantity_and_money_basis_unverified" },
});

describe("store category/product analytics parser", () => {
  it("preserves unknown categories and modifier identity", () => {
    const parsed = parseStoreCategoryProductAnalytics(valid());
    expect(parsed.categories[0].categoryId).toBeNull();
    expect(parsed.categories[0].categoryNameSource).toBe("unknown");
    expect(parsed.products.rows[0]).toMatchObject({ productId: 10, modificationId: 0, unit: "kg" });
  });
  it("does not label a known category id as unknown when its historical name is absent", () => {
    const source = valid();
    const parsed = parseStoreCategoryProductAnalytics({ ...source,
      categories: [{ ...source.categories[0], categoryId: 7 }],
      products: { ...source.products, rows: [{ ...source.products.rows[0], categoryId: 7 }] },
    });
    expect(parsed.categories[0]).toMatchObject({ categoryId: 7, categoryName: "Категорія #7",
      categoryNameSource: "missing" });
    expect(parsed.products.rows[0]).toMatchObject({ categoryId: 7, categoryName: "Категорія #7",
      categoryNameSource: "missing" });
  });
  it("enriches display names without changing historical ids or financial facts", () => {
    const source = valid();
    const parsed = parseStoreCategoryProductAnalytics({ ...source,
      categories: [{ ...source.categories[0], categoryId: 7 }],
      products: { ...source.products, rows: [{ ...source.products.rows[0], categoryId: 7 }] },
    });
    const enriched = enrichStoreCatalogCategoryNames(parsed, new Map([[7, "Напівфабрикати"]]));
    expect(enriched.categories[0]).toMatchObject({ categoryId: 7, categoryName: "Напівфабрикати",
      categoryNameSource: "current_poster_catalog", revenueMinor: "1000" });
    expect(enriched.products.rows[0]).toMatchObject({ productId: 10, categoryId: 7,
      categoryName: "Напівфабрикати", categoryNameSource: "current_poster_catalog", revenueMinor: "1000" });
    expect(enriched.current.totalRevenueMinor).toBe("100000");
  });
  it("rejects a complete window without a total", () => {
    const source = valid();
    const payload = { ...source, current: { ...source.current, totalRevenueMinor: null } };
    expect(() => parseStoreCategoryProductAnalytics(payload)).toThrow("store_catalog_response_invalid");
  });
  it("rejects invented penetration", () => {
    const payload = valid(); payload.penetration = { status: "complete", reason: "receipt_line_quantity_and_money_basis_unverified" };
    expect(() => parseStoreCategoryProductAnalytics(payload)).toThrow("store_catalog_response_invalid");
  });
});

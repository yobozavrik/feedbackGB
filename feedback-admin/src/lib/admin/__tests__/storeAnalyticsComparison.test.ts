import { describe, expect, it } from "vitest";
import { buildStoreAnalyticsComparison } from "../storeAnalyticsComparison";
import type { StoreAnalyticsOverview, StoreAnalyticsWindow } from "../storeAnalyticsOverview";
import type { StoreCategoryProductAnalytics } from "../storeCategoryProductAnalytics";

const window = (from: string, to: string, revenue: string, stores: StoreAnalyticsWindow["stores"]): StoreAnalyticsWindow => ({
  from, to, status: "complete", expectedCells: 4, completedCells: 4, missingCount: 0, missing: [],
  sourceFetchedOldestAt: null, sourceFetchedNewestAt: null,
  metrics: { revenueMinor: revenue, profitMinor: "600", profitNettoMinor: null,
    classicFoodcostPercent: "40.00", nettoFoodcostPercent: null },
  trend: [], stores,
  receipts: { status: "complete", expectedDays: 2, completedDays: 2, missingDates: [], receiptCount: 2,
    identifiedClientCount: 1, averageCheckMinor: null, averageCheckReason: "receipt_money_basis_unverified" },
});

const overview = (): StoreAnalyticsOverview => ({
  methodologyVersion: "store-analytics-overview-v1", asOf: "2026-09-30T10:00:00Z", timezone: "Europe/Kyiv",
  historicalRosterVerified: false, spotIds: [1, 2],
  current: window("2026-09-20", "2026-09-21", "1500", [
    { spotId: 1, storeName: "A", revenueMinor: "1000", profitMinor: "600", classicFoodcostPercent: "40" },
    { spotId: 2, storeName: "B", revenueMinor: "500", profitMinor: "300", classicFoodcostPercent: "40" },
  ]),
  comparison: window("2026-09-18", "2026-09-19", "1000", [
    { spotId: 1, storeName: "A", revenueMinor: "600", profitMinor: "360", classicFoodcostPercent: "40" },
    { spotId: 2, storeName: "B", revenueMinor: "400", profitMinor: "240", classicFoodcostPercent: "40" },
  ]),
});

const catalog = (): StoreCategoryProductAnalytics => ({
  methodologyVersion: "store-category-product-v1", asOf: "2026-09-30T10:00:00Z", timezone: "Europe/Kyiv",
  historicalRosterVerified: false, spotIds: [1, 2],
  current: { from: "2026-09-20", to: "2026-09-21", status: "complete", expectedCells: 4,
    completedCells: 4, missingCount: 0, missing: [], totalRevenueMinor: "1500" },
  comparison: { from: "2026-09-18", to: "2026-09-19", status: "complete", expectedCells: 4,
    completedCells: 4, missingCount: 0, missing: [], totalRevenueMinor: "1000" },
  categories: [
    { categoryId: 1, categoryName: "X", categoryNameSource: "sales_snapshot", categoryNameConflict: false,
      revenueMinor: "900", revenueSharePercent: "60", profitMinor: "500", classicFoodcostPercent: "40",
      storeCoverageCount: 2, selectedStoreCount: 2, distinctProductCount: 1, previousRevenueMinor: "500",
      deltaRevenueMinor: "400", deltaRevenuePercent: "80", deltaSharePoints: "10" },
    { categoryId: 2, categoryName: "Y", categoryNameSource: "sales_snapshot", categoryNameConflict: false,
      revenueMinor: "600", revenueSharePercent: "40", profitMinor: "400", classicFoodcostPercent: "40",
      storeCoverageCount: 2, selectedStoreCount: 2, distinctProductCount: 1, previousRevenueMinor: "500",
      deltaRevenueMinor: "100", deltaRevenuePercent: "20", deltaSharePoints: "-10" },
  ],
  products: { total: 0, limit: 25, offset: 0, rows: [] }, trend: [],
  penetration: { status: "unavailable", reason: "receipt_line_quantity_and_money_basis_unverified" },
});

describe("store analytics period comparison", () => {
  it("reconciles store and category contributions to the total delta", () => {
    const result = buildStoreAnalyticsComparison(overview(), catalog());
    expect(result).toMatchObject({ status: "complete", deltaRevenueMinor: "500", deltaRevenuePercent: "50.00",
      current: { revenuePerDayMinor: "750.00" }, comparison: { revenuePerDayMinor: "500.00" },
      reconciliation: { storeContributionSumMinor: "500", categoryContributionSumMinor: "500",
        storeContributionsMatch: true, categoryContributionsMatch: true } });
    expect(result.storeContributions.map((row) => row.deltaRevenueMinor)).toEqual(["400", "100"]);
  });

  it("fails closed when the comparison window is incomplete", () => {
    const source = overview();
    source.comparison = { ...source.comparison!, status: "incomplete", metrics: null };
    expect(buildStoreAnalyticsComparison(source, catalog())).toMatchObject({
      status: "unavailable", reason: "comparison_incomplete", deltaRevenueMinor: null,
      storeContributions: [], categoryContributions: [],
    });
  });

  it("reports an unreconciled category contribution instead of inventing a remainder", () => {
    const source = catalog();
    source.categories = source.categories.slice(0, 1);
    const result = buildStoreAnalyticsComparison(overview(), source);
    expect(result).toMatchObject({ status: "complete", reconciliation: {
      storeContributionsMatch: true, categoryContributionsMatch: false, categoryContributionSumMinor: "400",
    } });
  });

  it("rejects data read with a different asOf or scope", () => {
    const source = catalog(); source.asOf = "2026-09-30T10:00:01Z";
    expect(buildStoreAnalyticsComparison(overview(), source)).toMatchObject({ status: "unavailable", reason: "source_mismatch" });
  });
});

import { describe, expect, it } from "vitest";
import type { StoreAnalyticsWindow } from "../storeAnalyticsOverview";
import { buildStoreAnalyticsRanking } from "../storeAnalyticsRanking";

function window(revenues: Array<[number, string]>, status: "complete" | "incomplete" = "complete"): StoreAnalyticsWindow {
  const total = revenues.reduce((sum, [, revenue]) => sum + BigInt(revenue), 0n);
  return {
    from: "2026-09-16", to: "2026-09-22", status,
    expectedCells: 14, completedCells: status === "complete" ? 14 : 13,
    missingCount: status === "complete" ? 0 : 1,
    missing: status === "complete" ? [] : [{ date: "2026-09-22", spotId: 1 }],
    sourceFetchedOldestAt: null, sourceFetchedNewestAt: null,
    metrics: status === "complete" ? {
      revenueMinor: total.toString(), profitMinor: "0", profitNettoMinor: null,
      classicFoodcostPercent: null, nettoFoodcostPercent: null,
    } : null,
    trend: [],
    stores: status === "complete" ? revenues.map(([spotId, revenueMinor]) => ({
      spotId, storeName: `Магазин ${spotId}`, revenueMinor, profitMinor: "0", classicFoodcostPercent: null,
    })) : [],
    receipts: { status: "complete", expectedDays: 7, completedDays: 7, missingDates: [],
      receiptCount: 10, identifiedClientCount: 2, averageCheckMinor: null,
      averageCheckReason: "receipt_money_basis_unverified" },
  };
}

describe("buildStoreAnalyticsRanking", () => {
  it("calculates exact shares and comparison deltas, then sorts by revenue", () => {
    const rows = buildStoreAnalyticsRanking(window([[1, "10000"], [2, "30000"]]), window([[1, "8000"], [2, "40000"]]));
    expect(rows.map((row) => row.spotId)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ revenueSharePercent: "75.00", deltaRevenueMinor: "-10000", deltaRevenuePercent: "-25.00" });
    expect(rows[1]).toMatchObject({ revenueSharePercent: "25.00", deltaRevenueMinor: "2000", deltaRevenuePercent: "25.00" });
  });

  it("keeps bigint precision beyond Number.MAX_SAFE_INTEGER", () => {
    const rows = buildStoreAnalyticsRanking(window([[1, "9007199254740993"], [2, "9007199254740993"]]), null);
    expect(rows[0].revenueSharePercent).toBe("50.00");
    expect(rows[0].deltaRevenueMinor).toBeNull();
  });

  it("returns N/A percentage when the comparison base is zero", () => {
    const rows = buildStoreAnalyticsRanking(window([[1, "100"]]), window([[1, "0"]]));
    expect(rows[0].deltaRevenueMinor).toBe("100");
    expect(rows[0].deltaRevenuePercent).toBeNull();
  });

  it("does not expose partial current totals or partial comparison deltas", () => {
    expect(buildStoreAnalyticsRanking(window([[1, "100"]], "incomplete"), null)).toEqual([]);
    expect(buildStoreAnalyticsRanking(window([[1, "100"]]), window([[1, "50"]], "incomplete"))[0].deltaRevenueMinor).toBeNull();
  });
});

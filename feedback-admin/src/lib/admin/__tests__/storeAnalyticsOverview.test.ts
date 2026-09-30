import { describe, expect, it } from "vitest";
import { parseStoreAnalyticsOverview } from "../storeAnalyticsOverview";

function fixture() {
  return {
    methodologyVersion: "store-analytics-overview-v1", asOf: "2026-09-30T09:00:00.000Z",
    timezone: "Europe/Kyiv", historicalRosterVerified: false, spotIds: [1, 2],
    current: {
      from: "2026-09-22", to: "2026-09-28", status: "complete",
      expectedCells: 14, completedCells: 14, missingCount: 0, missing: [],
      sourceFetchedOldestAt: "2026-09-29T00:00:00Z", sourceFetchedNewestAt: "2026-09-29T01:00:00Z",
      metrics: { revenueMinor: "100000", profitMinor: "60000", profitNettoMinor: null,
        classicFoodcostPercent: "40.00", nettoFoodcostPercent: null },
      trend: [{ date: "2026-09-22", revenueMinor: "100000", profitMinor: "60000", classicFoodcostPercent: "40.00" }],
      stores: [{ spotId: 1, storeName: "Клуб", revenueMinor: "100000", profitMinor: "60000", classicFoodcostPercent: "40.00" }],
      receipts: { status: "incomplete", expectedDays: 7, completedDays: 6,
        missingDates: ["2026-09-28"], receiptCount: null, identifiedClientCount: null,
        averageCheckMinor: null, averageCheckReason: "receipt_money_basis_unverified" },
    }, comparison: null,
  };
}

describe("parseStoreAnalyticsOverview", () => {
  it("accepts aggregate data without exposing raw receipt/client fields", () => {
    const value = parseStoreAnalyticsOverview(fixture());
    expect(value.current.metrics?.revenueMinor).toBe("100000");
    expect(value.current.receipts.receiptCount).toBeNull();
  });

  it("rejects fabricated zero metrics for an incomplete sales window", () => {
    const value = fixture();
    value.current.status = "incomplete";
    value.current.metrics = null as never;
    value.current.trend = [];
    value.current.stores = [];
    expect(parseStoreAnalyticsOverview(value).current.metrics).toBeNull();
  });

  it.each([
    ["wrong methodology", (value: ReturnType<typeof fixture>) => { value.methodologyVersion = "wrong"; }],
    ["unsafe number", (value: ReturnType<typeof fixture>) => { value.current.metrics!.revenueMinor = "1e9"; }],
    ["average check guessed", (value: ReturnType<typeof fixture>) => { value.current.receipts.averageCheckMinor = "100" as never; }],
    ["receipt reason changed", (value: ReturnType<typeof fixture>) => { value.current.receipts.averageCheckReason = "unknown" as never; }],
  ])("rejects %s", (_name, mutate) => {
    const value = fixture(); mutate(value);
    expect(() => parseStoreAnalyticsOverview(value)).toThrow("store_analytics_response_invalid");
  });
});

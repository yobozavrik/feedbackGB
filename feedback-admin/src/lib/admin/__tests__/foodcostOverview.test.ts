import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ getServerSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));

import { buildFoodcostOverview, loadFoodcostOverview, type FoodcostOverviewRun } from "../foodcostOverview";

function run(overrides: Partial<FoodcostOverviewRun> = {}): FoodcostOverviewRun {
  return {
    id: "a", business_date: "2026-09-22", spot_id: 1, status: "completed",
    methodology_version: "poster-sales-dual-v1",
    completed_at: "2026-09-24T01:00:00Z", source_fetched_at: "2026-09-24T00:59:00Z",
    source_row_count: 2, payed_sum_minor: 10000, product_profit_minor: 6000,
    product_profit_netto_minor: 6500, ...overrides,
  };
}

describe("foodcost period overview", () => {
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    mocked.getServerSupabase.mockReset();
  });
  afterEach(() => {
    if (previousService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
  });

  it("sums run money across dates and stores before computing either percentage", () => {
    const rows = [
      run(), run({ id: "b", spot_id: 2, payed_sum_minor: 30000, product_profit_minor: 24000,
        product_profit_netto_minor: 25000 }),
      run({ id: "c", business_date: "2026-09-23", payed_sum_minor: 20000,
        product_profit_minor: 10000, product_profit_netto_minor: 11000 }),
      run({ id: "d", business_date: "2026-09-23", spot_id: 2, payed_sum_minor: 40000,
        product_profit_minor: 30000, product_profit_netto_minor: 32000 }),
    ];
    const result = buildFoodcostOverview("2026-09-22", "2026-09-23", [1, 2], rows);
    expect(result).toMatchObject({ status: "complete", expectedCells: 4, completedCells: 4 });
    expect(result.metrics).toMatchObject({ payedSumMinor: 100000, productProfitMinor: 70000,
      productProfitNettoMinor: 74500, foodCostPercent: 30, nettoFoodCostPercent: 25.5 });
    expect(result.days).toHaveLength(2);
    expect(result.days?.[0].metrics.payedSumMinor).toBe(40000);
  });

  it("does not publish a partial total for a missing or corrupt spot-day", () => {
    const missing = buildFoodcostOverview("2026-09-22", "2026-09-22", [1, 2], [run()]);
    expect(missing).toMatchObject({ status: "incomplete", completedCells: 1,
      missing: [{ businessDate: "2026-09-22", spotId: 2, reason: "missing_run" }],
      metrics: null, days: null });
    const invalid = buildFoodcostOverview("2026-09-22", "2026-09-22", [1], [
      run({ methodology_version: "unknown" }),
    ]);
    expect(invalid).toMatchObject({ status: "incomplete", completedCells: 0,
      missing: [{ reason: "invalid_run" }], metrics: null });
  });

  it("selects the latest completed version, ignoring a newer failed run", () => {
    const result = buildFoodcostOverview("2026-09-22", "2026-09-22", [1], [
      run(),
      run({ id: "b", completed_at: "2026-09-24T02:00:00Z", payed_sum_minor: 20000 }),
      run({ id: "c", status: "failed", completed_at: "2026-09-24T03:00:00Z", payed_sum_minor: 99999 }),
    ]);
    expect(result.metrics?.payedSumMinor).toBe(20000);
  });

  it("keeps unknown netto unavailable, rather than zero", () => {
    const result = buildFoodcostOverview("2026-09-22", "2026-09-22", [1], [
      run({ product_profit_netto_minor: null }),
    ]);
    expect(result.status).toBe("complete");
    expect(result.metrics?.nettoFoodCostPercent).toBeNull();
  });

  it("rejects malformed or oversized scope before opening the database", async () => {
    expect(() => buildFoodcostOverview("2026-02-30", "2026-03-01", [1], [])).toThrow("invalid_foodcost_period");
    expect(() => buildFoodcostOverview("2026-09-23", "2026-09-22", [1], [])).toThrow("invalid_foodcost_period");
    expect(() => buildFoodcostOverview("2026-08-01", "2026-09-01", [1], [])).toThrow("foodcost_period_too_long");
    await expect(loadFoodcostOverview("2026-09-22", "2026-09-23", [1, 1]))
      .rejects.toThrow("invalid_foodcost_spots");
    expect(mocked.getServerSupabase).not.toHaveBeenCalled();
  });

  it("loads only run-level aggregates with a fixed upper completion bound", async () => {
    const calls: string[] = [];
    const chain = {
      gte: () => { calls.push("gte"); return chain; },
      lte: () => { calls.push("lte"); return chain; },
      in: () => { calls.push("in"); return chain; },
      eq: () => { calls.push("eq"); return chain; },
      order: () => chain,
      range: async () => ({ data: [run()], error: null }),
    };
    const from = vi.fn((_table: string) => ({ select: () => chain }));
    mocked.getServerSupabase.mockReturnValue({ from });
    const result = await loadFoodcostOverview("2026-09-22", "2026-09-22", [1]);
    expect(result.status).toBe("complete");
    expect(from).toHaveBeenCalledWith("foodcost_sales_runs");
    expect(calls).toContain("gte");
    expect(calls.filter((value) => value === "lte")).toHaveLength(2);
  });
});

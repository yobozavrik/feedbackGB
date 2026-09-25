import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ getServerSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));

import { loadFoodcostSalesDay, loadFoodcostSalesPeriod } from "../foodcostSalesRead";

function query(rows: unknown[]) {
  const chain = {
    eq: () => chain, in: () => chain, lte: () => chain, order: () => chain,
    range: async () => ({ data: rows, error: null }),
  };
  return { select: () => chain };
}

describe("bounded read-only foodcost loader", () => {
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    mocked.getServerSupabase.mockReset();
  });
  afterEach(() => {
    if (previousService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
  });

  it("rejects malformed dates, duplicate spots, and an unbounded spot list", async () => {
    await expect(loadFoodcostSalesDay("2026-02-30", [1])).rejects.toThrow("invalid_sales_read_scope");
    await expect(loadFoodcostSalesDay("2026-09-23", [1, 1])).rejects.toThrow("invalid_sales_read_scope");
    await expect(loadFoodcostSalesDay("2026-09-23", Array.from({ length: 101 }, (_, i) => i + 1)))
      .rejects.toThrow("invalid_sales_read_scope");
    await expect(loadFoodcostSalesPeriod(["2026-09-22", "2026-09-22"], [1]))
      .rejects.toThrow("invalid_sales_read_scope");
    await expect(loadFoodcostSalesPeriod(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"], [1]))
      .rejects.toThrow("invalid_sales_read_scope");
    expect(mocked.getServerSupabase).not.toHaveBeenCalled();
  });

  it("returns incomplete coverage when no completed run exists without reading facts", async () => {
    const from = vi.fn((table: string) => {
      if (table !== "foodcost_sales_runs") throw new Error("unexpected_fact_read");
      return query([]);
    });
    mocked.getServerSupabase.mockReturnValue({ from });
    const result = await loadFoodcostSalesDay("2026-09-23", [1, 2]);
    expect(result).toMatchObject({ status: "incomplete", expectedCells: 2, completedCells: 0,
      metrics: null, missing: [
        { businessDate: "2026-09-23", spotId: 1, reason: "missing_run" },
        { businessDate: "2026-09-23", spotId: 2, reason: "missing_run" },
      ] });
    expect(from).toHaveBeenCalledOnce();
  });

  it("reads only latest completed facts and recomputes the two methods", async () => {
    const from = vi.fn((table: string) => {
      if (table === "foodcost_sales_runs") return query([{
        id: "run-1", business_date: "2026-09-23", spot_id: 1, status: "completed",
        completed_at: "2026-09-24T01:00:00Z", source_fetched_at: "2026-09-24T00:59:00Z",
        source_row_count: 1, payed_sum_minor: "10000", product_profit_minor: "6000",
        product_profit_netto_minor: "6500",
      }]);
      if (table === "foodcost_sales_facts") return query([{
        run_id: "run-1", source_row_no: 0, product_id: 121, modification_id: 0,
        category_id_snapshot: 7, product_name_snapshot: "Пельмені зі свинини",
        quantity: "1.5", unit: "kg", weight_based: true,
        payed_sum_minor: "10000", product_profit_minor: "6000", product_profit_netto_minor: "6500",
        product_sum_minor: "10000", bonus_sum_minor: "0", cert_sum_minor: "0", discount_minor: "0",
      }]);
      throw new Error("unexpected_table");
    });
    mocked.getServerSupabase.mockReturnValue({ from });
    const result = await loadFoodcostSalesDay("2026-09-23", [1]);
    expect(result).toMatchObject({ status: "complete", completedCells: 1 });
    expect(result.metrics?.foodCostPercent).toBe(40);
    expect(result.metrics?.nettoFoodCostPercent).toBe(35);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("keeps one latest run per date and spot across the rolling window", async () => {
    const run = (id: string, date: string, paid: string, profit: string, completed: string) => ({
      id, business_date: date, spot_id: 1, status: "completed", completed_at: completed,
      source_fetched_at: completed, source_row_count: 1, payed_sum_minor: paid,
      product_profit_minor: profit, product_profit_netto_minor: profit,
    });
    const fact = (runId: string, paid: string, profit: string) => ({
      run_id: runId, source_row_no: 0, product_id: 121, modification_id: 0,
      category_id_snapshot: 7, product_name_snapshot: "Пельмені зі свинини",
      quantity: "1", unit: "kg", weight_based: true,
      payed_sum_minor: paid, product_profit_minor: profit, product_profit_netto_minor: profit,
      product_sum_minor: paid, bonus_sum_minor: "0", cert_sum_minor: "0", discount_minor: "0",
    });
    const from = vi.fn((table: string) => table === "foodcost_sales_runs"
      ? query([run("new", "2026-09-24", "10000", "6000", "2026-09-25T01:00:00Z"),
        run("old", "2026-09-24", "9000", "5000", "2026-09-24T23:00:00Z"),
        run("prior", "2026-09-23", "20000", "12000", "2026-09-24T01:00:00Z")])
      : query([fact("new", "10000", "6000"), fact("prior", "20000", "12000")]));
    mocked.getServerSupabase.mockReturnValue({ from });
    const result = await loadFoodcostSalesPeriod(["2026-09-23", "2026-09-24"], [1]);
    expect(result).toMatchObject({ status: "complete", expectedCells: 2, completedCells: 2 });
    expect(result.metrics?.payedSumMinor).toBe(30000);
    expect(result.categories?.[0].payedSumMinor).toBe(30000);
    expect(result.products?.[0].payedSumMinor).toBe(30000);
  });
});

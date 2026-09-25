import { describe, expect, it } from "vitest";
import { buildFoodcostSalesReadModel, type SalesFactRead, type SalesRunRead } from "../foodcostSalesReadModel";

const date = "2026-09-23";
function run(overrides: Partial<SalesRunRead> = {}): SalesRunRead {
  return {
    id: "run-1", business_date: date, spot_id: 1, status: "completed",
    completed_at: "2026-09-24T01:00:00Z", source_fetched_at: "2026-09-24T00:59:00Z",
    source_row_count: 1, payed_sum_minor: 10000, product_profit_minor: 6000,
    product_profit_netto_minor: 6500, ...overrides,
  };
}
function fact(overrides: Partial<SalesFactRead> = {}): SalesFactRead {
  return {
    run_id: "run-1", source_row_no: 0, product_id: 121, modification_id: 0,
    category_id_snapshot: 7, category_name_snapshot: "Напівфабрикати",
    product_name_snapshot: "Пельмені зі свинини",
    quantity: "1.5", unit: "kg", weight_based: true,
    payed_sum_minor: 10000, product_profit_minor: 6000, product_profit_netto_minor: 6500,
    product_sum_minor: 10000, bonus_sum_minor: 0, cert_sum_minor: 0, discount_minor: 0,
    ...overrides,
  };
}

describe("foodcost snapshot read model", () => {
  it("recomputes both rates from money sums across spots, not an average of rates", () => {
    const result = buildFoodcostSalesReadModel([date], [1, 2], [
      run(), run({ id: "run-2", spot_id: 2, payed_sum_minor: 30000, product_profit_minor: 24000,
        product_profit_netto_minor: 25000, source_fetched_at: "2026-09-24T02:00:00Z" }),
    ], [fact(), fact({ run_id: "run-2", payed_sum_minor: 30000,
      product_profit_minor: 24000, product_profit_netto_minor: 25000 })]);
    expect(result).toMatchObject({ status: "complete", expectedCells: 2, completedCells: 2,
      sourceFetchedAt: "2026-09-24T00:59:00Z" });
    expect(result.metrics?.payedSumMinor).toBe(40000);
    expect(result.metrics?.foodCostPercent).toBe(25);
    expect(result.metrics?.nettoFoodCostPercent).toBe(21.25);
    expect(result.categories?.[0].payedSumMinor).toBe(40000);
    expect(result.categories?.[0]).toMatchObject({ categoryName: "Напівфабрикати",
      categoryNameConflict: false });
    expect(result.products?.[0].payedSumMinor).toBe(40000);
  });

  it("never presents partial network metrics when a spot is missing", () => {
    const result = buildFoodcostSalesReadModel([date], [1, 2], [run()], [fact()]);
    expect(result).toMatchObject({ status: "incomplete", completedCells: 1,
      missing: [{ businessDate: date, spotId: 2, reason: "missing_run" }],
      metrics: null, categories: null, products: null });
  });

  it("selects the latest completed version and ignores running/failed runs", () => {
    const result = buildFoodcostSalesReadModel([date], [1], [
      run(), run({ id: "run-2", completed_at: "2026-09-24T03:00:00Z",
        payed_sum_minor: 12000, product_profit_minor: 7000, product_profit_netto_minor: 7500 }),
      run({ id: "run-3", status: "running", completed_at: null, payed_sum_minor: 99999 }),
    ], [fact(), fact({ run_id: "run-2", payed_sum_minor: 12000,
      product_profit_minor: 7000, product_profit_netto_minor: 7500 })]);
    expect(result.metrics?.payedSumMinor).toBe(12000);
    expect(result.metrics?.foodCostPercent).toBeCloseTo(5000 / 12000 * 100);
  });

  it("treats an inconsistent completed run as unavailable, not zero", () => {
    const result = buildFoodcostSalesReadModel([date], [1], [run({ source_row_count: 2 })], [fact()]);
    expect(result).toMatchObject({ status: "incomplete", completedCells: 0,
      missing: [{ businessDate: date, spotId: 1, reason: "invalid_run" }], metrics: null });
  });

  it("preserves unknown netto as null at every aggregation level", () => {
    const result = buildFoodcostSalesReadModel([date], [1], [
      run({ product_profit_netto_minor: null }),
    ], [fact({ product_profit_netto_minor: null })]);
    expect(result.status).toBe("complete");
    expect(result.metrics?.nettoFoodCostPercent).toBeNull();
    expect(result.categories?.[0].nettoFoodCostPercent).toBeNull();
    expect(result.products?.[0].nettoFoodCostPercent).toBeNull();
  });

  it("does not invent one category name when snapshots disagree", () => {
    const result = buildFoodcostSalesReadModel([date], [1, 2], [run(),
      run({ id: "run-2", spot_id: 2, payed_sum_minor: 10000, product_profit_minor: 6000,
        product_profit_netto_minor: 6500 })], [fact(),
      fact({ run_id: "run-2", category_name_snapshot: "Інша назва" })]);
    expect(result.categories?.[0]).toMatchObject({ categoryId: 7,
      categoryName: null, categoryNameConflict: true });
  });

  it("rejects duplicate requested dates or spots", () => {
    expect(() => buildFoodcostSalesReadModel([date, date], [1], [], [])).toThrow("invalid_sales_scope");
    expect(() => buildFoodcostSalesReadModel([date], [1, 1], [], [])).toThrow("invalid_sales_scope");
  });
});

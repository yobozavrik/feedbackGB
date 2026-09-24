import { describe, expect, it } from "vitest";
import { buildFoodcostSalesSnapshot } from "../foodcostSalesSnapshot";

function row(overrides: Record<string, unknown> = {}) {
  return {
    product_id: "121", modification_id: "0", category_id: "7",
    product_name: "Пельмені зі свинини", category_name: "Напівфабрикати",
    weight_flag: "1", unit: "kg", count: "1.5000000",
    payed_sum: "30000", product_profit: "18000", product_profit_netto: "19000",
    product_sum: "31000", bonus_sum: "1000", cert_sum: "0", discount: "0",
    ...overrides,
  };
}

describe("foodcost sales snapshot preparation", () => {
  it("preserves every Poster row, including modifiers of the same product", () => {
    const result = buildFoodcostSalesSnapshot([
      row(), row({ modification_id: "2", count: "0.5000000", payed_sum: "10000", product_profit: "6000", product_profit_netto: "6500" }),
    ]);
    expect(result).toMatchObject({
      sourceRowCount: 2, payedSumMinor: 40000,
      productProfitMinor: 24000, productProfitNettoMinor: 25500,
    });
    expect(result.facts.map((fact) => [fact.source_row_no, fact.modification_id, fact.quantity]))
      .toEqual([[0, 0, "1.5"], [1, 2, "0.5"]]);
  });

  it("keeps missing netto profit and missing category name as null", () => {
    const raw = row({ category_name: " ", product_profit_netto: undefined });
    const result = buildFoodcostSalesSnapshot([raw]);
    expect(result.productProfitNettoMinor).toBeNull();
    expect(result.facts[0].product_profit_netto_minor).toBeNull();
    expect(result.facts[0].category_name_snapshot).toBeNull();
  });

  it("does not silently drop a malformed row", () => {
    expect(() => buildFoodcostSalesSnapshot([row(), row({ count: "NaN" })])).toThrow("invalid_count");
  });

  it("rejects a non-array response and accepts a valid empty day", () => {
    expect(() => buildFoodcostSalesSnapshot({ response: [] })).toThrow("invalid_sales_response");
    expect(buildFoodcostSalesSnapshot([])).toMatchObject({ sourceRowCount: 0, facts: [], payedSumMinor: 0 });
  });

  it("retains signed return values and piece quantities without changing unit", () => {
    const result = buildFoodcostSalesSnapshot([row({
      product_id: "186", weight_flag: "0", unit: "p", count: "-2.0000000",
      payed_sum: "-1000", product_profit: "-600", product_profit_netto: "-650",
    })]);
    expect(result.facts[0]).toMatchObject({ quantity: "-2", weight_based: false, unit: "p", payed_sum_minor: -1000 });
  });
});

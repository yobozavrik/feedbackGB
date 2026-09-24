import { describe, expect, it } from "vitest";
import { sameFoodcostSalesFacts } from "../foodcostSalesFactsEqual";
import type { FoodcostSalesFactInsert } from "../foodcostSalesSnapshot";

function fact(overrides: Partial<FoodcostSalesFactInsert> = {}): FoodcostSalesFactInsert {
  return {
    source_row_no: 0, product_id: 121, modification_id: 0,
    category_id_snapshot: 7, product_name_snapshot: "Пельмені зі свинини",
    category_name_snapshot: "Напівфабрикати", quantity: "1.5000000", unit: "kg",
    weight_based: true, payed_sum_minor: 10000, product_profit_minor: 6000,
    product_profit_netto_minor: 6500, product_sum_minor: 10000,
    bonus_sum_minor: 0, cert_sum_minor: 0, discount_minor: 0, ...overrides,
  };
}

describe("foodcost sales snapshot equivalence", () => {
  it("ignores source order and numeric serialization without losing duplicate rows", () => {
    const first = fact();
    const second = fact({ source_row_no: 1, modification_id: 2, quantity: "0.25" });
    const stored = [
      { ...second, source_row_no: 0, quantity: "0.2500000", payed_sum_minor: "10000" },
      { ...first, source_row_no: 1, quantity: "1.5000000", product_profit_minor: "6000" },
    ];
    expect(sameFoodcostSalesFacts([first, second], stored)).toBe(true);
    expect(sameFoodcostSalesFacts([first, first], stored)).toBe(false);
  });

  it("detects a changed row even if row count and the aggregate sum are unchanged", () => {
    const source = [fact({ payed_sum_minor: 9000 }), fact({ source_row_no: 1, payed_sum_minor: 11000 })];
    const stored = [fact({ payed_sum_minor: 10000 }), fact({ source_row_no: 1, payed_sum_minor: 10000 })];
    expect(sameFoodcostSalesFacts(source, stored)).toBe(false);
  });

  it("does not equate missing netto with zero or malformed database values", () => {
    expect(sameFoodcostSalesFacts([fact({ product_profit_netto_minor: null })],
      [fact({ product_profit_netto_minor: 0 })])).toBe(false);
    expect(sameFoodcostSalesFacts([fact()], [fact({ quantity: "invalid" })])).toBe(false);
  });
});

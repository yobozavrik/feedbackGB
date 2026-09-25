import { describe, expect, it } from "vitest";
import { compareProductPeriods, groupCategorySales, groupProductSales, parsePosterSalesRow, salesMetrics } from "../posterSalesMath";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    product_id: "121", modification_id: "0", category_id: "7",
    product_name: "Пельмені зі свинини", weight_flag: "1", unit: "kg",
    count: "1.0000000", payed_sum: "19000", product_profit: "11000", product_profit_netto: "11500",
    product_sum: "19000", bonus_sum: "0", cert_sum: "0", discount: "0",
    ...overrides,
  };
}

describe("Poster sales parsing", () => {
  it("keeps money in integer minor units and quantity at seven decimals", () => {
    expect(parsePosterSalesRow(raw({ count: "151.3010000" }))).toMatchObject({
      productId: 121, modificationId: 0, payedSumMinor: 19000,
      productProfitMinor: 11000, productProfitNettoMinor: 11500,
      quantity: "151.301", weightBased: true,
    });
  });

  it("retains a negative discount instead of clamping it", () => {
    expect(parsePosterSalesRow(raw({ discount: "-43" })).discountMinor).toBe(-43);
  });

  it("accepts signed profit and return-like negative amounts", () => {
    expect(parsePosterSalesRow(raw({ payed_sum: "-100", product_profit: "-150" })))
      .toMatchObject({ payedSumMinor: -100, productProfitMinor: -150 });
  });

  it("keeps missing optional bonus fields null instead of fabricated zero", () => {
    const row = raw();
    delete (row as Partial<typeof row>).bonus_sum;
    expect(parsePosterSalesRow(row).bonusSumMinor).toBeNull();
  });

  it("keeps missing netto profit null instead of treating it as zero", () => {
    const row = raw();
    delete (row as Partial<typeof row>).product_profit_netto;
    expect(parsePosterSalesRow(row).productProfitNettoMinor).toBeNull();
  });

  it("rejects malformed or over-precise quantities", () => {
    expect(() => parsePosterSalesRow(raw({ count: "1.00000001" }))).toThrow("invalid_count");
    expect(() => parsePosterSalesRow(raw({ count: "NaN" }))).toThrow("invalid_count");
  });

  it("rejects malformed identities, money and weight flag", () => {
    expect(() => parsePosterSalesRow(raw({ product_id: "0" }))).toThrow("invalid_sales_identity");
    expect(() => parsePosterSalesRow(raw({ payed_sum: "12.5" }))).toThrow("invalid_payed_sum");
    expect(() => parsePosterSalesRow(raw({ weight_flag: "3" }))).toThrow("invalid_weight_flag");
  });

  it("accepts a piece product without treating its count as kg", () => {
    expect(parsePosterSalesRow(raw({ product_id: "186", unit: "p", weight_flag: "0", count: "503.0000000" })))
      .toMatchObject({ productId: 186, quantity: "503", unit: "p", weightBased: false });
  });
});

describe("Poster sales aggregation", () => {
  it("sums all modifiers of one product rather than keeping the last row", () => {
    const products = groupProductSales([
      parsePosterSalesRow(raw({ modification_id: "1", payed_sum: "10000", product_profit: "6000" })),
      parsePosterSalesRow(raw({ modification_id: "2", payed_sum: "5000", product_profit: "2000" })),
    ]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ rows: 2, modificationIds: [1, 2],
      payedSumMinor: 15000, productProfitMinor: 8000, inferredCostMinor: 7000,
      quantity: "2" });
  });

  it("does not lose repeated rows with the same product and modifier", () => {
    const products = groupProductSales([parsePosterSalesRow(raw()), parsePosterSalesRow(raw())]);
    expect(products[0]).toMatchObject({ rows: 2, payedSumMinor: 38000, quantity: "2" });
  });

  it("adds decimal quantities exactly", () => {
    const products = groupProductSales([
      parsePosterSalesRow(raw({ count: "0.1000001" })),
      parsePosterSalesRow(raw({ count: "0.2000002" })),
    ]);
    expect(products[0].quantity).toBe("0.3000003");
  });

  it("does not add kg and pieces into one displayed quantity", () => {
    const products = groupProductSales([
      parsePosterSalesRow(raw()),
      parsePosterSalesRow(raw({ modification_id: "2", unit: "p", weight_flag: "0" })),
    ]);
    expect(products[0]).toMatchObject({ unitConflict: true, quantity: null, unit: null, weightBased: null });
    expect(products[0].payedSumMinor).toBe(38000);
  });

  it("marks conflicting category snapshots instead of picking one silently", () => {
    const products = groupProductSales([
      parsePosterSalesRow(raw()), parsePosterSalesRow(raw({ modification_id: "2", category_id: "8" })),
    ]);
    expect(products[0]).toMatchObject({ categoryConflict: true, categoryId: null });
  });

  it("marks a renamed product without changing its summed money", () => {
    const products = groupProductSales([
      parsePosterSalesRow(raw()),
      parsePosterSalesRow(raw({ product_name: "Нова назва", payed_sum: "1000", product_profit: "500" })),
    ]);
    expect(products[0]).toMatchObject({ productId: 121, productNameConflict: true,
      payedSumMinor: 20000, productProfitMinor: 11500 });
  });

  it("calculates network food cost from summed money, not mean of percentages", () => {
    const rows = [
      parsePosterSalesRow(raw({ payed_sum: "10000", product_profit: "5000", product_profit_netto: "5500" })),
      parsePosterSalesRow(raw({ product_id: "122", payed_sum: "90000", product_profit: "72000", product_profit_netto: "73000" })),
    ];
    expect(salesMetrics(rows)).toMatchObject({ payedSumMinor: 100000, inferredCostMinor: 23000,
      foodCostPercent: 23, productProfitNettoMinor: 78500,
      nettoInferredCostMinor: 21500, nettoFoodCostPercent: 21.5 });
  });

  it("does not publish a partial netto total when one row has no netto profit", () => {
    const rows = [parsePosterSalesRow(raw()), parsePosterSalesRow(raw({ product_id: "122", product_profit_netto: null }))];
    expect(salesMetrics(rows)).toMatchObject({ payedSumMinor: 38000, productProfitNettoMinor: null,
      nettoInferredCostMinor: null, nettoFoodCostPercent: null });
  });

  it("aggregates both methodologies by category without averaging percentages", () => {
    const categories = groupCategorySales([
      parsePosterSalesRow(raw({ payed_sum: "10000", product_profit: "5000", product_profit_netto: "5500" })),
      parsePosterSalesRow(raw({ product_id: "122", payed_sum: "90000", product_profit: "72000", product_profit_netto: "73000" })),
      parsePosterSalesRow(raw({ product_id: "186", category_id: "8", payed_sum: "5000", product_profit: "2000", product_profit_netto: "2200" })),
    ]);
    expect(categories).toHaveLength(2);
    expect(categories[0]).toMatchObject({ categoryId: 7, distinctProducts: 2, payedSumMinor: 100000,
      foodCostPercent: 23, nettoFoodCostPercent: 21.5 });
  });

  it("returns unavailable percentage for zero or negative paid revenue", () => {
    expect(salesMetrics([]).foodCostPercent).toBeNull();
    expect(salesMetrics([{ payedSumMinor: -100, productProfitMinor: -50 }]).foodCostPercent).toBeNull();
  });

  it("keeps a cost over 100% visible for a loss-making product", () => {
    expect(salesMetrics([{ payedSumMinor: 100, productProfitMinor: -20 }]).foodCostPercent).toBe(120);
  });

  it("rejects unsafe accumulated money totals", () => {
    expect(() => salesMetrics([{ payedSumMinor: Number.MAX_SAFE_INTEGER, productProfitMinor: 0 },
      { payedSumMinor: 1, productProfitMinor: 0 }])).toThrow("sales_total_overflow");
  });
});

describe("Poster sales period comparison", () => {
  it("keeps both current-only and previous-only products", () => {
    const current = groupProductSales([parsePosterSalesRow(raw({ product_id: "1" }))]);
    const previous = groupProductSales([parsePosterSalesRow(raw({ product_id: "2" }))]);
    expect(compareProductPeriods(current, previous)).toMatchObject([
      { productId: 1, previous: null, foodCostDeltaPoints: null },
      { productId: 2, current: null, foodCostDeltaPoints: null },
    ]);
  });

  it("computes percentage-point change only for two valid ratios", () => {
    const current = groupProductSales([parsePosterSalesRow(raw({ payed_sum: "100", product_profit: "60" }))]);
    const previous = groupProductSales([parsePosterSalesRow(raw({ payed_sum: "100", product_profit: "70" }))]);
    expect(compareProductPeriods(current, previous)[0].foodCostDeltaPoints).toBe(10);
  });

  it("does not invent a comparison when previous revenue is zero", () => {
    const current = groupProductSales([parsePosterSalesRow(raw())]);
    const previous = groupProductSales([parsePosterSalesRow(raw({ payed_sum: "0", product_profit: "0" }))]);
    expect(compareProductPeriods(current, previous)[0].foodCostDeltaPoints).toBeNull();
  });

  it("computes separate gross and netto percentage-point changes", () => {
    const current = groupProductSales([parsePosterSalesRow(raw({ payed_sum: "100", product_profit: "60", product_profit_netto: "65" }))]);
    const previous = groupProductSales([parsePosterSalesRow(raw({ payed_sum: "100", product_profit: "70", product_profit_netto: "80" }))]);
    expect(compareProductPeriods(current, previous)[0]).toMatchObject({ foodCostDeltaPoints: 10, nettoFoodCostDeltaPoints: 15 });
  });
});

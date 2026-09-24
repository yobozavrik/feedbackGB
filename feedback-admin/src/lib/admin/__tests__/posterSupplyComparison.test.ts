import { describe, expect, it } from "vitest";
import type { FoodCostSample } from "../posterFoodCost";
import { compareSupplyCosts } from "../posterSupplyComparison";
import type { SupplyAverage } from "../posterSupplyCostMath";

const sample: FoodCostSample = {
  checkedAt: "2026-09-24T08:00:00Z", productId: 121, productName: "Пельмені зі свинини",
  currencyCode: "UAH", currencySymbol: "₴", unit: "kg", weightBased: true,
  priceBasis: "100g", recipeOutput: 1000, costMinor: 801,
  ingredientTotalMinor: 7768, stores: [],
  ingredients: [
    { key: "salt", ingredientId: 76, name: "Сіль", kind: "ingredient", brutto: 5, unit: "g", costMinor: 7 },
    { key: "dough", ingredientId: 37, name: "Тісто", kind: "prepack", brutto: 520, unit: "g", costMinor: 849 },
  ],
  prepacks: [{ productId: 37, outputWeight: 1001, posterCostMinor: 1634, ingredients: [
    { key: "flour", ingredientId: 25, name: "Борошно", kind: "ingredient", brutto: 700, unit: "g", costMinor: 1373 },
    { key: "water", ingredientId: 93, name: "Вода", kind: "ingredient", brutto: 360, unit: "ml", costMinor: 197 },
  ] }],
};
const averages: SupplyAverage[] = [
  { ingredientId: 76, unit: "kg", totalQuantity: 10, totalSumMinor: 14000, supplyCount: 2 },
  { ingredientId: 25, unit: "kg", totalQuantity: 100, totalSumMinor: 200000, supplyCount: 5 },
  { ingredientId: 93, unit: "l", totalQuantity: 20, totalSumMinor: 10000, supplyCount: 3 },
];
const meta = { windowFrom: "2026-08-26", windowTo: "2026-09-24", completedAt: "2026-09-24T08:00:00Z", supplyDocuments: 751 };

describe("30-day supply comparison", () => {
  it("prices direct ingredients and a prepack from its ingredients", () => {
    const result = compareSupplyCosts(sample, averages, meta);
    expect(result.rows.salt.costMinor).toBe(7);
    expect(result.rows.dough.costMinor).toBeCloseTo((1400 + 180) * 520 / 1001, 6);
    expect(result.totalMinor).toBeCloseTo(7 + (1400 + 180) * 520 / 1001, 6);
    expect(result.missingRows).toBe(0);
  });

  it("does not create a misleading total when a required ingredient has no supplies", () => {
    const result = compareSupplyCosts(sample, averages.filter((row) => row.ingredientId !== 93), meta);
    expect(result.rows.salt.costMinor).toBe(7);
    expect(result.rows.dough.costMinor).toBeNull();
    expect(result.totalMinor).toBeNull();
    expect(result.missingRows).toBe(1);
  });

  it("does not match a prepack product id to a raw ingredient id", () => {
    const result = compareSupplyCosts(sample, [
      ...averages, { ingredientId: 37, unit: "kg", totalQuantity: 10, totalSumMinor: 1, supplyCount: 1 },
    ], meta);
    expect(result.rows.dough.costMinor).toBeCloseTo((1400 + 180) * 520 / 1001, 6);
  });

  it("does not infer prepack output units when Poster row pricing fails the ratio check", () => {
    const changed = { ...sample, prepacks: [{ ...sample.prepacks[0], outputWeight: 100 }] };
    const result = compareSupplyCosts(changed, averages, meta);
    expect(result.rows.dough.costMinor).toBeNull();
    expect(result.totalMinor).toBeNull();
  });
});

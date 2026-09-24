import { describe, expect, it } from "vitest";
import {
  aggregateSupplyLines, costFromSupplyAverage, kyivSupplyWindow,
  parseSupplyLines, recipeQuantityInSupplyUnit,
} from "../posterSupplyCostMath";

describe("Poster supply cost math", () => {
  it("uses 30 inclusive Kyiv calendar dates", () => {
    expect(kyivSupplyWindow(new Date("2026-09-24T08:00:00Z")))
      .toEqual({ from: "2026-08-26", to: "2026-09-24" });
  });

  it("rolls over the local date instead of UTC date", () => {
    expect(kyivSupplyWindow(new Date("2026-09-23T22:00:00Z")).to)
      .toBe("2026-09-24");
  });

  it("parses quantity and kopeck amount without treating price as a per-unit value", () => {
    expect(parseSupplyLines([{ ingredient_id: "56", ingredient_unit: "kg", supply_ingredient_num: "2.5", supply_ingredient_sum: "50000" }]))
      .toEqual([{ ingredientId: 56, unit: "kg", quantity: 2.5, sumMinor: 50000 }]);
  });

  it("rejects zero or invalid quantities and unknown units", () => {
    expect(() => parseSupplyLines([{ ingredient_id: 56, ingredient_unit: "kg", supply_ingredient_num: 0, supply_ingredient_sum: 50 }])).toThrow();
    expect(() => parseSupplyLines([{ ingredient_id: 56, ingredient_unit: "g", supply_ingredient_num: 1, supply_ingredient_sum: 50 }])).toThrow();
  });

  it("weights by quantities, not a simple average of invoice unit prices", () => {
    const averages = aggregateSupplyLines([
      [{ ingredientId: 56, unit: "kg", quantity: 10, sumMinor: 100000 }],
      [{ ingredientId: 56, unit: "kg", quantity: 5, sumMinor: 100000 }],
    ]);
    expect(averages).toEqual([{ ingredientId: 56, unit: "kg", totalQuantity: 15, totalSumMinor: 200000, supplyCount: 2 }]);
    expect(costFromSupplyAverage({ brutto: 350, unit: "g" }, averages[0])).toBeCloseTo(4666.666667, 4);
  });

  it("counts one document once for duplicate lines of the same ingredient", () => {
    expect(aggregateSupplyLines([[
      { ingredientId: 1, unit: "p", quantity: 1, sumMinor: 100 },
      { ingredientId: 1, unit: "p", quantity: 2, sumMinor: 200 },
    ]])[0]).toMatchObject({ totalQuantity: 3, totalSumMinor: 300, supplyCount: 1 });
  });

  it("converts g/kg and ml/l but never converts pieces to weight", () => {
    expect(recipeQuantityInSupplyUnit({ brutto: 520, unit: "g" }, "kg")).toBe(0.52);
    expect(recipeQuantityInSupplyUnit({ brutto: 8, unit: "ml" }, "l")).toBe(0.008);
    expect(recipeQuantityInSupplyUnit({ brutto: 1, unit: "p" }, "kg")).toBeNull();
    expect(recipeQuantityInSupplyUnit({ brutto: 1, unit: "p" }, "p")).toBe(1);
  });
});

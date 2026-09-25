import { describe, expect, it } from "vitest";
import { buildCommandCenterView } from "../foodcostCommandCenter";

type Recent = Parameters<typeof buildCommandCenterView>[0];

function completeRecent(): Recent {
  return {
    status: "complete", dateFrom: "2026-09-22", dateTo: "2026-09-24", spotCount: 2,
    expectedCells: 6, completedCells: 6, sourceFetchedAt: "2026-09-25T01:00:00Z",
    newestSourceFetchedAt: "2026-09-25T02:00:00Z",
    metrics: { payedSumMinor: 40000, productProfitMinor: 30000, productProfitNettoMinor: 32000,
      inferredCostMinor: 10000, nettoInferredCostMinor: 8000, foodCostPercent: 25,
      nettoFoodCostPercent: 20 },
    productsByDate: [
      { businessDate: "2026-09-24", products: [{ payedSumMinor: 30000,
        productProfitMinor: 24000, productProfitNettoMinor: 25500 }] },
      { businessDate: "2026-09-22", products: [{ payedSumMinor: 10000,
        productProfitMinor: 6000, productProfitNettoMinor: 6500 }] },
      { businessDate: "2026-09-23", products: [] },
    ],
    categories: [
      { categoryId: 2, displayName: "Б", payedSumMinor: 10000, foodCostPercent: 40, nettoFoodCostPercent: 35 },
      { categoryId: 1, displayName: "А", payedSumMinor: 30000, foodCostPercent: 20, nettoFoodCostPercent: 15 },
    ],
    products: [
      { productId: 121, productName: "Товар 121", payedSumMinor: 10000,
        foodCostPercent: 40, nettoFoodCostPercent: 35 },
      { productId: 122, productName: "Товар 122", payedSumMinor: 30000,
        foodCostPercent: 20, nettoFoodCostPercent: 15 },
    ],
  } as Recent;
}

describe("foodcost A1 command-center read model", () => {
  it("derives cards, days and ranked lists from the same complete snapshot", () => {
    const result = buildCommandCenterView(completeRecent(), new Set([121]));
    expect(result).toMatchObject({ status: "complete", expectedCells: 6, completedCells: 6,
      metrics: { payedSumMinor: 40000, foodCostPercent: 25, nettoFoodCostPercent: 20 } });
    expect(result.days?.map((day) => day.businessDate)).toEqual([
      "2026-09-22", "2026-09-23", "2026-09-24",
    ]);
    expect(result.days?.map((day) => day.metrics.foodCostPercent)).toEqual([40, null, 20]);
    expect(result.categories?.map((row) => row.categoryId)).toEqual([1, 2]);
    expect(result.products?.map((row) => row.productId)).toEqual([122, 121]);
    expect(result.products?.map((row) => row.currentCatalogPresent)).toEqual([false, true]);
  });

  it("fails closed for incomplete coverage without keeping misleading ranked rows", () => {
    const result = buildCommandCenterView({ ...completeRecent(), status: "incomplete",
      completedCells: 5 }, new Set([121]));
    expect(result).toMatchObject({ status: "incomplete", completedCells: 5, metrics: null,
      categories: null, products: null, days: null });
  });

  it("does not invent a netto result when a daily field is missing", () => {
    const recent = completeRecent();
    recent.productsByDate![0].products[0].productProfitNettoMinor = null;
    const result = buildCommandCenterView(recent, new Set());
    expect(result.days?.[2].metrics.nettoFoodCostPercent).toBeNull();
  });
});

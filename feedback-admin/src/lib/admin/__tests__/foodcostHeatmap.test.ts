import { describe, expect, it } from "vitest";
import { buildFoodcostHeatmap } from "../foodcostHeatmap";
import { foodcostBand } from "../foodcostBands";
import type { CategorySales, SalesMetrics } from "../posterSalesMath";

function category(categoryId: number | null, payedSumMinor: number, productProfitMinor: number,
  productProfitNettoMinor: number | null): CategorySales {
  return {
    categoryId, rows: 1, distinctProducts: 1, payedSumMinor, productProfitMinor,
    productProfitNettoMinor, inferredCostMinor: payedSumMinor - productProfitMinor,
    nettoInferredCostMinor: productProfitNettoMinor === null ? null : payedSumMinor - productProfitNettoMinor,
    foodCostPercent: payedSumMinor > 0 ? (payedSumMinor - productProfitMinor) / payedSumMinor * 100 : null,
    nettoFoodCostPercent: payedSumMinor > 0 && productProfitNettoMinor !== null
      ? (payedSumMinor - productProfitNettoMinor) / payedSumMinor * 100 : null,
  };
}

function dailyMetrics(payedSumMinor: number, productProfitMinor: number,
  productProfitNettoMinor: number | null): SalesMetrics {
  return {
    payedSumMinor, productProfitMinor, productProfitNettoMinor,
    inferredCostMinor: payedSumMinor - productProfitMinor,
    nettoInferredCostMinor: productProfitNettoMinor === null ? null : payedSumMinor - productProfitNettoMinor,
    foodCostPercent: payedSumMinor > 0 ? (payedSumMinor - productProfitMinor) / payedSumMinor * 100 : null,
    nettoFoodCostPercent: payedSumMinor > 0 && productProfitNettoMinor !== null
      ? (payedSumMinor - productProfitNettoMinor) / payedSumMinor * 100 : null,
  };
}

function dates(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
}

describe("foodcost category heatmap", () => {
  it("keeps 7/14-day windows as day bins and preserves N/A as a zero-sales denominator", () => {
    const allDates = dates("2026-09-14", 7);
    const rows = allDates.map((businessDate, index) => ({ businessDate,
      categories: index === 0 ? [category(23, 10000, 6500, 7000)] : [],
      productIdsByCategory: index === 0 ? [{ categoryId: 23, productIds: [230] }] : [] }));
    const totals = allDates.map((businessDate, index) => ({ businessDate,
      metrics: index === 0 ? dailyMetrics(10000, 6500, 7000) : dailyMetrics(0, 0, 0) }));
    const heatmap = buildFoodcostHeatmap({ dates: allDates, categoriesByDate: rows,
      categories: [{ categoryId: 23, displayName: "Піца", payedSumMinor: 10000, distinctProducts: 1 }],
      totalByDate: totals,
      productsByDate: allDates.map((businessDate, index) => ({ businessDate,
        products: index === 0 ? [{ productId: 230 }] as never : [] })), spotCount: 2 });

    expect(heatmap.bins).toHaveLength(7);
    expect(heatmap.bins.every((bin) => bin.kind === "day")).toBe(true);
    expect(heatmap.rows[0].cells[0]).toMatchObject({ foodCostPercent: 35, nettoFoodCostPercent: 30 });
    expect(heatmap.rows[0].cells[0]).toMatchObject({ distinctProducts: 1, completedCells: 2, expectedCells: 2 });
    expect(foodcostBand(heatmap.rows[0].cells[0].foodCostPercent)).toBe("yellow");
    expect(heatmap.rows[0].cells[1]).toMatchObject({ payedSumMinor: 0,
      foodCostPercent: null, nettoFoodCostPercent: null });
    expect(foodcostBand(heatmap.rows[0].cells[1].foodCostPercent)).toBe("unknown");
    expect(heatmap.total.cells[0].payedSumMinor).toBe(10000);
  });

  it("uses complete calendar weeks for 30/60-day windows and keeps partial edges as days", () => {
    const allDates = dates("2026-09-01", 30); // partial first/last weeks, three full calendar weeks
    const categoriesByDate = allDates.map((businessDate, index) => ({
      businessDate,
      categories: index >= 6 && index <= 12
        ? [category(23, index === 6 ? 100 : 200, index === 6 ? 65 : 180, index === 6 ? 70 : 170)]
        : [],
      productIdsByCategory: index >= 6 && index <= 12
        ? [{ categoryId: 23, productIds: [index === 6 ? 230 : 231] }]
        : [],
    }));
    const totalByDate = allDates.map((businessDate, index) => ({ businessDate,
      metrics: index >= 6 && index <= 12
        ? dailyMetrics(index === 6 ? 100 : 200, index === 6 ? 65 : 180, index === 6 ? 70 : 170)
        : dailyMetrics(0, 0, 0) }));
    const heatmap = buildFoodcostHeatmap({ dates: allDates, categoriesByDate,
      categories: [{ categoryId: 23, displayName: "Піца", payedSumMinor: 1300, distinctProducts: 2 }], totalByDate,
      productsByDate: allDates.map((businessDate, index) => ({ businessDate,
        products: index >= 6 && index <= 12 ? [{ productId: index === 6 ? 230 : 231 }] as never : [] })), spotCount: 1 });

    expect(heatmap.bins.filter((bin) => bin.kind === "week").map((bin) => [bin.from, bin.to])).toEqual([
      ["2026-09-07", "2026-09-13"], ["2026-09-14", "2026-09-20"], ["2026-09-21", "2026-09-27"],
    ]);
    expect(heatmap.bins[0]).toMatchObject({ kind: "day", from: "2026-09-01", to: "2026-09-01" });
    expect(heatmap.bins.at(-1)).toMatchObject({ kind: "day", from: "2026-09-30", to: "2026-09-30" });
    const week = heatmap.rows[0].cells.find((cell) => cell.binKey === "week:2026-09-07")!;
    expect(week.payedSumMinor).toBe(1300);
    expect(week.foodCostPercent).toBeCloseTo((1300 - (65 + 180 * 6)) / 1300 * 100);
    expect(week.foodCostPercent).not.toBeCloseTo((35 + 10 * 6) / 7); // not an average of daily rates
    expect(heatmap.total.cells.find((cell) => cell.binKey === "week:2026-09-07")?.payedSumMinor).toBe(1300);
    expect(heatmap.rows[0].cells.reduce((sum, cell) => sum + cell.payedSumMinor, 0)).toBe(1300);
    expect(heatmap.total.cells.reduce((sum, cell) => sum + cell.payedSumMinor, 0)).toBe(1300);
    expect(week.distinctProducts).toBe(2);
  });

  it("fails closed if any requested day has no category or network metrics", () => {
    expect(() => buildFoodcostHeatmap({ dates: ["2026-09-24", "2026-09-25"],
      categoriesByDate: [{ businessDate: "2026-09-24", categories: [], productIdsByCategory: [] }],
      categories: [], totalByDate: [], productsByDate: [], spotCount: 1 })).toThrow("incomplete_foodcost_heatmap_snapshot");
  });
});

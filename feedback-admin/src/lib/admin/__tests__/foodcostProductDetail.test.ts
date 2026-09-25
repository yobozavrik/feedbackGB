import { describe, expect, it } from "vitest";
import { buildFoodcostProductDetail } from "../foodcostProductDetail";
import { salesMetrics, type ProductSales } from "../posterSalesMath";
import type { loadFoodcostRecentBreakdown } from "../foodcostRecentNetwork";

type Breakdown = Awaited<ReturnType<typeof loadFoodcostRecentBreakdown>>;
function product(id: number, paid: number, profit: number): ProductSales {
  return { productId: id, productName: `Продукт ${id}`, productNameConflict: false,
    categoryId: 1, categoryConflict: false, unit: "kg", unitConflict: false,
    weightBased: true, quantity: "1", modificationIds: [0], rows: 1,
    ...salesMetrics([{ payedSumMinor: paid, productProfitMinor: profit,
      productProfitNettoMinor: profit }]) };
}
const complete = { scope: "current_poster_roster_three_closed_days",
  historicalRosterVerified: false, methodologyVersion: "poster-sales-dual-v1",
  dateFrom: "2026-09-22", dateTo: "2026-09-24", spotCount: 2, spotIds: [1, 2],
  status: "complete", expectedCells: 6, completedCells: 6, sourceFetchedAt: "2026-09-25T01:00:00Z",
  products: [product(121, 40000, 26000)],
  productsBySpot: [{ spotId: 1, products: [product(121, 10000, 6000)] },
    { spotId: 2, products: [product(121, 30000, 20000)] }],
  productsByDate: [{ businessDate: "2026-09-24", products: [product(121, 30000, 20000)] },
    { businessDate: "2026-09-23", products: [product(121, 10000, 6000)] },
    { businessDate: "2026-09-22", products: [] }],
} as unknown as Breakdown;
const names = new Map([[1, "Шкільна"], [2, "Роша"]]);

describe("foodcost product drill-down", () => {
  it("sums all spots and dates to the same product total", () => {
    const result = buildFoodcostProductDetail(complete, 121, names);
    expect(result.product?.fact?.payedSumMinor).toBe(40000);
    expect(result.stores?.map((row) => row.fact?.payedSumMinor)).toEqual([10000, 30000]);
    expect(result.days?.map((row) => row.fact?.payedSumMinor ?? null)).toEqual([30000, 10000, null]);
  });

  it("shows no sale as missing fact, not a 0% foodcost", () => {
    const result = buildFoodcostProductDetail(complete, 999, names);
    expect(result.product).toBeNull();
    expect(result.stores?.every((row) => row.fact === null)).toBe(true);
  });

  it("never presents a partial product breakdown", () => {
    const result = buildFoodcostProductDetail({ ...complete, status: "incomplete",
      products: null, productsBySpot: null, productsByDate: null } as Breakdown, 121, names);
    expect(result).toMatchObject({ status: "incomplete", product: null, stores: null, days: null });
  });

  it("rejects mismatched rosters or totals", () => {
    expect(() => buildFoodcostProductDetail(complete, 121, new Map([[1, "Шкільна"]])))
      .toThrow("foodcost_store_names_mismatch");
    const mismatch = { ...complete, products: [product(121, 40001, 26000)] } as Breakdown;
    expect(() => buildFoodcostProductDetail(mismatch, 121, names))
      .toThrow("foodcost_product_breakdown_mismatch");
    const profitMismatch = { ...complete, products: [product(121, 40000, 26001)] } as Breakdown;
    expect(() => buildFoodcostProductDetail(profitMismatch, 121, names))
      .toThrow("foodcost_product_breakdown_mismatch");
  });
});

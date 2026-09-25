import { describe, expect, it } from "vitest";
import { buildFoodcostProductPage, parseProductQuery } from "../foodcostProductPage";
import { salesMetrics, type ProductSales } from "../posterSalesMath";
import type { loadFoodcostRecentBreakdown } from "../foodcostRecentNetwork";

type Breakdown = Awaited<ReturnType<typeof loadFoodcostRecentBreakdown>>;
function product(id: number, name: string, categoryId: number | null, paid: number, profit: number): ProductSales {
  return { productId: id, productName: name, productNameConflict: false,
    categoryId, categoryConflict: false, unit: "p", unitConflict: false,
    weightBased: false, quantity: "1", modificationIds: [0], rows: 1,
    ...salesMetrics([{ payedSumMinor: paid, productProfitMinor: profit,
      productProfitNettoMinor: profit }]) };
}
const products = [product(1, "Пельмені", 6, 10000, 6000),
  product(2, "Вареники", 5, 90000, 72000), product(3, "Без категорії", null, 5000, 3000)];
const complete = {
  scope: "current_poster_roster_three_closed_days", historicalRosterVerified: false,
  methodologyVersion: "poster-sales-dual-v1", dateFrom: "2026-09-22", dateTo: "2026-09-24",
  spotCount: 26, status: "complete", expectedCells: 78, completedCells: 78, missing: [],
  sourceFetchedAt: "2026-09-25T06:00:00Z", metrics: salesMetrics(products), products,
  categories: [{ categoryId: 6, displayName: "Пельмені", nameSource: "current_poster_catalog" },
    { categoryId: 5, displayName: "Вареники", nameSource: "current_poster_catalog" }],
} as unknown as Breakdown;
const query = parseProductQuery(new URL("https://example.test/api"));

describe("foodcost product page", () => {
  it("validates query bounds before source reads", () => {
    for (const suffix of ["?page=0", "?pageSize=51", "?sort=random", "?categoryId=abc",
      `?q=${"x".repeat(81)}`]) {
      expect(() => parseProductQuery(new URL(`https://example.test/api${suffix}`)))
        .toThrow("invalid_foodcost_query");
    }
    expect(parseProductQuery(new URL("https://example.test/api?page=2&pageSize=10&categoryId=6&sort=name_asc&q=%D0%9F")))
      .toMatchObject({ page: 2, pageSize: 10, categoryId: 6, sort: "name_asc", q: "П" });
  });

  it("orders by paid money and paginates without duplicating products", () => {
    const first = buildFoodcostProductPage(complete, { ...query, pageSize: 2 });
    const second = buildFoodcostProductPage(complete, { ...query, pageSize: 2, page: 2 });
    expect(first.totalProducts).toBe(3);
    expect(first.products?.map((row) => row.productId)).toEqual([2, 1]);
    expect(second.products?.map((row) => row.productId)).toEqual([3]);
    expect(first.filteredMetrics?.payedSumMinor).toBe(105000);
    expect(first.filteredMetrics?.foodCostPercent).toBeCloseTo(24000 / 105000 * 100);
  });

  it("filters category and search before recomputing rates from sums", () => {
    const result = buildFoodcostProductPage(complete, { ...query, categoryId: 6, q: "пель" });
    expect(result).toMatchObject({ totalProducts: 1, products: [{ productId: 1 }] });
    expect(result.filteredMetrics?.foodCostPercent).toBe(40);
    const unknown = buildFoodcostProductPage(complete, { ...query, categoryId: "__unknown" });
    expect(unknown.products?.map((row) => row.productId)).toEqual([3]);
    const conflict = { ...complete, products: [{ ...products[0], categoryId: null, categoryConflict: true },
      products[1], products[2]] } as Breakdown;
    expect(buildFoodcostProductPage(conflict, { ...query, categoryId: "__conflict" }).products?.map((row) => row.productId)).toEqual([1]);
    expect(buildFoodcostProductPage(conflict, { ...query, categoryId: "__unknown" }).products?.map((row) => row.productId)).toEqual([3]);
  });

  it("keeps archived-in-sales rows visible and does not zero-fill empty filters", () => {
    const empty = buildFoodcostProductPage(complete, { ...query, q: "not-a-product" });
    expect(empty).toMatchObject({ totalProducts: 0, products: [], filteredMetrics: null });
  });

  it("never emits partial product metrics", () => {
    const incomplete = { ...complete, status: "incomplete", completedCells: 77,
      metrics: null, products: null, categories: null } as Breakdown;
    const result = buildFoodcostProductPage(incomplete, query);
    expect(result).toMatchObject({ status: "incomplete", totalProducts: null,
      filteredMetrics: null, products: null, categories: null });
  });
});

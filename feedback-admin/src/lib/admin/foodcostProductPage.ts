import { salesMetrics, type ProductSales } from "./posterSalesMath";
import type { loadFoodcostRecentBreakdown } from "./foodcostRecentNetwork";

type Breakdown = Awaited<ReturnType<typeof loadFoodcostRecentBreakdown>>;
export type ProductSort = "paid_desc" | "foodcost_desc" | "name_asc";
export type ProductQuery = {
  page: number;
  pageSize: number;
  q: string;
  categoryId: number | "__unknown" | "__conflict" | null;
  sort: ProductSort;
};

function positiveInt(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error("invalid_foodcost_query");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new Error("invalid_foodcost_query");
  return parsed;
}

export function parseProductQuery(url: URL): ProductQuery {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length > 80) throw new Error("invalid_foodcost_query");
  const rawCategory = url.searchParams.get("categoryId");
  const categoryId = rawCategory === null || rawCategory === "all" ? null
    : rawCategory === "__unknown" || rawCategory === "__conflict" ? rawCategory
      : positiveInt(rawCategory, 1, Number.MAX_SAFE_INTEGER);
  const sort = url.searchParams.get("sort") ?? "paid_desc";
  if (sort !== "paid_desc" && sort !== "foodcost_desc" && sort !== "name_asc") {
    throw new Error("invalid_foodcost_query");
  }
  return { page: positiveInt(url.searchParams.get("page"), 1, 1000),
    pageSize: positiveInt(url.searchParams.get("pageSize"), 25, 50), q, categoryId, sort };
}

function categoryMatches(row: ProductSales, categoryId: ProductQuery["categoryId"]): boolean {
  if (categoryId === null) return true;
  if (categoryId === "__conflict") return row.categoryConflict;
  if (categoryId === "__unknown") return !row.categoryConflict && row.categoryId === null;
  return row.categoryId === categoryId;
}

/** Search/filter before pagination; recompute filtered rates from money sums. */
export function buildFoodcostProductPage(data: Breakdown, query: ProductQuery) {
  const base = {
    scope: data.scope, historicalRosterVerified: data.historicalRosterVerified,
    methodologyVersion: data.methodologyVersion, dateFrom: data.dateFrom, dateTo: data.dateTo,
    spotCount: data.spotCount, status: data.status, expectedCells: data.expectedCells,
    completedCells: data.completedCells, missing: data.missing,
    sourceFetchedAt: data.sourceFetchedAt, query,
  };
  if (data.status !== "complete" || !data.products || !data.categories) return {
    ...base, totalProducts: null, filteredMetrics: null, products: null, categories: null,
  };
  const needle = query.q.toLocaleLowerCase("uk");
  const filtered = data.products.filter((row) => categoryMatches(row, query.categoryId) &&
    (!needle || row.productName.toLocaleLowerCase("uk").includes(needle) || String(row.productId) === needle));
  filtered.sort((a, b) => query.sort === "name_asc"
    ? a.productName.localeCompare(b.productName, "uk") || a.productId - b.productId
    : query.sort === "foodcost_desc"
      ? (b.foodCostPercent ?? -Infinity) - (a.foodCostPercent ?? -Infinity) || a.productId - b.productId
      : b.payedSumMinor - a.payedSumMinor || a.productId - b.productId);
  const start = (query.page - 1) * query.pageSize;
  return {
    ...base, totalProducts: filtered.length,
    filteredMetrics: filtered.length ? salesMetrics(filtered) : null,
    products: filtered.slice(start, start + query.pageSize),
    categories: data.categories.map((row) => ({ categoryId: row.categoryId,
      displayName: row.displayName, nameSource: row.nameSource })),
  };
}

import type { loadFoodcostRecentBreakdown } from "./foodcostRecentNetwork";
import type { ProductSales } from "./posterSalesMath";

type Breakdown = Awaited<ReturnType<typeof loadFoodcostRecentBreakdown>>;
export type ProductFact = Pick<ProductSales, "payedSumMinor" | "productProfitMinor" |
  "productProfitNettoMinor" | "foodCostPercent" | "nettoFoodCostPercent">;

function fact(row: ProductSales | undefined): ProductFact | null {
  if (!row) return null;
  return { payedSumMinor: row.payedSumMinor,
    productProfitMinor: row.productProfitMinor,
    productProfitNettoMinor: row.productProfitNettoMinor,
    foodCostPercent: row.foodCostPercent,
    nettoFoodCostPercent: row.nettoFoodCostPercent };
}

function matchesTotal(total: ProductFact | null, rows: readonly { fact: ProductFact | null }[]): boolean {
  const present = rows.map((row) => row.fact).filter((row): row is ProductFact => row !== null);
  if (!total) return present.length === 0;
  const paid = present.reduce((sum, row) => sum + row.payedSumMinor, 0);
  const profit = present.reduce((sum, row) => sum + row.productProfitMinor, 0);
  const netto = present.some((row) => row.productProfitNettoMinor === null) ? null :
    present.reduce((sum, row) => sum + (row.productProfitNettoMinor ?? 0), 0);
  return paid === total.payedSumMinor && profit === total.productProfitMinor &&
    netto === total.productProfitNettoMinor;
}

/** Product drill-down uses the same complete snapshot as the network totals. */
export function buildFoodcostProductDetail(data: Breakdown, productId: number,
  names: ReadonlyMap<number, string>) {
  const base = { scope: data.scope, historicalRosterVerified: data.historicalRosterVerified,
    methodologyVersion: data.methodologyVersion, dateFrom: data.dateFrom, dateTo: data.dateTo,
    spotCount: data.spotCount, status: data.status, expectedCells: data.expectedCells,
    completedCells: data.completedCells, sourceFetchedAt: data.sourceFetchedAt,
    productId };
  if (data.status !== "complete" || !data.products || !data.productsBySpot ||
    !data.productsByDate) return { ...base, product: null, stores: null, days: null };
  if (data.spotIds.length !== names.size ||
    data.spotIds.some((spotId) => !names.get(spotId)?.trim())) throw new Error("foodcost_store_names_mismatch");
  const product = data.products.find((row) => row.productId === productId);
  const stores = data.productsBySpot.map(({ spotId, products }) => ({
    spotId, storeName: names.get(spotId)!,
    fact: fact(products.find((row) => row.productId === productId)),
  }));
  const days = data.productsByDate.map(({ businessDate, products }) => ({
    businessDate, fact: fact(products.find((row) => row.productId === productId)),
  }));
  const total = fact(product);
  if (!matchesTotal(total, stores) || !matchesTotal(total, days)) {
    throw new Error("foodcost_product_breakdown_mismatch");
  }
  return { ...base,
    product: product ? { productName: product.productName,
      productNameConflict: product.productNameConflict, fact: total } : null,
    stores, days,
  };
}

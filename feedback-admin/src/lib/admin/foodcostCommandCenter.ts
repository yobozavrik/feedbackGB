import { getServerSupabase } from "@/lib/supabase";
import { loadFoodcostRecentBreakdown } from "./foodcostRecentNetwork";
import { salesMetrics } from "./posterSalesMath";

type RecentBreakdown = Awaited<ReturnType<typeof loadFoodcostRecentBreakdown>>;

export type CommandCenterView = {
  status: "complete" | "incomplete";
  dateFrom: string;
  dateTo: string;
  spotCount: number;
  expectedCells: number;
  completedCells: number;
  sourceFetchedAt: string | null;
  newestSourceFetchedAt: string | null;
  selectedSpotId: number | null;
  stores: { id: number; name: string }[];
  metrics: {
    payedSumMinor: number;
    foodCostPercent: number | null;
    nettoFoodCostPercent: number | null;
  } | null;
  days: {
    businessDate: string;
    metrics: { payedSumMinor: number; foodCostPercent: number | null; nettoFoodCostPercent: number | null };
  }[] | null;
  categories: {
    categoryId: number | null;
    displayName: string | null;
    payedSumMinor: number;
    foodCostPercent: number | null;
    nettoFoodCostPercent: number | null;
  }[] | null;
  products: {
    productId: number;
    productName: string;
    payedSumMinor: number;
    foodCostPercent: number | null;
    nettoFoodCostPercent: number | null;
    currentCatalogPresent: boolean;
  }[] | null;
};

const TOP_PRODUCTS = 12;

/** Derive every block from the same strict, three-day selected snapshot. */
export function buildCommandCenterView(
  recent: RecentBreakdown, currentCatalogIds: ReadonlySet<number>,
  stores: { id: number; name: string }[] = [], selectedSpotId: number | null = null,
): CommandCenterView {
  const base = {
    status: recent.status,
    dateFrom: recent.dateFrom,
    dateTo: recent.dateTo,
    spotCount: recent.spotCount,
    expectedCells: recent.expectedCells,
    completedCells: recent.completedCells,
    sourceFetchedAt: recent.sourceFetchedAt,
    newestSourceFetchedAt: recent.newestSourceFetchedAt,
    selectedSpotId,
    stores,
  } as const;
  if (recent.status !== "complete" || !recent.metrics || !recent.categories ||
    !recent.products || !recent.productsByDate) {
    return { ...base, status: "incomplete", metrics: null, days: null, categories: null, products: null };
  }
  const days = [...recent.productsByDate]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .map(({ businessDate, products }) => ({
      businessDate,
      metrics: salesMetrics(products),
    }));
  const categories = [...recent.categories]
    .sort((a, b) => b.payedSumMinor - a.payedSumMinor || (a.categoryId ?? 0) - (b.categoryId ?? 0))
    .map(({ categoryId, displayName, payedSumMinor, foodCostPercent, nettoFoodCostPercent }) => ({
      categoryId, displayName, payedSumMinor, foodCostPercent, nettoFoodCostPercent,
    }));
  const products = [...recent.products]
    .sort((a, b) => b.payedSumMinor - a.payedSumMinor || a.productId - b.productId)
    .slice(0, TOP_PRODUCTS)
    .map(({ productId, productName, payedSumMinor, foodCostPercent, nettoFoodCostPercent }) => ({
      productId, productName, payedSumMinor, foodCostPercent, nettoFoodCostPercent,
      currentCatalogPresent: currentCatalogIds.has(productId),
    }));
  return {
    ...base,
    status: "complete",
    metrics: {
      payedSumMinor: recent.metrics.payedSumMinor,
      foodCostPercent: recent.metrics.foodCostPercent,
      nettoFoodCostPercent: recent.metrics.nettoFoodCostPercent,
    },
    days,
    categories,
    products,
  };
}

export async function loadFoodcostCommandCenter(selectedSpotId?: number): Promise<CommandCenterView> {
  const recent = await loadFoodcostRecentBreakdown(new Date(), selectedSpotId);
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const storeResult = await db.from("v_stores").select("id,name").order("name");
  if (storeResult.error) throw new Error("foodcost_roster_unavailable");
  const stores = (storeResult.data ?? []).map((row) => ({ id: Number(row.id), name: String(row.name) }));
  const actualIds = stores.map((row) => row.id).sort((a, b) => a - b);
  if (actualIds.length !== recent.allSpotIds.length ||
    actualIds.some((id, index) => id !== recent.allSpotIds[index])) {
    throw new Error("foodcost_roster_mismatch");
  }
  if (recent.status !== "complete" || !recent.products) {
    return buildCommandCenterView(recent, new Set<number>(), stores, selectedSpotId ?? null);
  }
  const topIds = [...recent.products]
    .sort((a, b) => b.payedSumMinor - a.payedSumMinor || a.productId - b.productId)
    .slice(0, TOP_PRODUCTS).map((product) => product.productId);
  if (!topIds.length) return buildCommandCenterView(recent, new Set<number>(), stores, selectedSpotId ?? null);
  const catalog = await db.from("v_products").select("id").in("id", topIds).limit(TOP_PRODUCTS);
  if (catalog.error) throw new Error("foodcost_catalog_unavailable");
  const currentCatalogIds = new Set((catalog.data ?? []).map((row) => Number(row.id)));
  return buildCommandCenterView(recent, currentCatalogIds, stores, selectedSpotId ?? null);
}

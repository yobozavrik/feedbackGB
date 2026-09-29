import { getServerSupabase } from "@/lib/supabase";
import { loadFoodcostRecentBreakdown } from "./foodcostRecentNetwork";
import { loadFoodcostSalesPeriod } from "./foodcostSalesRead";
import { foodcostPeriodWindows, type FoodcostPeriodWindow } from "./foodcostPeriod";
import { buildFoodcostPeriodComparison, type FoodcostComparisonPeriodInput, type FoodcostPeriodComparison } from "./foodcostPeriodComparison";
import { salesMetrics } from "./posterSalesMath";
import { foodcostBand } from "./foodcostBands";
import { buildFoodcostHeatmap, type FoodcostHeatmap } from "./foodcostHeatmap";
import type { FoodcostPeriodDays } from "./foodcostPeriod";
import { buildFoodcostMatrixProducts, type FoodcostMatrixProduct, type FoodcostMatrixCategory } from "./foodcostMatrix";

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
    distinctProducts: number;
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
  attention: {
    quality: { code: "historical_roster_unconfirmed" | "netto_unavailable"; title: string; detail: string }[];
    categories: {
      categoryId: number | null;
      displayName: string | null;
      payedSumMinor: number;
      foodCostPercent: number | null;
      nettoFoodCostPercent: number | null;
      redMethods: ("profit" | "netto")[];
    }[];
    products: {
      productId: number;
      productName: string;
      payedSumMinor: number;
      foodCostPercent: number | null;
      nettoFoodCostPercent: number | null;
      currentCatalogPresent: boolean;
      redMethods: ("profit" | "netto")[];
    }[];
    productsRemaining: number;
  } | null;
  heatmap: FoodcostHeatmap | null;
  comparison: FoodcostPeriodComparison | null;
  matrix: { products: FoodcostMatrixProduct[]; categories: FoodcostMatrixCategory[] } | null;
};

const TOP_PRODUCTS = 12;
const ATTENTION_PRODUCTS = 5;
const CATALOG_ID_BATCH_SIZE = 100;
const CATALOG_QUERY_CONCURRENCY = 4;

function redMethods(row: { foodCostPercent: number | null; nettoFoodCostPercent: number | null }) {
  const methods: ("profit" | "netto")[] = [];
  if (foodcostBand(row.foodCostPercent) === "red") methods.push("profit");
  if (foodcostBand(row.nettoFoodCostPercent) === "red") methods.push("netto");
  return methods;
}

function byPaid<T extends { payedSumMinor: number }>(a: T, b: T, label: (row: T) => string,
  id: (row: T) => number): number {
  return b.payedSumMinor - a.payedSumMinor || label(a).localeCompare(label(b), "uk") || id(a) - id(b);
}

function isEconomicQueueCandidate(row: { payedSumMinor: number; foodCostPercent: number | null;
  nettoFoodCostPercent: number | null }): boolean {
  return row.payedSumMinor > 0 && redMethods(row).length > 0;
}

/** Derive every block from the same strict, selected-period snapshot. */
export function buildCommandCenterView(
  recent: RecentBreakdown, currentCatalogIds: ReadonlySet<number>,
  stores: { id: number; name: string }[] = [], selectedSpotId: number | null = null,
  comparison: FoodcostPeriodComparison | null = null,
  matrixCatalogIds?: ReadonlySet<number>,
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
    stores, comparison,
  } as const;
  if (recent.status !== "complete" || !recent.metrics || !recent.categories ||
    !recent.products || !recent.productsByDate || !recent.categoriesByDate) {
    return { ...base, status: "incomplete", metrics: null, days: null, categories: null, products: null,
      attention: null, heatmap: null, matrix: null };
  }
  const days = [...recent.productsByDate]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .map(({ businessDate, products }) => ({
      businessDate,
      metrics: salesMetrics(products),
    }));
  const categories = [...recent.categories]
    .sort((a, b) => b.payedSumMinor - a.payedSumMinor || (a.categoryId ?? 0) - (b.categoryId ?? 0))
    .map(({ categoryId, displayName, payedSumMinor, distinctProducts, foodCostPercent, nettoFoodCostPercent }) => ({
      categoryId, displayName, payedSumMinor, distinctProducts, foodCostPercent, nettoFoodCostPercent,
    }));
  const products = [...recent.products]
    .sort((a, b) => b.payedSumMinor - a.payedSumMinor || a.productId - b.productId)
    .slice(0, TOP_PRODUCTS)
    .map(({ productId, productName, payedSumMinor, foodCostPercent, nettoFoodCostPercent }) => ({
      productId, productName, payedSumMinor, foodCostPercent, nettoFoodCostPercent,
      currentCatalogPresent: currentCatalogIds.has(productId),
    }));
  const qualityIssues: NonNullable<CommandCenterView["attention"]>["quality"] = [];
  if (recent.metrics.productProfitNettoMinor === null) {
    qualityIssues.push({ code: "netto_unavailable", title: "Методика без ПДВ Poster недоступна",
      detail: "У повному знімку є рядки без product_profit_netto. Цей метод не потрапляє до червоної черги." });
  }
  if (selectedSpotId === null && recent.historicalRosterVerified === false) {
    qualityIssues.push({ code: "historical_roster_unconfirmed", title: "Історичний склад мережі не підтверджено",
      detail: "Порівняння застосовує поточний список магазинів до всього періоду; історичне членство магазинів не відоме." });
  }
  const attentionCategories = categories.filter(isEconomicQueueCandidate).map((row) => ({
    ...row, redMethods: redMethods(row),
  })).sort((a, b) => byPaid(a, b, (row) => row.displayName ?? "", (row) => row.categoryId ?? -1));
  const attentionProducts = [...recent.products].filter(isEconomicQueueCandidate).map((row) => ({
    productId: row.productId, productName: row.productName, payedSumMinor: row.payedSumMinor,
    foodCostPercent: row.foodCostPercent, nettoFoodCostPercent: row.nettoFoodCostPercent,
    currentCatalogPresent: currentCatalogIds.has(row.productId), redMethods: redMethods(row),
  })).sort((a, b) => byPaid(a, b, (row) => row.productName, (row) => row.productId));
  const heatmap = buildFoodcostHeatmap({
    dates: recent.productsByDate.map((day) => day.businessDate),
    categoriesByDate: recent.categoriesByDate,
    categories,
    totalByDate: days.map((day) => ({ businessDate: day.businessDate, metrics: day.metrics })),
    productsByDate: recent.productsByDate,
    spotCount: recent.spotCount,
  });
  const matrix = matrixCatalogIds === undefined ? null : buildFoodcostMatrixProducts(recent.products, recent.categories,
    new Map(recent.categories.flatMap((category) => category.displayName ? [[category.categoryId, category.displayName] as [number, string]] : [])),
    matrixCatalogIds);
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
    attention: { quality: qualityIssues, categories: attentionCategories,
      products: attentionProducts.slice(0, ATTENTION_PRODUCTS),
      productsRemaining: Math.max(0, attentionProducts.length - ATTENTION_PRODUCTS) },
    heatmap, matrix,
  };
}

function comparisonPeriod(input: {
  status: "complete" | "incomplete";
  expectedCells: number;
  completedCells: number;
  metrics: NonNullable<RecentBreakdown["metrics"]> | null;
}, window: FoodcostPeriodWindow): FoodcostComparisonPeriodInput {
  return { ...input, from: window.from, to: window.to };
}

export async function loadFoodcostCommandCenter(selectedSpotId?: number,
  periodDays: FoodcostPeriodDays = 7, now = new Date(), options: { includeMatrix?: boolean } = {}): Promise<CommandCenterView> {
  const asOf = now.toISOString();
  const windows = foodcostPeriodWindows(periodDays, now);
  const recent = await loadFoodcostRecentBreakdown(now, selectedSpotId, periodDays, { asOf });
  const previous = recent.status === "complete" && !options.includeMatrix
    ? await loadFoodcostSalesPeriod(windows.previous.dates,
      selectedSpotId === undefined ? recent.allSpotIds : [selectedSpotId], asOf)
    : null;
  const comparison = buildFoodcostPeriodComparison({
    asOf,
    current: comparisonPeriod({ status: recent.status, expectedCells: recent.expectedCells,
      completedCells: recent.completedCells, metrics: recent.metrics }, windows.current),
    previous: previous ? comparisonPeriod({ status: previous.status, expectedCells: previous.expectedCells,
      completedCells: previous.completedCells, metrics: previous.metrics }, windows.previous) : null,
    previousWindow: { from: windows.previous.from, to: windows.previous.to,
      expectedCells: recent.expectedCells },
  });
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
    return buildCommandCenterView(recent, new Set<number>(), stores, selectedSpotId ?? null, comparison);
  }
  const topIds = options.includeMatrix ? recent.products.map((product) => product.productId) : [...recent.products]
    .sort((a, b) => b.payedSumMinor - a.payedSumMinor || a.productId - b.productId)
    .slice(0, TOP_PRODUCTS).map((product) => product.productId);
  const candidateIds = recent.products.filter(isEconomicQueueCandidate)
    .sort((a, b) => byPaid(a, b, (row) => row.productName, (row) => row.productId))
    .slice(0, ATTENTION_PRODUCTS).map((product) => product.productId);
  const idsToLookup = [...new Set([...topIds, ...candidateIds])];
  if (!idsToLookup.length) return buildCommandCenterView(recent, new Set<number>(), stores, selectedSpotId ?? null, comparison,
    options.includeMatrix ? new Set<number>() : undefined);
  const batches: number[][] = [];
  for (let i = 0; i < idsToLookup.length; i += CATALOG_ID_BATCH_SIZE) {
    batches.push(idsToLookup.slice(i, i + CATALOG_ID_BATCH_SIZE));
  }
  const catalogIds: number[] = [];
  for (let i = 0; i < batches.length; i += CATALOG_QUERY_CONCURRENCY) {
    const results = await Promise.all(batches.slice(i, i + CATALOG_QUERY_CONCURRENCY).map((ids) =>
      db.from("v_products").select("id").in("id", ids).limit(ids.length)));
    if (results.some((result) => result.error)) throw new Error("foodcost_catalog_unavailable");
    for (const result of results) catalogIds.push(...(result.data ?? []).map((row) => Number(row.id)));
  }
  const currentCatalogIds = new Set(catalogIds);
  return buildCommandCenterView(recent, currentCatalogIds, stores, selectedSpotId ?? null, comparison,
    options.includeMatrix ? currentCatalogIds : undefined);
}

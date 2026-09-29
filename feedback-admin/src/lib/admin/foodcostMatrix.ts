import type { CategorySales, ProductSales } from "./posterSalesMath";
import { foodcostBand } from "./foodcostBands";

export type FoodcostMatrixMethod = "profit" | "netto";
export type FoodcostMatrixProduct = {
  productId: number;
  productName: string;
  productNameConflict: boolean;
  categoryId: number | null;
  categoryKey: string;
  categoryName: string;
  categoryConflict: boolean;
  payedSumMinor: number;
  profitMinor: number;
  profitNettoMinor: number | null;
  productProfitNettoMinor: number | null;
  foodCostPercent: number | null;
  nettoFoodCostPercent: number | null;
  currentCatalogPresent: boolean;
};

export type FoodcostMatrixCategory = { key: string; name: string };
export function foodcostMatrixCategoryOptions(categories: readonly FoodcostMatrixCategory[], selectedKey: string): {
  value: string; label: string;
}[] {
  const options = [{ value: "all", label: "Усі категорії" }];
  if (selectedKey !== "all" && !categories.some((category) => category.key === selectedKey)) {
    const label = selectedKey === "__unknown" ? "Без категорії · немає продажів у періоді"
      : selectedKey === "__conflict" ? "Змінювалась категорія · немає продажів у періоді"
        : `Категорія #${selectedKey} · немає продажів у періоді`;
    options.push({ value: selectedKey, label });
  }
  return [...options, ...categories.map((category) => ({ value: category.key, label: category.name }))];
}

export type FoodcostMatrixFilters = {
  method: FoodcostMatrixMethod;
  categoryKey: string;
  search: string;
  minimumPaidMinor: number;
};
export type FoodcostMatrixSelection = {
  rows: FoodcostMatrixProduct[];
  chartRows: FoodcostMatrixProduct[];
  totalInScope: number;
  filteredOutByMinimum: number;
  nonPositivePaid: number;
  missingSelectedMethod: number;
};
export type FoodcostMatrixDomain = { xMin: number; xMax: number; yMin: number; yMax: number };
export type FoodcostMatrixViewport = { domain: FoodcostMatrixDomain | null; visible: FoodcostMatrixProduct[]; outside: FoodcostMatrixProduct[] };
export type FoodcostMatrixViewportMode = "focus" | "full";
export type FoodcostMatrixTableScope = "all" | "outside";

export function normalizeFoodcostMatrixTableScope(scope: FoodcostMatrixTableScope, nextMode: FoodcostMatrixViewportMode): FoodcostMatrixTableScope {
  return nextMode === "full" ? "all" : scope;
}

export function buildFoodcostMatrixProducts(products: readonly ProductSales[], categories: readonly CategorySales[],
  categoryNames: ReadonlyMap<number, string>, catalogIds: ReadonlySet<number>): {
    products: FoodcostMatrixProduct[]; categories: FoodcostMatrixCategory[];
  } {
  const categoryIds = new Set(categories.map((row) => row.categoryId));
  const mapped = products.map((row): FoodcostMatrixProduct => {
    const key = row.categoryConflict ? "__conflict" : row.categoryId === null ? "__unknown" : String(row.categoryId);
    const name = row.categoryConflict ? "Категорія різниться у модифікаціях"
      : row.categoryId === null ? "Без категорії"
        : (categoryIds.has(row.categoryId) ? categoryNames.get(row.categoryId) : null) || `Категорія #${row.categoryId}`;
    return { productId: row.productId, productName: row.productName, productNameConflict: row.productNameConflict,
      categoryId: row.categoryId, categoryKey: key, categoryName: name, categoryConflict: row.categoryConflict,
      payedSumMinor: row.payedSumMinor, profitMinor: row.productProfitMinor, profitNettoMinor: row.productProfitNettoMinor,
      productProfitNettoMinor: row.productProfitNettoMinor, foodCostPercent: row.foodCostPercent,
      nettoFoodCostPercent: row.nettoFoodCostPercent, currentCatalogPresent: catalogIds.has(row.productId) };
  });
  const byKey = new Map<string, string>();
  for (const row of mapped) byKey.set(row.categoryKey, row.categoryName);
  const categoryOptions = [...byKey].map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "uk") || a.key.localeCompare(b.key));
  return { products: mapped, categories: categoryOptions };
}

export function selectFoodcostMatrixRows(rows: readonly FoodcostMatrixProduct[], filters: FoodcostMatrixFilters): FoodcostMatrixSelection {
  const needle = filters.search.trim().toLocaleLowerCase("uk");
  const base = rows.filter((row) => (filters.categoryKey === "all" || row.categoryKey === filters.categoryKey) &&
    (!needle || row.productName.toLocaleLowerCase("uk").includes(needle) || String(row.productId).includes(needle)));
  // Minimum paid screens small positive-sale products; zero/negative rows stay visible as their own class.
  const shown = base.filter((row) => row.payedSumMinor <= 0 || row.payedSumMinor >= filters.minimumPaidMinor);
  const rateFor = (row: FoodcostMatrixProduct) => filters.method === "profit" ? row.foodCostPercent : row.nettoFoodCostPercent;
  const profitFor = (row: FoodcostMatrixProduct) => filters.method === "profit" ? row.profitMinor : row.profitNettoMinor;
  const chartRows = shown.filter((row) => row.payedSumMinor > 0 && rateFor(row) !== null && Number.isFinite(rateFor(row)) &&
    profitFor(row) !== null && Number.isFinite(profitFor(row)));
  return { rows: [...shown].sort((a, b) => b.payedSumMinor - a.payedSumMinor || a.productId - b.productId),
    chartRows, totalInScope: base.length, filteredOutByMinimum: base.length - shown.length,
    nonPositivePaid: shown.filter((row) => row.payedSumMinor <= 0).length,
    missingSelectedMethod: shown.filter((row) => row.payedSumMinor > 0 && (rateFor(row) === null || profitFor(row) === null)).length };
}

export function foodcostMatrixRate(row: FoodcostMatrixProduct, method: FoodcostMatrixMethod): number | null {
  return method === "profit" ? row.foodCostPercent : row.nettoFoodCostPercent;
}

export function foodcostMatrixProfit(row: FoodcostMatrixProduct, method: FoodcostMatrixMethod): number | null {
  return method === "profit" ? row.profitMinor : row.profitNettoMinor;
}

export function foodcostMatrixDomain(rows: readonly FoodcostMatrixProduct[], method: FoodcostMatrixMethod): FoodcostMatrixDomain | null {
  const plotted = rows.filter((row) => row.payedSumMinor > 0 && foodcostMatrixRate(row, method) !== null &&
    Number.isFinite(foodcostMatrixRate(row, method)) && foodcostMatrixProfit(row, method) !== null && Number.isFinite(foodcostMatrixProfit(row, method)));
  if (!plotted.length) return null;
  let xMin = 0;
  let xMax = 100;
  let yMin = 0;
  let yMax = 0;
  for (const row of plotted) {
    const rate = foodcostMatrixRate(row, method)!;
    const profitUah = foodcostMatrixProfit(row, method)! / 100;
    xMin = Math.min(xMin, rate);
    xMax = Math.max(xMax, rate);
    yMin = Math.min(yMin, profitUah);
    yMax = Math.max(yMax, profitUah);
  }
  return { xMin: Math.min(35, xMin), xMax: Math.max(45, xMax), yMin, yMax };
}

/** Readable focus window: keep all negative profit visible, cap only the positive Y tail at P95, and focus X on 0–100%. */
export function foodcostMatrixFocusDomain(rows: readonly FoodcostMatrixProduct[], method: FoodcostMatrixMethod): FoodcostMatrixDomain | null {
  const plotted = rows.filter((row) => row.payedSumMinor > 0 && foodcostMatrixRate(row, method) !== null &&
    Number.isFinite(foodcostMatrixRate(row, method)) && foodcostMatrixProfit(row, method) !== null && Number.isFinite(foodcostMatrixProfit(row, method)));
  if (!plotted.length) return null;
  const profitUah = plotted.map((row) => foodcostMatrixProfit(row, method)! / 100).sort((a, b) => a - b);
  const positive = profitUah.filter((value) => value > 0);
  const yMin = Math.min(0, profitUah[0]);
  const p95 = positive.length ? positive[Math.max(0, Math.ceil(positive.length * 0.95) - 1)] : 0;
  const focusUpper = Math.max(0, p95);
  const yMax = focusUpper > yMin ? focusUpper : yMin + 1;
  return { xMin: 0, xMax: 100, yMin, yMax };
}

export function foodcostMatrixViewport(rows: readonly FoodcostMatrixProduct[], method: FoodcostMatrixMethod,
  domain: FoodcostMatrixDomain | null): FoodcostMatrixViewport {
  if (!domain) return { domain: null, visible: [], outside: [] };
  const visible: FoodcostMatrixProduct[] = [];
  const outside: FoodcostMatrixProduct[] = [];
  for (const row of rows) {
    const rate = foodcostMatrixRate(row, method);
    const profit = foodcostMatrixProfit(row, method);
    if (rate === null || profit === null || !Number.isFinite(rate) || !Number.isFinite(profit) || row.payedSumMinor <= 0) continue;
    const profitUah = profit / 100;
    (rate < domain.xMin || rate > domain.xMax || profitUah < domain.yMin || profitUah > domain.yMax ? outside : visible).push(row);
  }
  return { domain, visible, outside };
}

export function foodcostMatrixBand(row: FoodcostMatrixProduct, method: FoodcostMatrixMethod) {
  return foodcostBand(foodcostMatrixRate(row, method));
}

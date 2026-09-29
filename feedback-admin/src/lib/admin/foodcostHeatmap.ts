import { salesMetrics, type CategorySales, type ProductSales, type SalesMetrics } from "./posterSalesMath";

export type FoodcostHeatmapBin = {
  key: string;
  from: string;
  to: string;
  label: string;
  kind: "day" | "week";
  dates: string[];
};

export type FoodcostHeatmapCell = {
  binKey: string;
  payedSumMinor: number;
  foodCostPercent: number | null;
  nettoFoodCostPercent: number | null;
  distinctProducts: number;
  completedCells: number;
  expectedCells: number;
};

export type FoodcostHeatmapRow = {
  categoryId: number | null;
  displayName: string;
  payedSumMinor: number;
  cells: FoodcostHeatmapCell[];
  distinctProducts: number;
};

export type FoodcostHeatmap = {
  bins: FoodcostHeatmapBin[];
  rows: FoodcostHeatmapRow[];
  total: FoodcostHeatmapRow;
};

type CategoryDay = { businessDate: string; categories: CategorySales[];
  productIdsByCategory: { categoryId: number | null; productIds: number[] }[] };
type NamedCategory = { categoryId: number | null; displayName: string | null;
  payedSumMinor: number; distinctProducts: number };

function addCalendarDays(date: string, amount: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "UTC", day: "2-digit", month: "2-digit" })
    .format(new Date(`${date}T00:00:00Z`));
}

function binsForDates(dates: readonly string[]): FoodcostHeatmapBin[] {
  const sorted = [...dates].sort();
  const available = new Set(sorted);
  const bins: FoodcostHeatmapBin[] = [];
  for (let index = 0; index < sorted.length;) {
    const date = sorted[index];
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // Sunday=0
    const monday = weekday === 0 ? addCalendarDays(date, -6) : addCalendarDays(date, 1 - weekday);
    const weekDates = Array.from({ length: 7 }, (_, offset) => addCalendarDays(monday, offset));
    const isWholeCalendarWeek = date === monday && weekDates.every((weekDate) => available.has(weekDate));
    if (dates.length > 14 && isWholeCalendarWeek) {
      const to = weekDates[6];
      bins.push({ key: `week:${monday}`, from: monday, to,
        label: `${dayLabel(monday)}–${dayLabel(to)}`, kind: "week", dates: weekDates });
      index += 7;
    } else {
      bins.push({ key: `day:${date}`, from: date, to: date, label: dayLabel(date), kind: "day", dates: [date] });
      index++;
    }
  }
  return bins;
}

function cellMetrics(rows: readonly Pick<SalesMetrics,
  "payedSumMinor" | "productProfitMinor" | "productProfitNettoMinor">[]): SalesMetrics {
  return salesMetrics(rows);
}

/**
 * Build category × complete calendar week/day heatmap from one fully covered snapshot.
 * Incomplete snapshots must be rejected by the caller, not passed as partial evidence.
 */
export function buildFoodcostHeatmap(input: {
  dates: readonly string[];
  categoriesByDate: readonly CategoryDay[];
  categories: readonly NamedCategory[];
  totalByDate: readonly { businessDate: string; metrics: SalesMetrics }[];
  productsByDate: readonly { businessDate: string; products: ProductSales[] }[];
  spotCount: number;
}): FoodcostHeatmap {
  const dates = [...input.dates].sort();
  if (!dates.length || new Set(dates).size !== dates.length ||
    dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error("invalid_foodcost_heatmap_scope");
  }
  const dailyCategories = new Map(input.categoriesByDate.map((day) => [day.businessDate, day.categories]));
  const dailyCategoryProducts = new Map(input.categoriesByDate.map((day) => [day.businessDate, day.productIdsByCategory]));
  const dailyTotals = new Map(input.totalByDate.map((day) => [day.businessDate, day.metrics]));
  const dailyProducts = new Map(input.productsByDate.map((day) => [day.businessDate, day.products]));
  if (!Number.isSafeInteger(input.spotCount) || input.spotCount <= 0 ||
    dates.some((date) => !dailyCategories.has(date) || !dailyTotals.has(date) || !dailyProducts.has(date))) {
    throw new Error("incomplete_foodcost_heatmap_snapshot");
  }
  const bins = binsForDates(dates);
  const categories = [...input.categories].sort((a, b) =>
    b.payedSumMinor - a.payedSumMinor || (a.categoryId ?? -1) - (b.categoryId ?? -1));
  const categoryRows = categories.map((category) => ({
    categoryId: category.categoryId,
    displayName: category.displayName?.trim() || (category.categoryId === null
      ? "Без категорії" : `Категорія #${category.categoryId}`),
    payedSumMinor: category.payedSumMinor,
    distinctProducts: category.distinctProducts,
    cells: bins.map((bin) => {
      const rows = bin.dates.flatMap((date) => (dailyCategories.get(date) ?? [])
        .filter((row) => row.categoryId === category.categoryId));
      const metrics = cellMetrics(rows);
      const distinctProducts = new Set(bin.dates.flatMap((date) => (dailyCategoryProducts.get(date) ?? [])
        .filter((row) => row.categoryId === category.categoryId)
        .flatMap((row) => row.productIds))).size;
      return { binKey: bin.key, payedSumMinor: metrics.payedSumMinor,
        foodCostPercent: metrics.foodCostPercent, nettoFoodCostPercent: metrics.nettoFoodCostPercent,
        distinctProducts, completedCells: bin.dates.length * input.spotCount,
        expectedCells: bin.dates.length * input.spotCount };
    }),
  }));
  const total = {
    categoryId: null,
    displayName: "Уся мережа",
    payedSumMinor: input.totalByDate.reduce((sum, day) => sum + day.metrics.payedSumMinor, 0),
    distinctProducts: new Set(input.productsByDate.flatMap((day) => day.products.map((row) => row.productId))).size,
    cells: bins.map((bin) => {
      const metrics = cellMetrics(bin.dates.map((date) => dailyTotals.get(date)!));
      const distinctProducts = new Set(bin.dates.flatMap((date) =>
        (dailyProducts.get(date) ?? []).map((row) => row.productId))).size;
      return { binKey: bin.key, payedSumMinor: metrics.payedSumMinor,
        foodCostPercent: metrics.foodCostPercent, nettoFoodCostPercent: metrics.nettoFoodCostPercent,
        distinctProducts, completedCells: bin.dates.length * input.spotCount,
        expectedCells: bin.dates.length * input.spotCount };
    }),
  };
  return { bins, rows: categoryRows, total };
}

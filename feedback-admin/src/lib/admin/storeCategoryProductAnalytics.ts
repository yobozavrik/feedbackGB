import { getServerSupabase } from "@/lib/supabase";
import { loadCurrentPosterCategoryNames } from "./posterCategoryNames";

export type CategoryNameSource = "sales_snapshot" | "current_poster_catalog" | "missing" | "unknown";

export type AnalyticsCoverageWindow = {
  from: string;
  to: string;
  status: "complete" | "incomplete";
  expectedCells: number;
  completedCells: number;
  missingCount: number;
  missing: Array<{ date: string; spotId: number }>;
  totalRevenueMinor: string | null;
};

export type StoreCategoryAnalyticsRow = {
  categoryId: number | null;
  categoryName: string;
  categoryNameSource: CategoryNameSource;
  categoryNameConflict: boolean;
  revenueMinor: string;
  revenueSharePercent: string | null;
  profitMinor: string;
  classicFoodcostPercent: string | null;
  storeCoverageCount: number;
  selectedStoreCount: number;
  distinctProductCount: number;
  previousRevenueMinor: string | null;
  deltaRevenueMinor: string | null;
  deltaRevenuePercent: string | null;
  deltaSharePoints: string | null;
};

export type StoreProductAnalyticsRow = {
  productId: number;
  modificationId: number;
  productName: string;
  productNameConflict: boolean;
  categoryId: number | null;
  categoryName: string;
  categoryNameSource: CategoryNameSource;
  categoryNameConflict: boolean;
  unit: string | null;
  weightBased: boolean;
  quantity: string;
  revenueMinor: string;
  revenueSharePercent: string | null;
  profitMinor: string;
  classicFoodcostPercent: string | null;
  effectivePriceMinor: string | null;
  storeCoverageCount: number;
  selectedStoreCount: number;
  previousQuantity: string | null;
  previousRevenueMinor: string | null;
  deltaRevenueMinor: string | null;
  deltaRevenuePercent: string | null;
};

export type StoreCategoryProductAnalytics = {
  methodologyVersion: "store-category-product-v1";
  asOf: string;
  timezone: "Europe/Kyiv";
  historicalRosterVerified: false;
  spotIds: number[];
  current: AnalyticsCoverageWindow;
  comparison: AnalyticsCoverageWindow | null;
  categories: StoreCategoryAnalyticsRow[];
  products: { total: number; limit: number; offset: number; rows: StoreProductAnalyticsRow[] };
  trend: Array<{ date: string; revenueMinor: string; quantity: string | null; unit: string | null; unitConflict: boolean }>;
  penetration: { status: "unavailable"; reason: "receipt_line_quantity_and_money_basis_unverified" };
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("store_catalog_response_invalid");
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("store_catalog_response_invalid");
  return Number(value);
}

function decimal(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("store_catalog_response_invalid");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("store_catalog_response_invalid");
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("store_catalog_response_invalid");
  return value;
}

function isoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("store_catalog_response_invalid");
  return value;
}

function nullableId(value: unknown): number | null {
  return value === null ? null : integer(value);
}

function coverage(value: unknown): AnalyticsCoverageWindow {
  const row = object(value);
  if (!Array.isArray(row.missing) || !["complete", "incomplete"].includes(String(row.status))) {
    throw new Error("store_catalog_response_invalid");
  }
  const parsed = {
    from: isoDate(row.from), to: isoDate(row.to), status: row.status as AnalyticsCoverageWindow["status"],
    expectedCells: integer(row.expectedCells), completedCells: integer(row.completedCells),
    missingCount: integer(row.missingCount),
    missing: row.missing.map((item) => { const v = object(item); return { date: isoDate(v.date), spotId: integer(v.spotId) }; }),
    totalRevenueMinor: decimal(row.totalRevenueMinor, true),
  };
  if (parsed.completedCells > parsed.expectedCells || parsed.missingCount !== parsed.expectedCells - parsed.completedCells ||
      (parsed.status === "complete") !== (parsed.completedCells === parsed.expectedCells) ||
      (parsed.status === "complete") !== (parsed.totalRevenueMinor !== null)) {
    throw new Error("store_catalog_response_invalid");
  }
  return parsed;
}

export function parseStoreCategoryProductAnalytics(value: unknown): StoreCategoryProductAnalytics {
  const row = object(value), products = object(row.products), penetration = object(row.penetration);
  if (row.methodologyVersion !== "store-category-product-v1" || row.timezone !== "Europe/Kyiv" ||
      row.historicalRosterVerified !== false || typeof row.asOf !== "string" || !Array.isArray(row.spotIds) ||
      !Array.isArray(row.categories) || !Array.isArray(products.rows) || !Array.isArray(row.trend) ||
      penetration.status !== "unavailable" || penetration.reason !== "receipt_line_quantity_and_money_basis_unverified") {
    throw new Error("store_catalog_response_invalid");
  }
  return {
    methodologyVersion: "store-category-product-v1", asOf: row.asOf, timezone: "Europe/Kyiv",
    historicalRosterVerified: false, spotIds: row.spotIds.map(integer), current: coverage(row.current),
    comparison: row.comparison === null ? null : coverage(row.comparison),
    categories: row.categories.map((item) => { const v = object(item); const categoryId = nullableId(v.categoryId);
      const rawCategoryName = text(v.categoryName);
      const missingName = categoryId !== null && rawCategoryName === "Без категорії";
      return {
      categoryId, categoryName: missingName ? `Категорія #${categoryId}` : rawCategoryName,
      categoryNameSource: categoryId === null ? "unknown" : missingName ? "missing" : "sales_snapshot",
      categoryNameConflict: bool(v.categoryNameConflict),
      revenueMinor: decimal(v.revenueMinor)!, revenueSharePercent: decimal(v.revenueSharePercent, true),
      profitMinor: decimal(v.profitMinor)!, classicFoodcostPercent: decimal(v.classicFoodcostPercent, true),
      storeCoverageCount: integer(v.storeCoverageCount), selectedStoreCount: integer(v.selectedStoreCount),
      distinctProductCount: integer(v.distinctProductCount), previousRevenueMinor: decimal(v.previousRevenueMinor, true),
      deltaRevenueMinor: decimal(v.deltaRevenueMinor, true), deltaRevenuePercent: decimal(v.deltaRevenuePercent, true),
      deltaSharePoints: decimal(v.deltaSharePoints, true),
    }; }),
    products: { total: integer(products.total), limit: integer(products.limit), offset: integer(products.offset),
      rows: products.rows.map((item) => { const v = object(item); return {
        productId: integer(v.productId), modificationId: integer(v.modificationId), productName: text(v.productName),
        productNameConflict: bool(v.productNameConflict), categoryId: nullableId(v.categoryId),
        categoryName: (() => { const id = nullableId(v.categoryId), name = text(v.categoryName);
          return id !== null && name === "Без категорії" ? `Категорія #${id}` : name; })(),
        categoryNameSource: (() => { const id = nullableId(v.categoryId), name = text(v.categoryName);
          return id === null ? "unknown" : name === "Без категорії" ? "missing" : "sales_snapshot"; })(),
        categoryNameConflict: bool(v.categoryNameConflict),
        unit: v.unit === null ? null : text(v.unit), weightBased: bool(v.weightBased), quantity: decimal(v.quantity)!,
        revenueMinor: decimal(v.revenueMinor)!, revenueSharePercent: decimal(v.revenueSharePercent, true),
        profitMinor: decimal(v.profitMinor)!, classicFoodcostPercent: decimal(v.classicFoodcostPercent, true),
        effectivePriceMinor: decimal(v.effectivePriceMinor, true), storeCoverageCount: integer(v.storeCoverageCount),
        selectedStoreCount: integer(v.selectedStoreCount), previousQuantity: decimal(v.previousQuantity, true),
        previousRevenueMinor: decimal(v.previousRevenueMinor, true), deltaRevenueMinor: decimal(v.deltaRevenueMinor, true),
        deltaRevenuePercent: decimal(v.deltaRevenuePercent, true),
      }; }) },
    trend: row.trend.map((item) => { const v = object(item); return {
      date: isoDate(v.date), revenueMinor: decimal(v.revenueMinor)!, quantity: decimal(v.quantity, true),
      unit: v.unit === null ? null : text(v.unit), unitConflict: bool(v.unitConflict),
    }; }),
    penetration: { status: "unavailable", reason: "receipt_line_quantity_and_money_basis_unverified" },
  };
}

export function enrichStoreCatalogCategoryNames(data: StoreCategoryProductAnalytics,
  currentNames: ReadonlyMap<number, string>): StoreCategoryProductAnalytics {
  const categoryName = <T extends { categoryId: number | null; categoryName: string;
    categoryNameSource: CategoryNameSource }>(row: T): T => {
    if (row.categoryId === null || row.categoryNameSource !== "missing") return row;
    const currentName = currentNames.get(row.categoryId);
    return currentName ? { ...row, categoryName: currentName,
      categoryNameSource: "current_poster_catalog" as const } : row;
  };
  return {
    ...data,
    categories: data.categories.map(categoryName),
    products: { ...data.products, rows: data.products.rows.map(categoryName) },
  };
}

export async function loadStoreCategoryProductAnalytics(input: {
  from: string; to: string; spotIds: number[]; compareFrom: string | null; compareTo: string | null;
  asOf: string; categoryId: number | "unknown" | null; productId: number | null; modificationId: number | null;
  search: string; sort: "revenue" | "change" | "name"; direction: "asc" | "desc"; page: number; pageSize: number;
}): Promise<StoreCategoryProductAnalytics> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const { data, error } = await db.rpc("read_store_category_product_analytics", {
    p_from: input.from, p_to: input.to, p_spot_ids: input.spotIds,
    p_compare_from: input.compareFrom, p_compare_to: input.compareTo, p_as_of: input.asOf,
    p_category_id: typeof input.categoryId === "number" ? input.categoryId : null,
    p_category_unknown: input.categoryId === "unknown", p_product_id: input.productId,
    p_modification_id: input.modificationId, p_search: input.search, p_sort: input.sort,
    p_direction: input.direction, p_limit: input.pageSize, p_offset: (input.page - 1) * input.pageSize,
  });
  if (error) {
    if (["42P01", "42883", "PGRST202"].includes(error.code ?? "")) throw new Error("store_catalog_schema_missing");
    throw new Error("store_catalog_read_failed");
  }
  const parsed = parseStoreCategoryProductAnalytics(data);
  if (parsed.current.status !== "complete") return parsed;
  const currentNames = await loadCurrentPosterCategoryNames().catch(() => null);
  return currentNames ? enrichStoreCatalogCategoryNames(parsed, currentNames) : parsed;
}

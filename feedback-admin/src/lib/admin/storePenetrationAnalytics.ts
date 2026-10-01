import { getServerSupabase } from "@/lib/supabase";
import { loadCurrentPosterCategoryNames } from "./posterCategoryNames";

export type StorePenetrationCategory = {
  categoryId: number;
  categoryName: string;
  categoryNameSource: "current_poster_catalog" | "missing";
  receiptCount: number;
  penetrationPercent: string | null;
  storeCount: number;
};

export type StorePenetrationAnalytics = {
  methodologyVersion: "store-penetration-v1";
  asOf: string;
  timezone: "Europe/Kyiv";
  spotIds: number[];
  status: "complete" | "incomplete" | "mapping_incomplete";
  coverage: { from: string; to: string; expectedDays: number; completedDays: number; missingDates: string[] };
  denominator: {
    eligibleReceipts: number | null;
    definition: "distinct eligible purchase receipts in selected network scope";
  };
  mapping: { status: "complete" | "incomplete" | "unavailable"; bridgeRows: number; mappedRows: number; unmappedRows: number };
  selectedCategoryId: number | null;
  categories: StorePenetrationCategory[];
  products: Array<{
    productId: number;
    modificationId: number;
    categoryId: number;
    productName: string;
    productNameSource: "sales_snapshot" | "missing";
    receiptCount: number;
    penetrationPercent: string | null;
    storeCount: number;
  }>;
  stores: Array<{ spotId: number; eligibleReceipts: number; categoryReceipts: number; penetrationPercent: string | null }>;
  trend: Array<{ date: string; eligibleReceipts: number; categoryReceipts: number; penetrationPercent: string | null }>;
  historicalRosterVerified: false;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("store_penetration_response_invalid");
  return value as Record<string, unknown>;
}

function integer(value: unknown, positive = false): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < (positive ? 1 : 0)) {
    throw new Error("store_penetration_response_invalid");
  }
  return Number(parsed);
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}

function isoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("store_penetration_response_invalid");
  }
  return value;
}

function percent(value: unknown, numerator: number, denominator: number): string | null {
  if (denominator === 0) {
    if (value !== null || numerator !== 0) throw new Error("store_penetration_response_invalid");
    return null;
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("store_penetration_response_invalid");
  }
  const parsed = Number(value);
  const expected = Math.round((numerator * 10000) / denominator) / 100;
  if (parsed < 0 || parsed > 100 || Math.abs(parsed - expected) > 0.011) {
    throw new Error("store_penetration_response_invalid");
  }
  return value;
}

export function parseStorePenetrationAnalytics(value: unknown): StorePenetrationAnalytics {
  const row = object(value);
  if (row.methodologyVersion !== "store-penetration-v1" || row.timezone !== "Europe/Kyiv" ||
    row.historicalRosterVerified !== false || typeof row.asOf !== "string" || !Array.isArray(row.spotIds) ||
    !["complete", "incomplete", "mapping_incomplete"].includes(String(row.status))) {
    throw new Error("store_penetration_response_invalid");
  }
  const spotIds = row.spotIds.map((item) => integer(item, true));
  if (!spotIds.length || new Set(spotIds).size !== spotIds.length) throw new Error("store_penetration_response_invalid");
  const coverageRaw = object(row.coverage);
  if (!Array.isArray(coverageRaw.missingDates)) throw new Error("store_penetration_response_invalid");
  const coverage = {
    from: isoDate(coverageRaw.from), to: isoDate(coverageRaw.to),
    expectedDays: integer(coverageRaw.expectedDays), completedDays: integer(coverageRaw.completedDays),
    missingDates: coverageRaw.missingDates.map(isoDate),
  };
  if (coverage.from > coverage.to || coverage.expectedDays < 1 || coverage.completedDays > coverage.expectedDays ||
    coverage.missingDates.length !== coverage.expectedDays - coverage.completedDays) {
    throw new Error("store_penetration_response_invalid");
  }
  const denominatorRaw = object(row.denominator);
  if (denominatorRaw.definition !== "distinct eligible purchase receipts in selected network scope") {
    throw new Error("store_penetration_response_invalid");
  }
  const eligibleReceipts = nullableInteger(denominatorRaw.eligibleReceipts);
  const mappingRaw = object(row.mapping);
  if (!["complete", "incomplete", "unavailable"].includes(String(mappingRaw.status))) {
    throw new Error("store_penetration_response_invalid");
  }
  const mapping = {
    status: mappingRaw.status as StorePenetrationAnalytics["mapping"]["status"],
    bridgeRows: integer(mappingRaw.bridgeRows), mappedRows: integer(mappingRaw.mappedRows),
    unmappedRows: integer(mappingRaw.unmappedRows),
  };
  if (mapping.mappedRows + mapping.unmappedRows !== mapping.bridgeRows ||
    (mapping.status === "complete" && mapping.unmappedRows !== 0)) {
    throw new Error("store_penetration_response_invalid");
  }
  const selectedCategoryId = row.selectedCategoryId === null ? null : integer(row.selectedCategoryId, true);
  if (![row.categories, row.products, row.stores, row.trend].every(Array.isArray)) {
    throw new Error("store_penetration_response_invalid");
  }
  const status = row.status as StorePenetrationAnalytics["status"];
  if (status === "complete" && (coverage.completedDays !== coverage.expectedDays || coverage.missingDates.length ||
    eligibleReceipts === null || mapping.status !== "complete")) {
    throw new Error("store_penetration_response_invalid");
  }
  if (status === "incomplete" && (eligibleReceipts !== null || coverage.completedDays === coverage.expectedDays)) {
    throw new Error("store_penetration_response_invalid");
  }
  if (status === "mapping_incomplete" && (eligibleReceipts === null || mapping.status !== "incomplete")) {
    throw new Error("store_penetration_response_invalid");
  }
  if (status !== "complete" && [row.categories, row.products, row.stores, row.trend].some((items) => (items as unknown[]).length)) {
    throw new Error("store_penetration_response_invalid");
  }
  const denominator = eligibleReceipts ?? 0;
  const categories = (row.categories as unknown[]).map((item) => {
    const value = object(item), receiptCount = integer(value.receiptCount), storeCount = integer(value.storeCount);
    if (receiptCount > denominator || storeCount > spotIds.length) throw new Error("store_penetration_response_invalid");
    const categoryId = integer(value.categoryId, true);
    return { categoryId, categoryName: `Категорія #${categoryId}`, categoryNameSource: "missing" as const,
      receiptCount, penetrationPercent: percent(value.penetrationPercent, receiptCount, denominator), storeCount };
  });
  const products = (row.products as unknown[]).map((item) => {
    const value = object(item), receiptCount = integer(value.receiptCount), storeCount = integer(value.storeCount);
    if (receiptCount > denominator || storeCount > spotIds.length) throw new Error("store_penetration_response_invalid");
    const productId = integer(value.productId, true), rawName = typeof value.productName === "string" ? value.productName.trim() : "";
    return { productId, modificationId: integer(value.modificationId), categoryId: integer(value.categoryId, true),
      productName: rawName || `Товар #${productId}`, productNameSource: rawName ? "sales_snapshot" as const : "missing" as const,
      receiptCount, penetrationPercent: percent(value.penetrationPercent, receiptCount, denominator), storeCount };
  });
  const stores = (row.stores as unknown[]).map((item) => {
    const value = object(item), storeDenominator = integer(value.eligibleReceipts), numerator = integer(value.categoryReceipts);
    if (numerator > storeDenominator) throw new Error("store_penetration_response_invalid");
    return { spotId: integer(value.spotId, true), eligibleReceipts: storeDenominator, categoryReceipts: numerator,
      penetrationPercent: percent(value.penetrationPercent, numerator, storeDenominator) };
  });
  const trend = (row.trend as unknown[]).map((item) => {
    const value = object(item), dayDenominator = integer(value.eligibleReceipts), numerator = integer(value.categoryReceipts);
    if (numerator > dayDenominator) throw new Error("store_penetration_response_invalid");
    return { date: isoDate(value.date), eligibleReceipts: dayDenominator, categoryReceipts: numerator,
      penetrationPercent: percent(value.penetrationPercent, numerator, dayDenominator) };
  });
  if (status === "complete") {
    if ((selectedCategoryId === null && (stores.length || trend.length)) ||
      (selectedCategoryId !== null && (stores.length !== spotIds.length || trend.length !== coverage.expectedDays))) {
      throw new Error("store_penetration_response_invalid");
    }
    if (selectedCategoryId !== null && (stores.reduce((sum, item) => sum + item.eligibleReceipts, 0) !== denominator ||
      trend.reduce((sum, item) => sum + item.eligibleReceipts, 0) !== denominator)) {
      throw new Error("store_penetration_response_invalid");
    }
    const selected = selectedCategoryId === null ? null : categories.find((item) => item.categoryId === selectedCategoryId);
    if (selected && (stores.reduce((sum, item) => sum + item.categoryReceipts, 0) !== selected.receiptCount ||
      trend.reduce((sum, item) => sum + item.categoryReceipts, 0) !== selected.receiptCount)) {
      throw new Error("store_penetration_response_invalid");
    }
  }
  return {
    methodologyVersion: "store-penetration-v1", asOf: row.asOf, timezone: "Europe/Kyiv", spotIds, status,
    coverage, denominator: { eligibleReceipts, definition: "distinct eligible purchase receipts in selected network scope" },
    mapping, selectedCategoryId, categories, products, stores, trend, historicalRosterVerified: false,
  };
}

export function enrichStorePenetrationCategoryNames(data: StorePenetrationAnalytics,
  currentNames: ReadonlyMap<number, string>): StorePenetrationAnalytics {
  return { ...data, categories: data.categories.map((item) => {
    const name = currentNames.get(item.categoryId);
    return name ? { ...item, categoryName: name, categoryNameSource: "current_poster_catalog" as const } : item;
  }) };
}

export async function loadStorePenetrationAnalytics(input: {
  from: string; to: string; spotIds: number[]; asOf: string; categoryId: number | null;
}): Promise<StorePenetrationAnalytics> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const { data, error } = await db.rpc("read_store_penetration_analytics", {
    p_from: input.from, p_to: input.to, p_spot_ids: input.spotIds,
    p_as_of: input.asOf, p_category_id: input.categoryId,
  });
  if (error) {
    if (["42P01", "42883", "PGRST202"].includes(error.code ?? "")) throw new Error("store_penetration_schema_missing");
    throw new Error("store_penetration_read_failed");
  }
  const parsed = parseStorePenetrationAnalytics(data);
  if (parsed.status !== "complete") return parsed;
  const currentNames = await loadCurrentPosterCategoryNames().catch(() => null);
  return currentNames ? enrichStorePenetrationCategoryNames(parsed, currentNames) : parsed;
}

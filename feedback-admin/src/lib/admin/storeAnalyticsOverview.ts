import { getServerSupabase } from "@/lib/supabase";

export type StoreAnalyticsMetrics = {
  revenueMinor: string;
  profitMinor: string;
  profitNettoMinor: string | null;
  classicFoodcostPercent: string | null;
  nettoFoodcostPercent: string | null;
};

export type StoreAnalyticsWindow = {
  from: string;
  to: string;
  status: "complete" | "incomplete";
  expectedCells: number;
  completedCells: number;
  missingCount: number;
  missing: Array<{ date: string; spotId: number }>;
  sourceFetchedOldestAt: string | null;
  sourceFetchedNewestAt: string | null;
  metrics: StoreAnalyticsMetrics | null;
  trend: Array<{ date: string; revenueMinor: string; profitMinor: string; classicFoodcostPercent: string | null }>;
  stores: Array<{ spotId: number; storeName: string; revenueMinor: string; profitMinor: string; classicFoodcostPercent: string | null }>;
  receipts: {
    status: "complete" | "incomplete";
    expectedDays: number;
    completedDays: number;
    missingDates: string[];
    receiptCount: number | null;
    identifiedClientCount: number | null;
    averageCheckMinor: null;
    averageCheckReason: "receipt_money_basis_unverified";
  };
};

export type StoreAnalyticsOverview = {
  methodologyVersion: "store-analytics-overview-v1";
  asOf: string;
  timezone: "Europe/Kyiv";
  historicalRosterVerified: false;
  spotIds: number[];
  current: StoreAnalyticsWindow;
  comparison: StoreAnalyticsWindow | null;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("store_analytics_response_invalid");
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("store_analytics_response_invalid");
  return Number(value);
}

function decimal(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("store_analytics_response_invalid");
  return value;
}

function isoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("store_analytics_response_invalid");
  return value;
}

function parseWindow(value: unknown): StoreAnalyticsWindow {
  const row = object(value);
  if (!['complete', 'incomplete'].includes(String(row.status)) || !Array.isArray(row.missing) ||
    !Array.isArray(row.trend) || !Array.isArray(row.stores)) throw new Error("store_analytics_response_invalid");
  const receipts = object(row.receipts);
  if (!['complete', 'incomplete'].includes(String(receipts.status)) || !Array.isArray(receipts.missingDates) ||
    receipts.averageCheckMinor !== null || receipts.averageCheckReason !== "receipt_money_basis_unverified") {
    throw new Error("store_analytics_response_invalid");
  }
  const metrics = row.metrics === null ? null : object(row.metrics);
  return {
    from: isoDate(row.from), to: isoDate(row.to), status: row.status as StoreAnalyticsWindow["status"],
    expectedCells: integer(row.expectedCells), completedCells: integer(row.completedCells),
    missingCount: integer(row.missingCount),
    missing: row.missing.map((item) => { const v = object(item); return { date: isoDate(v.date), spotId: integer(v.spotId) }; }),
    sourceFetchedOldestAt: typeof row.sourceFetchedOldestAt === "string" ? row.sourceFetchedOldestAt : null,
    sourceFetchedNewestAt: typeof row.sourceFetchedNewestAt === "string" ? row.sourceFetchedNewestAt : null,
    metrics: metrics ? {
      revenueMinor: decimal(metrics.revenueMinor)!, profitMinor: decimal(metrics.profitMinor)!,
      profitNettoMinor: decimal(metrics.profitNettoMinor, true),
      classicFoodcostPercent: decimal(metrics.classicFoodcostPercent, true),
      nettoFoodcostPercent: decimal(metrics.nettoFoodcostPercent, true),
    } : null,
    trend: row.trend.map((item) => { const v = object(item); return {
      date: isoDate(v.date), revenueMinor: decimal(v.revenueMinor)!, profitMinor: decimal(v.profitMinor)!,
      classicFoodcostPercent: decimal(v.classicFoodcostPercent, true),
    }; }),
    stores: row.stores.map((item) => { const v = object(item); if (typeof v.storeName !== "string") throw new Error("store_analytics_response_invalid"); return {
      spotId: integer(v.spotId), storeName: v.storeName, revenueMinor: decimal(v.revenueMinor)!,
      profitMinor: decimal(v.profitMinor)!, classicFoodcostPercent: decimal(v.classicFoodcostPercent, true),
    }; }),
    receipts: {
      status: receipts.status as "complete" | "incomplete", expectedDays: integer(receipts.expectedDays),
      completedDays: integer(receipts.completedDays), missingDates: receipts.missingDates.map(isoDate),
      receiptCount: receipts.receiptCount === null ? null : integer(receipts.receiptCount),
      identifiedClientCount: receipts.identifiedClientCount === null ? null : integer(receipts.identifiedClientCount),
      averageCheckMinor: null, averageCheckReason: "receipt_money_basis_unverified",
    },
  };
}

export function parseStoreAnalyticsOverview(value: unknown): StoreAnalyticsOverview {
  const row = object(value);
  if (row.methodologyVersion !== "store-analytics-overview-v1" || row.timezone !== "Europe/Kyiv" ||
    row.historicalRosterVerified !== false || typeof row.asOf !== "string" || !Array.isArray(row.spotIds)) {
    throw new Error("store_analytics_response_invalid");
  }
  return {
    methodologyVersion: "store-analytics-overview-v1", asOf: row.asOf,
    timezone: "Europe/Kyiv", historicalRosterVerified: false,
    spotIds: row.spotIds.map(integer), current: parseWindow(row.current),
    comparison: row.comparison === null ? null : parseWindow(row.comparison),
  };
}

export async function loadStoreAnalyticsOverview(input: {
  from: string; to: string; spotIds: number[];
  compareFrom: string | null; compareTo: string | null; asOf: string;
}): Promise<StoreAnalyticsOverview> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const { data, error } = await db.rpc("read_store_analytics_overview", {
    p_from: input.from, p_to: input.to, p_spot_ids: input.spotIds,
    p_compare_from: input.compareFrom, p_compare_to: input.compareTo, p_as_of: input.asOf,
  });
  if (error) {
    if (["42P01", "42883", "PGRST202"].includes(error.code ?? "")) throw new Error("store_analytics_schema_missing");
    throw new Error("store_analytics_read_failed");
  }
  return parseStoreAnalyticsOverview(data);
}

import type { StoreAnalyticsWindow } from "./storeAnalyticsOverview";

export type StoreAnalyticsRankingRow = {
  spotId: number;
  storeName: string;
  revenueMinor: string;
  profitMinor: string;
  classicFoodcostPercent: string | null;
  revenueSharePercent: string | null;
  comparisonRevenueMinor: string | null;
  deltaRevenueMinor: string | null;
  deltaRevenuePercent: string | null;
};

function percent(numerator: bigint, denominator: bigint): string | null {
  if (denominator <= 0n) return null;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const basisPoints = (absolute * 10_000n + denominator / 2n) / denominator;
  const whole = basisPoints / 100n;
  const fraction = String(basisPoints % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function buildStoreAnalyticsRanking(
  current: StoreAnalyticsWindow,
  comparison: StoreAnalyticsWindow | null,
): StoreAnalyticsRankingRow[] {
  if (current.status !== "complete" || !current.metrics) return [];
  const totalRevenue = BigInt(current.metrics.revenueMinor);
  const comparisonByStore = comparison?.status === "complete"
    ? new Map(comparison.stores.map((store) => [store.spotId, BigInt(store.revenueMinor)]))
    : new Map<number, bigint>();

  return current.stores.map((store) => {
    const revenue = BigInt(store.revenueMinor);
    const previous = comparisonByStore.get(store.spotId);
    const delta = previous === undefined ? null : revenue - previous;
    return {
      ...store,
      revenueSharePercent: percent(revenue, totalRevenue),
      comparisonRevenueMinor: previous === undefined ? null : previous.toString(),
      deltaRevenueMinor: delta === null ? null : delta.toString(),
      deltaRevenuePercent: delta === null || previous === undefined ? null : percent(delta, previous),
    };
  }).sort((left, right) => {
    const a = BigInt(left.revenueMinor), b = BigInt(right.revenueMinor);
    return a === b ? left.storeName.localeCompare(right.storeName, "uk") : a > b ? -1 : 1;
  });
}

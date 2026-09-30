import type { StoreAnalyticsOverview } from "./storeAnalyticsOverview";
import type { StoreCategoryProductAnalytics } from "./storeCategoryProductAnalytics";

export type ComparisonContribution = {
  id: string;
  name: string;
  currentRevenueMinor: string;
  comparisonRevenueMinor: string;
  deltaRevenueMinor: string;
  deltaRevenuePercent: string | null;
};

export type StoreAnalyticsComparison = {
  status: "complete" | "unavailable";
  reason: "current_incomplete" | "comparison_missing" | "comparison_incomplete" |
    "catalog_incomplete" | "source_mismatch" | null;
  current: { from: string; to: string; days: number; revenueMinor: string | null; revenuePerDayMinor: string | null };
  comparison: { from: string | null; to: string | null; days: number | null;
    revenueMinor: string | null; revenuePerDayMinor: string | null };
  deltaRevenueMinor: string | null;
  deltaRevenuePercent: string | null;
  storeContributions: ComparisonContribution[];
  categoryContributions: ComparisonContribution[];
  reconciliation: {
    storeContributionSumMinor: string | null;
    categoryContributionSumMinor: string | null;
    storeContributionsMatch: boolean;
    categoryContributionsMatch: boolean;
  };
};

function dateCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function divideMinor(value: bigint, divisor: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scaled = (absolute * 100n + BigInt(Math.floor(divisor / 2))) / BigInt(divisor);
  return `${negative ? "-" : ""}${scaled / 100n}.${String(scaled % 100n).padStart(2, "0")}`;
}

function percent(delta: bigint, previous: bigint): string | null {
  if (previous === 0n) return null;
  const negative = (delta < 0n) !== (previous < 0n);
  const numerator = delta < 0n ? -delta : delta;
  const denominator = previous < 0n ? -previous : previous;
  const scaled = (numerator * 10_000n + denominator / 2n) / denominator;
  return `${negative ? "-" : ""}${scaled / 100n}.${String(scaled % 100n).padStart(2, "0")}`;
}

function unavailable(overview: StoreAnalyticsOverview, reason: Exclude<StoreAnalyticsComparison["reason"], null>): StoreAnalyticsComparison {
  const previous = overview.comparison;
  return {
    status: "unavailable", reason,
    current: { from: overview.current.from, to: overview.current.to,
      days: dateCount(overview.current.from, overview.current.to), revenueMinor: null, revenuePerDayMinor: null },
    comparison: { from: previous?.from ?? null, to: previous?.to ?? null,
      days: previous ? dateCount(previous.from, previous.to) : null, revenueMinor: null, revenuePerDayMinor: null },
    deltaRevenueMinor: null, deltaRevenuePercent: null, storeContributions: [], categoryContributions: [],
    reconciliation: { storeContributionSumMinor: null, categoryContributionSumMinor: null,
      storeContributionsMatch: false, categoryContributionsMatch: false },
  };
}

function contribution(id: string, name: string, current: bigint, previous: bigint): ComparisonContribution {
  const delta = current - previous;
  return { id, name, currentRevenueMinor: current.toString(), comparisonRevenueMinor: previous.toString(),
    deltaRevenueMinor: delta.toString(), deltaRevenuePercent: percent(delta, previous) };
}

export function buildStoreAnalyticsComparison(overview: StoreAnalyticsOverview,
  catalog: StoreCategoryProductAnalytics): StoreAnalyticsComparison {
  if (overview.current.status !== "complete" || !overview.current.metrics) return unavailable(overview, "current_incomplete");
  if (!overview.comparison) return unavailable(overview, "comparison_missing");
  if (overview.comparison.status !== "complete" || !overview.comparison.metrics) return unavailable(overview, "comparison_incomplete");
  if (catalog.current.status !== "complete" || catalog.comparison?.status !== "complete") return unavailable(overview, "catalog_incomplete");

  const sameScope = overview.asOf === catalog.asOf && overview.current.from === catalog.current.from &&
    overview.current.to === catalog.current.to && overview.comparison.from === catalog.comparison.from &&
    overview.comparison.to === catalog.comparison.to && overview.spotIds.join(",") === catalog.spotIds.join(",");
  const currentTotal = BigInt(overview.current.metrics.revenueMinor);
  const previousTotal = BigInt(overview.comparison.metrics.revenueMinor);
  if (!sameScope || catalog.current.totalRevenueMinor !== currentTotal.toString() ||
    catalog.comparison.totalRevenueMinor !== previousTotal.toString()) return unavailable(overview, "source_mismatch");

  const currentStores = new Map(overview.current.stores.map((row) => [row.spotId, row]));
  const previousStores = new Map(overview.comparison.stores.map((row) => [row.spotId, row]));
  const storeIds = [...new Set([...currentStores.keys(), ...previousStores.keys()])].sort((a, b) => a - b);
  const storeContributions = storeIds.map((spotId) => {
    const current = currentStores.get(spotId), previous = previousStores.get(spotId);
    return contribution(String(spotId), current?.storeName ?? previous?.storeName ?? `Магазин #${spotId}`,
      BigInt(current?.revenueMinor ?? "0"), BigInt(previous?.revenueMinor ?? "0"));
  }).sort((a, b) => {
    const left = BigInt(a.deltaRevenueMinor), right = BigInt(b.deltaRevenueMinor);
    const absLeft = left < 0n ? -left : left, absRight = right < 0n ? -right : right;
    return absLeft === absRight ? a.name.localeCompare(b.name, "uk") : absLeft > absRight ? -1 : 1;
  });

  const categoryContributions = catalog.categories.map((row) => contribution(
    row.categoryId === null ? "unknown" : String(row.categoryId), row.categoryName,
    BigInt(row.revenueMinor), BigInt(row.previousRevenueMinor ?? "0"),
  )).sort((a, b) => {
    const left = BigInt(a.deltaRevenueMinor), right = BigInt(b.deltaRevenueMinor);
    const absLeft = left < 0n ? -left : left, absRight = right < 0n ? -right : right;
    return absLeft === absRight ? a.name.localeCompare(b.name, "uk") : absLeft > absRight ? -1 : 1;
  });
  const totalDelta = currentTotal - previousTotal;
  const storeSum = storeContributions.reduce((sum, row) => sum + BigInt(row.deltaRevenueMinor), 0n);
  const categorySum = categoryContributions.reduce((sum, row) => sum + BigInt(row.deltaRevenueMinor), 0n);
  const currentDays = dateCount(overview.current.from, overview.current.to);
  const previousDays = dateCount(overview.comparison.from, overview.comparison.to);
  return {
    status: "complete", reason: null,
    current: { from: overview.current.from, to: overview.current.to, days: currentDays,
      revenueMinor: currentTotal.toString(), revenuePerDayMinor: divideMinor(currentTotal, currentDays) },
    comparison: { from: overview.comparison.from, to: overview.comparison.to, days: previousDays,
      revenueMinor: previousTotal.toString(), revenuePerDayMinor: divideMinor(previousTotal, previousDays) },
    deltaRevenueMinor: totalDelta.toString(), deltaRevenuePercent: percent(totalDelta, previousTotal),
    storeContributions, categoryContributions,
    reconciliation: { storeContributionSumMinor: storeSum.toString(), categoryContributionSumMinor: categorySum.toString(),
      storeContributionsMatch: storeSum === totalDelta, categoryContributionsMatch: categorySum === totalDelta },
  };
}

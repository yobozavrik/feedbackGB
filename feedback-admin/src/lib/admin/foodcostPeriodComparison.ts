import type { SalesMetrics } from "./posterSalesMath";

export type FoodcostComparisonPeriodInput = {
  status: "complete" | "incomplete";
  from: string;
  to: string;
  expectedCells: number;
  completedCells: number;
  metrics: SalesMetrics | null;
};

export type FoodcostComparisonPeriod = FoodcostComparisonPeriodInput & {
  reasonCode: "coverage_incomplete" | "not_evaluated" | null;
};

export type FoodcostPeriodComparison = {
  asOf: string;
  current: FoodcostComparisonPeriod;
  previous: FoodcostComparisonPeriod;
  paidDeltaPercent: number | null;
  foodCostDeltaPoints: number | null;
  nettoFoodCostDeltaPoints: number | null;
  methodGapDeltaPoints: number | null;
};

function period(input: FoodcostComparisonPeriodInput | null, fallback: {
  from: string; to: string; expectedCells: number;
}, reasonCode: FoodcostComparisonPeriod["reasonCode"]): FoodcostComparisonPeriod {
  if (input) return { ...input, reasonCode: input.status === "complete" ? null : "coverage_incomplete" };
  return { status: "incomplete", from: fallback.from, to: fallback.to,
    expectedCells: fallback.expectedCells, completedCells: 0, metrics: null, reasonCode };
}

function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  // Convert to bigint before subtraction so opposite signed safe-integer totals
  // cannot lose precision in the difference.
  const deltaMinor = BigInt(current) - BigInt(previous);
  return Number(deltaMinor) / previous * 100;
}

export function buildFoodcostPeriodComparison(input: {
  asOf: string;
  current: FoodcostComparisonPeriodInput;
  previous: FoodcostComparisonPeriodInput | null;
  previousWindow: { from: string; to: string; expectedCells: number };
}): FoodcostPeriodComparison {
  const current = period(input.current, input.current, null);
  const previous = period(input.previous, input.previousWindow,
    input.current.status === "complete" ? "coverage_incomplete" : "not_evaluated");
  const currentMetrics = current.status === "complete" ? current.metrics : null;
  const previousMetrics = previous.status === "complete" ? previous.metrics : null;
  const canCompare = currentMetrics !== null && previousMetrics !== null;
  const currentGap = currentMetrics?.foodCostPercent !== null && currentMetrics?.foodCostPercent !== undefined &&
    currentMetrics.nettoFoodCostPercent !== null ? currentMetrics.foodCostPercent - currentMetrics.nettoFoodCostPercent : null;
  const previousGap = previousMetrics?.foodCostPercent !== null && previousMetrics?.foodCostPercent !== undefined &&
    previousMetrics.nettoFoodCostPercent !== null ? previousMetrics.foodCostPercent - previousMetrics.nettoFoodCostPercent : null;
  return {
    asOf: input.asOf,
    current,
    previous,
    paidDeltaPercent: canCompare
      ? percentDelta(currentMetrics.payedSumMinor, previousMetrics.payedSumMinor) : null,
    foodCostDeltaPoints: canCompare && currentMetrics.foodCostPercent !== null && previousMetrics.foodCostPercent !== null
      ? currentMetrics.foodCostPercent - previousMetrics.foodCostPercent : null,
    nettoFoodCostDeltaPoints: canCompare && currentMetrics.nettoFoodCostPercent !== null &&
      previousMetrics.nettoFoodCostPercent !== null
      ? currentMetrics.nettoFoodCostPercent - previousMetrics.nettoFoodCostPercent : null,
    methodGapDeltaPoints: canCompare && currentGap !== null && previousGap !== null
      ? currentGap - previousGap : null,
  };
}

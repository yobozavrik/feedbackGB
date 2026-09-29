import { describe, expect, it } from "vitest";
import { buildFoodcostPeriodComparison, type FoodcostComparisonPeriodInput } from "../foodcostPeriodComparison";

function completePeriod(overrides: Partial<FoodcostComparisonPeriodInput> = {}): FoodcostComparisonPeriodInput {
  return {
    status: "complete", from: "2026-09-18", to: "2026-09-24", expectedCells: 182, completedCells: 182,
    metrics: {
      payedSumMinor: 20_000, productProfitMinor: 12_000, productProfitNettoMinor: 13_000,
      inferredCostMinor: 8_000, nettoInferredCostMinor: 7_000,
      foodCostPercent: 40, nettoFoodCostPercent: 35,
    },
    ...overrides,
  };
}

describe("equal-period food-cost comparison", () => {
  it("compares summed minor-unit metrics from two complete seven-day windows", () => {
    const current = completePeriod();
    const previous = completePeriod({ from: "2026-09-11", to: "2026-09-17", expectedCells: 182,
      completedCells: 182, metrics: {
        payedSumMinor: 10_000, productProfitMinor: 7_000, productProfitNettoMinor: 7_500,
        inferredCostMinor: 3_000, nettoInferredCostMinor: 2_500,
        foodCostPercent: 30, nettoFoodCostPercent: 25,
      } });
    const result = buildFoodcostPeriodComparison({ asOf: "2026-09-25T00:30:00.000Z", current,
      previous, previousWindow: { from: previous.from, to: previous.to, expectedCells: 182 } });
    expect(result).toMatchObject({ paidDeltaPercent: 100, foodCostDeltaPoints: 10,
      nettoFoodCostDeltaPoints: 10, methodGapDeltaPoints: 0,
      current: { status: "complete", completedCells: 182 },
      previous: { status: "complete", completedCells: 182 } });
  });

  it("keeps a complete 14-day current period when the previous 14 days lack coverage", () => {
    const current = completePeriod({ from: "2026-09-11", to: "2026-09-24", expectedCells: 364,
      completedCells: 364 });
    const previous = completePeriod({ status: "incomplete", from: "2026-08-28", to: "2026-09-10",
      expectedCells: 364, completedCells: 26, metrics: null });
    const result = buildFoodcostPeriodComparison({ asOf: "2026-09-25T00:30:00.000Z", current,
      previous, previousWindow: { from: previous.from, to: previous.to, expectedCells: 364 } });
    expect(result.current).toMatchObject({ status: "complete", metrics: current.metrics });
    expect(result.previous).toMatchObject({ status: "incomplete", completedCells: 26, reasonCode: "coverage_incomplete" });
    expect(result.paidDeltaPercent).toBeNull();
    expect(result.foodCostDeltaPoints).toBeNull();
  });

  it.each([30, 60] as const)("does not publish partial current values for an incomplete %d-day window", (days) => {
    const cells = days * 26;
    const current = completePeriod({ status: "incomplete", from: "2026-08-26", to: "2026-09-24",
      expectedCells: cells, completedCells: 390, metrics: null });
    const result = buildFoodcostPeriodComparison({ asOf: "2026-09-25T00:30:00.000Z", current,
      previous: null, previousWindow: { from: "2026-06-27", to: "2026-08-25", expectedCells: cells } });
    expect(result.current).toMatchObject({ status: "incomplete", metrics: null, expectedCells: cells });
    expect(result.previous).toMatchObject({ status: "incomplete", metrics: null, reasonCode: "not_evaluated" });
    expect(result.paidDeltaPercent).toBeNull();
    expect(result.foodCostDeltaPoints).toBeNull();
    expect(result.nettoFoodCostDeltaPoints).toBeNull();
  });

  it("reports paid percentage only with positive previous paid, and keeps missing netto unavailable", () => {
    const current = completePeriod({ metrics: { ...completePeriod().metrics!, payedSumMinor: 15_000,
      nettoFoodCostPercent: null } });
    const previous = completePeriod({ from: "2026-09-11", to: "2026-09-17",
      metrics: { ...completePeriod().metrics!, payedSumMinor: 0, nettoFoodCostPercent: null } });
    const result = buildFoodcostPeriodComparison({ asOf: "2026-09-25T00:30:00.000Z", current,
      previous, previousWindow: { from: previous.from, to: previous.to, expectedCells: 182 } });
    expect(result.paidDeltaPercent).toBeNull();
    expect(result.nettoFoodCostDeltaPoints).toBeNull();
    expect(result.foodCostDeltaPoints).toBe(0);
  });
});

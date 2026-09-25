/** Approved network-wide bands for both Poster sales-derived food-cost methods. */
export const FOODCOST_GREEN_BELOW = 35;
export const FOODCOST_YELLOW_THROUGH = 45;

export type FoodcostBand = "green" | "yellow" | "red" | "unknown";

export function foodcostBand(value: number | null | undefined): FoodcostBand {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  if (value < FOODCOST_GREEN_BELOW) return "green";
  if (value <= FOODCOST_YELLOW_THROUGH) return "yellow";
  return "red";
}

export const FOODCOST_PERIOD_OPTIONS = [7, 14, 30, 60] as const;
export type FoodcostPeriodDays = typeof FOODCOST_PERIOD_OPTIONS[number];

export function parseFoodcostPeriodDays(value: string | null | undefined): FoodcostPeriodDays {
  if (value === null || value === undefined || value === "") return 7;
  const parsed = Number(value);
  if (!FOODCOST_PERIOD_OPTIONS.includes(parsed as FoodcostPeriodDays) || String(parsed) !== value) {
    throw new Error("invalid_foodcost_period");
  }
  return parsed as FoodcostPeriodDays;
}

export function lastClosedKyivDates(days: FoodcostPeriodDays, now = new Date()): string[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value;
  const today = `${value("year")}-${value("month")}-${value("day")}`;
  const midnight = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) =>
    new Date(midnight - (index + 1) * 86_400_000).toISOString().slice(0, 10));
}

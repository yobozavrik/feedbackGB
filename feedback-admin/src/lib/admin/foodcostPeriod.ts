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

export type FoodcostPeriodWindow = {
  from: string;
  to: string;
  dates: string[];
};

export type FoodcostPeriodWindows = {
  current: FoodcostPeriodWindow;
  previous: FoodcostPeriodWindow;
};

function addCalendarDays(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error("invalid_foodcost_period");
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}

/** Two adjacent, equal windows of closed Europe/Kyiv calendar dates. */
export function foodcostPeriodWindows(days: FoodcostPeriodDays, now = new Date()): FoodcostPeriodWindows {
  const currentDates = lastClosedKyivDates(days, now);
  const currentFrom = currentDates[currentDates.length - 1];
  const previousTo = addCalendarDays(currentFrom, -1);
  const previousDates = Array.from({ length: days }, (_, index) => addCalendarDays(previousTo, -index));
  return {
    current: { from: currentFrom, to: currentDates[0], dates: currentDates },
    previous: { from: previousDates[previousDates.length - 1], to: previousDates[0], dates: previousDates },
  };
}

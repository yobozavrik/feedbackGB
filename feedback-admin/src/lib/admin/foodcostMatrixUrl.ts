import type { FoodcostPeriodDays } from "./foodcostPeriod";

export type FoodcostMatrixMethod = "profit" | "netto";
export type FoodcostMatrixCategoryKey = "all" | "__unknown" | "__conflict" | `${number}`;

export function parseFoodcostMatrixMethod(value: string | null | undefined): FoodcostMatrixMethod {
  return value === "netto" ? "netto" : "profit";
}

/** Invalid category values are discarded before they can be used as a filter or query input. */
export function parseFoodcostMatrixCategoryKey(value: string | null | undefined): FoodcostMatrixCategoryKey {
  if (value === "__unknown" || value === "__conflict") return value;
  if (value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) return value as `${number}`;
  return "all";
}

export function updateFoodcostMatrixUrl(currentHref: string, update: {
  method?: FoodcostMatrixMethod;
  categoryKey?: FoodcostMatrixCategoryKey;
}): string {
  const url = new URL(currentHref);
  if (update.method) url.searchParams.set("method", update.method);
  if (update.categoryKey !== undefined) {
    if (update.categoryKey === "all") url.searchParams.delete("category_id");
    else url.searchParams.set("category_id", update.categoryKey);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Pass null so Next's patched History API copies its internal router state and updates useSearchParams. */
export function pushFoodcostMatrixUrlState(history: Pick<History, "pushState">, currentHref: string, update: {
  method?: FoodcostMatrixMethod;
  categoryKey?: FoodcostMatrixCategoryKey;
}): void {
  history.pushState(null, "", updateFoodcostMatrixUrl(currentHref, update));
}

export function foodcostMatrixReturnHref(input: {
  days: FoodcostPeriodDays;
  spotId?: number;
  method: FoodcostMatrixMethod;
  categoryKey: FoodcostMatrixCategoryKey;
}): string {
  const params = new URLSearchParams({ tab: "matrix", days: String(input.days), method: input.method });
  if (input.spotId !== undefined) params.set("spot_id", String(input.spotId));
  if (input.categoryKey !== "all") params.set("category_id", input.categoryKey);
  return `/admin/technologist/food-cost?${params.toString()}`;
}

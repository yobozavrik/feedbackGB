import { getServerSupabase } from "@/lib/supabase";
import { loadFoodcostOverview } from "./foodcostOverview";
import { loadFoodcostSalesPeriod } from "./foodcostSalesRead";
import { posterRequest } from "./posterApi";
import { lastThreeClosedKyivDates, posterSpotIds } from "./posterSalesSync";

/**
 * Only the CURRENT Poster/v_stores roster is known. This deliberately does not
 * claim historical network completeness outside the three-day rolling window.
 */
export async function loadVerifiedCurrentFoodcostSpotIds(): Promise<number[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("poster_token_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");

  const [posterSpots, stores] = await Promise.all([
    posterRequest<unknown>("access.getSpots", {}, token),
    db.from("v_stores").select("id").order("id"),
  ]);
  if (stores.error) throw new Error("foodcost_roster_unavailable");
  const spotIds = posterSpotIds(posterSpots);
  const localIds = (stores.data ?? []).map((row) => Number(row.id));
  if (localIds.length !== spotIds.length ||
    localIds.some((id, index) => !Number.isSafeInteger(id) || id !== spotIds[index])) {
    throw new Error("foodcost_roster_mismatch");
  }
  return spotIds;
}

export async function loadFoodcostRecentNetwork(now = new Date()) {
  const spotIds = await loadVerifiedCurrentFoodcostSpotIds();
  const dates = lastThreeClosedKyivDates(now);
  const overview = await loadFoodcostOverview(dates[2], dates[0], spotIds);
  return {
    scope: "current_poster_roster_three_closed_days" as const,
    historicalRosterVerified: false,
    rosterCheckedAt: new Date().toISOString(),
    spotCount: spotIds.length,
    ...overview,
  };
}

function currentPosterCategoryNames(value: unknown): Map<number, string> {
  if (!Array.isArray(value) || !value.length || value.length > 1000) {
    throw new Error("poster_categories_invalid_response");
  }
  const names = new Map<number, string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error("poster_categories_invalid_response");
    const row = entry as { category_id?: unknown; category_name?: unknown };
    const id = Number(row.category_id);
    const name = typeof row.category_name === "string" ? row.category_name.trim() : "";
    if (!Number.isSafeInteger(id) || id <= 0 || !name ||
      (names.has(id) && names.get(id) !== name)) throw new Error("poster_categories_invalid_response");
    names.set(id, name);
  }
  return names;
}

/** Fact-backed breakdown; never return partial category or product metrics. */
export async function loadFoodcostRecentBreakdown(now = new Date()) {
  const spotIds = await loadVerifiedCurrentFoodcostSpotIds();
  const dates = lastThreeClosedKyivDates(now);
  const snapshot = await loadFoodcostSalesPeriod(dates, spotIds);
  // The sales API omits category names in this account. Current Poster menu is
  // only a display fallback; it never rewrites historical category IDs or sums.
  const currentNames = snapshot.status === "complete"
    ? await posterRequest<unknown>("menu.getCategories", {}, process.env.POSTER_TOKEN!)
      .then(currentPosterCategoryNames).catch(() => null)
    : null;
  const categories = snapshot.categories?.map((row) => {
    const currentName = row.categoryId === null ? null : currentNames?.get(row.categoryId) ?? null;
    const displayName = row.categoryNameConflict ? currentName : row.categoryName ?? currentName;
    const nameSource = row.categoryNameConflict
      ? currentName ? "current_poster_catalog" : null
      : row.categoryName ? "sales_snapshot" : currentName ? "current_poster_catalog" : null;
    return { ...row, displayName, nameSource };
  }) ?? null;
  const categoriesWithoutDisplayName = categories?.filter((row) => row.categoryId !== null && !row.displayName).length ?? 0;
  return {
    scope: "current_poster_roster_three_closed_days" as const,
    historicalRosterVerified: false,
    methodologyVersion: "poster-sales-dual-v1" as const,
    dateFrom: dates[2], dateTo: dates[0], spotCount: spotIds.length, spotIds,
    ...snapshot,
    currentCategoryNamesAvailable: currentNames !== null,
    categoriesWithoutDisplayName,
    categories,
  };
}

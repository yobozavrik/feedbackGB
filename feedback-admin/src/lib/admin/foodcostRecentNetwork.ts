import { getServerSupabase } from "@/lib/supabase";
import { loadFoodcostOverview } from "./foodcostOverview";
import { posterRequest } from "./posterApi";
import { lastThreeClosedKyivDates, posterSpotIds } from "./posterSalesSync";

/**
 * Only the CURRENT Poster/v_stores roster is known. This deliberately does not
 * claim historical network completeness outside the three-day rolling window.
 */
export async function loadFoodcostRecentNetwork(now = new Date()) {
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

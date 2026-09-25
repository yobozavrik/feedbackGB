import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { loadFoodcostRecentBreakdown } from "@/lib/admin/foodcostRecentNetwork";
import { parseFoodcostSpotId } from "@/lib/admin/foodcostScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/** Current Poster roster and three closed Kyiv dates only. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!await requireAdminSession("super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  let spotId: number | undefined;
  try { spotId = parseFoodcostSpotId(new URL(request.url).searchParams.get("spot_id")); }
  catch { return NextResponse.json({ error: "invalid_foodcost_spot" }, { status: 400, headers: NO_STORE }); }
  try {
    const data = await loadFoodcostRecentBreakdown(new Date(), spotId);
    const response = {
      scope: data.scope, historicalRosterVerified: data.historicalRosterVerified,
      methodologyVersion: data.methodologyVersion,
      dateFrom: data.dateFrom, dateTo: data.dateTo, spotCount: data.spotCount,
      status: data.status, expectedCells: data.expectedCells, completedCells: data.completedCells,
      missing: data.missing, sourceFetchedAt: data.sourceFetchedAt,
      metrics: data.metrics, categories: data.categories,
      currentCategoryNamesAvailable: data.currentCategoryNamesAvailable,
      categoriesWithoutDisplayName: data.categoriesWithoutDisplayName,
    };
    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    if (code === "invalid_foodcost_spot") {
      return NextResponse.json({ error: code }, { status: 400, headers: NO_STORE });
    }
    const unavailable = ["schema_missing", "service_role_missing", "poster_token_missing",
      "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
      "poster_unavailable", "poster_invalid_response"].includes(code);
    return NextResponse.json({ error: unavailable ? "foodcost_source_unavailable" :
      "foodcost_categories_unavailable" }, { status: unavailable ? 503 : 500, headers: NO_STORE });
  }
}

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { loadFoodcostOverview } from "@/lib/admin/foodcostOverview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read-only single-store endpoint. Network scope needs historical spot roster. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!await requireAdminSession("super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const search = new URL(request.url).searchParams;
  const from = search.get("from");
  const to = search.get("to");
  const rawSpotId = search.get("spot_id");
  const spotId = Number(rawSpotId);
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to) ||
    !rawSpotId || !/^\d+$/.test(rawSpotId) || !Number.isSafeInteger(spotId) || spotId <= 0) {
    return NextResponse.json({ error: "invalid_foodcost_scope" }, { status: 400, headers: NO_STORE });
  }
  try {
    const overview = await loadFoodcostOverview(from, to, [spotId]);
    return NextResponse.json({ scope: "single_poster_spot", spotId, ...overview }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    if (code === "invalid_foodcost_period" || code === "foodcost_period_too_long") {
      return NextResponse.json({ error: code }, { status: 400, headers: NO_STORE });
    }
    if (code === "schema_missing" || code === "service_role_missing" || code === "supabase_missing") {
      return NextResponse.json({ error: "foodcost_source_unavailable" }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json({ error: "foodcost_overview_unavailable" }, { status: 500, headers: NO_STORE });
  }
}

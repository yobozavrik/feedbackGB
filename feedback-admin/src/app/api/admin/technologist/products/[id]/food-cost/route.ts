import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { loadFoodcostRecentBreakdown } from "@/lib/admin/foodcostRecentNetwork";
import { parseFoodcostSpotId } from "@/lib/admin/foodcostScope";
import { parseFoodcostPeriodDays } from "@/lib/admin/foodcostPeriod";
import { buildFoodcostProductDetail } from "@/lib/admin/foodcostProductDetail";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/** Verified current roster and selected closed Kyiv days. No raw sale rows. */
export async function GET(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!await requireAdminSession("super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const productId = Number(params.id);
  if (!/^[1-9]\d*$/.test(params.id) || !Number.isSafeInteger(productId)) {
    return NextResponse.json({ error: "invalid_product_id" }, { status: 400, headers: NO_STORE });
  }
  let spotId: number | undefined;
  let days;
  try {
    const params = new URL(request.url).searchParams;
    spotId = parseFoodcostSpotId(params.get("spot_id"));
    days = parseFoodcostPeriodDays(params.get("days"));
  } catch { return NextResponse.json({ error: "invalid_foodcost_scope" }, { status: 400, headers: NO_STORE }); }
  try {
    const data = await loadFoodcostRecentBreakdown(new Date(), spotId, days);
    if (data.status !== "complete") {
      return NextResponse.json(buildFoodcostProductDetail(data, productId, new Map()), { headers: NO_STORE });
    }
    const db = getServerSupabase();
    if (!db) throw new Error("supabase_missing");
    const stores = await db.from("v_stores").select("id,name").in("id", data.spotIds).order("id");
    if (stores.error) throw new Error("foodcost_store_names_unavailable");
    const names = new Map((stores.data ?? []).map((row) => [Number(row.id), String(row.name ?? "").trim()]));
    return NextResponse.json(buildFoodcostProductDetail(data, productId, names), { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    if (code === "invalid_foodcost_spot") {
      return NextResponse.json({ error: code }, { status: 400, headers: NO_STORE });
    }
    const unavailable = ["schema_missing", "service_role_missing", "poster_token_missing",
      "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
      "poster_unavailable", "poster_invalid_response", "foodcost_store_names_unavailable",
      "foodcost_store_names_mismatch"].includes(code);
    return NextResponse.json({ error: unavailable ? "foodcost_source_unavailable" :
      "foodcost_product_unavailable" }, { status: unavailable ? 503 : 500, headers: NO_STORE });
  }
}

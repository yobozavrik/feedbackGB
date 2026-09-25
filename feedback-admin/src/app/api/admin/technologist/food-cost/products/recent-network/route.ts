import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { loadFoodcostRecentBreakdown } from "@/lib/admin/foodcostRecentNetwork";
import { buildFoodcostProductPage, parseProductQuery } from "@/lib/admin/foodcostProductPage";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/** Bounded current-roster window; returns aggregates, never raw sale rows. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!await requireAdminSession("super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  let query;
  try {
    query = parseProductQuery(new URL(request.url));
  } catch {
    return NextResponse.json({ error: "invalid_query" }, { status: 400, headers: NO_STORE });
  }
  try {
    const data = await loadFoodcostRecentBreakdown();
    const page = buildFoodcostProductPage(data, query);
    if (!page.products?.length) return NextResponse.json(page, { headers: NO_STORE });
    const db = getServerSupabase();
    if (!db) throw new Error("supabase_missing");
    const catalog = await db.from("v_products").select("id")
      .in("id", page.products.map((row) => row.productId)).limit(query.pageSize);
    if (catalog.error) throw new Error("foodcost_catalog_unavailable");
    const catalogIds = new Set((catalog.data ?? []).map((row) => Number(row.id)));
    return NextResponse.json({ ...page, products: page.products.map((row) => ({
      ...row, currentCatalogPresent: catalogIds.has(row.productId),
    })) }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    const unavailable = ["schema_missing", "service_role_missing", "poster_token_missing",
      "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
      "poster_unavailable", "poster_invalid_response", "foodcost_catalog_unavailable"].includes(code);
    return NextResponse.json({ error: unavailable ? "foodcost_source_unavailable" :
      "foodcost_products_unavailable" }, { status: unavailable ? 503 : 500, headers: NO_STORE });
  }
}

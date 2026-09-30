import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";
import { parseStoreAnalyticsQuery } from "@/lib/admin/storeAnalyticsQuery";
import { resolveAnalyticsSpotIds } from "@/lib/admin/analyticsScope";
import { loadStoreAnalyticsOverview } from "@/lib/admin/storeAnalyticsOverview";
import { loadStoreCategoryProductAnalytics } from "@/lib/admin/storeCategoryProductAnalytics";
import { buildStoreAnalyticsComparison } from "@/lib/admin/storeAnalyticsComparison";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

export async function GET(request: Request) {
  if (!await requireAdminSession("super_admin")) return response({ error: "forbidden" }, 403);
  let query;
  try {
    query = parseStoreAnalyticsQuery(new URL(request.url).searchParams, new Date());
    if (query.view !== "comparison") return response({ error: "invalid_store_analytics_view" }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "invalid_store_analytics_query" }, 400);
  }
  const db = getServerSupabase();
  if (!db) return response({ error: "store_analytics_source_unavailable" }, 503);
  const roster = await db.from("v_stores").select("id").eq("is_active", true).order("id");
  if (roster.error) return response({ error: "store_analytics_source_unavailable" }, 503);
  let spotIds: number[];
  try {
    spotIds = resolveAnalyticsSpotIds(query.scope, (roster.data ?? []).map((row) => Number(row.id)));
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "invalid_analytics_scope" }, 400);
  }
  if (!query.period.closed) return response({ error: "store_analytics_closed_period_required" }, 400);
  const comparison = query.period.comparison.status === "available" ? query.period.comparison.window : null;
  const input = { from: query.period.closed.from, to: query.period.closed.to, spotIds,
    compareFrom: comparison?.from ?? null, compareTo: comparison?.to ?? null, asOf: query.period.resolvedAt };
  try {
    const [overview, catalog] = await Promise.all([
      loadStoreAnalyticsOverview(input),
      loadStoreCategoryProductAnalytics({ ...input, categoryId: null, productId: null, modificationId: null,
        search: "", sort: "revenue", direction: "desc", page: 1, pageSize: 25 }),
    ]);
    return response({ query: { view: query.view, period: query.period, spotIds },
      data: buildStoreAnalyticsComparison(overview, catalog) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "store_comparison_unavailable";
    if (["store_analytics_schema_missing", "store_catalog_schema_missing"].includes(code)) {
      return response({ error: "store_comparison_schema_missing" }, 503);
    }
    console.error(JSON.stringify({ event: "store_analytics_comparison", code }));
    return response({ error: "store_comparison_unavailable" }, 500);
  }
}

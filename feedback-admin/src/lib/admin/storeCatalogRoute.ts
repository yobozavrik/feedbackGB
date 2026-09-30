import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";
import { parseStoreAnalyticsQuery, type StoreAnalyticsView } from "./storeAnalyticsQuery";
import { resolveAnalyticsSpotIds } from "./analyticsScope";
import { loadStoreCategoryProductAnalytics } from "./storeCategoryProductAnalytics";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

export async function serveStoreCatalogView(request: Request, expectedView: Extract<StoreAnalyticsView, "categories" | "products">) {
  if (!await requireAdminSession("super_admin")) return response({ error: "forbidden" }, 403);
  let query;
  try {
    query = parseStoreAnalyticsQuery(new URL(request.url).searchParams, new Date());
    if (query.view !== expectedView) return response({ error: "invalid_store_analytics_view" }, 400);
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
  try {
    const data = await loadStoreCategoryProductAnalytics({
      from: query.period.closed.from, to: query.period.closed.to, spotIds,
      compareFrom: comparison?.from ?? null, compareTo: comparison?.to ?? null,
      asOf: query.period.resolvedAt, categoryId: query.categoryId, productId: query.productId,
      modificationId: query.modificationId, search: query.search, sort: query.sort,
      direction: query.direction, page: query.page, pageSize: query.pageSize,
    });
    return response({ query: { view: query.view, period: query.period, spotIds,
      categoryId: query.categoryId, productId: query.productId, modificationId: query.modificationId,
      page: query.page, pageSize: query.pageSize, search: query.search, sort: query.sort, direction: query.direction }, data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "store_catalog_unavailable";
    if (code === "store_catalog_schema_missing") return response({ error: code }, 503);
    console.error(JSON.stringify({ event: "store_catalog_analytics", view: expectedView, code }));
    return response({ error: "store_catalog_unavailable" }, 500);
  }
}

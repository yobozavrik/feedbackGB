import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";
import { parseStoreAnalyticsQuery } from "@/lib/admin/storeAnalyticsQuery";
import { resolveAnalyticsSpotIds } from "@/lib/admin/analyticsScope";
import { loadStoreAnalyticsOverview } from "@/lib/admin/storeAnalyticsOverview";
import { loadStoreCategoryProductAnalytics } from "@/lib/admin/storeCategoryProductAnalytics";
import { loadStorePenetrationAnalytics } from "@/lib/admin/storePenetrationAnalytics";
import { buildCsv, type CsvCell } from "@/lib/admin/storeAnalyticsCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });

function csv(filename: string, headers: string[], rows: CsvCell[][]) {
  return new Response(buildCsv(headers, rows), { status: 200, headers: {
    ...PRIVATE_HEADERS, "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  } });
}

export async function GET(request: Request) {
  if (!await requireAdminSession("super_admin")) return json({ error: "forbidden" }, 403);
  let query;
  try {
    query = parseStoreAnalyticsQuery(new URL(request.url).searchParams, new Date());
    if (!["overview", "stores", "categories", "products", "penetration", "quality"].includes(query.view)) {
      return json({ error: "store_analytics_export_view_unsupported" }, 400);
    }
    if (query.view === "penetration" && query.categoryId === "unknown") {
      return json({ error: "invalid_store_penetration_category" }, 400);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid_store_analytics_query" }, 400);
  }
  const db = getServerSupabase();
  if (!db) return json({ error: "store_analytics_source_unavailable" }, 503);
  const roster = await db.from("v_stores").select("id,name").eq("is_active", true).order("id");
  if (roster.error) return json({ error: "store_analytics_source_unavailable" }, 503);
  const names = new Map((roster.data ?? []).map((row) => [Number(row.id), String(row.name ?? `#${row.id}`)]));
  let spotIds: number[];
  try {
    spotIds = resolveAnalyticsSpotIds(query.scope, [...names.keys()]);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid_analytics_scope" }, 400);
  }
  if (!query.period.closed) return json({ error: "store_analytics_closed_period_required" }, 400);
  const { from, to } = query.period.closed;
  const comparison = query.period.comparison.status === "available" ? query.period.comparison.window : null;

  try {
    if (["overview", "stores", "quality"].includes(query.view)) {
      const data = await loadStoreAnalyticsOverview({ from, to, spotIds,
        compareFrom: comparison?.from ?? null, compareTo: comparison?.to ?? null, asOf: query.period.resolvedAt });
      if (query.view === "quality") {
        const rows: CsvCell[][] = [["sales", data.current.status, data.current.expectedCells, data.current.completedCells,
          data.current.missingCount, "", "", "", data.asOf],
        ["receipts", data.current.receipts.status, data.current.receipts.expectedDays,
          data.current.receipts.completedDays, data.current.receipts.missingDates.length, "", "", "", data.asOf]];
        for (const missing of data.current.missing) rows.push(["sales_missing", "missing", "", "", "",
          missing.date, missing.spotId, names.get(missing.spotId) ?? `#${missing.spotId}`, data.asOf]);
        for (const date of data.current.receipts.missingDates) rows.push(["receipt_missing", "missing", "", "", "", date, "", "", data.asOf]);
        return csv(`stores-quality-${from}-${to}.csv`,
          ["source", "status", "expected", "completed", "missing_count", "date", "spot_id", "store_name", "as_of"], rows);
      }
      if (data.current.status !== "complete") return json({ error: "store_analytics_export_incomplete" }, 409);
      return csv(`stores-${from}-${to}.csv`, ["period_from", "period_to", "spot_id", "store_name",
        "revenue_minor", "profit_minor", "foodcost_percent", "as_of"], data.current.stores.map((row) =>
        [from, to, row.spotId, row.storeName, row.revenueMinor, row.profitMinor, row.classicFoodcostPercent, data.asOf]));
    }

    if (query.view === "penetration") {
      const data = await loadStorePenetrationAnalytics({ from, to, spotIds, asOf: query.period.resolvedAt,
        categoryId: typeof query.categoryId === "number" ? query.categoryId : null });
      if (data.status !== "complete") return json({ error: `store_penetration_export_${data.status}` }, 409);
      if (data.selectedCategoryId === null) return csv(`penetration-categories-${from}-${to}.csv`,
        ["period_from", "period_to", "category_id", "category_name", "receipt_count", "eligible_receipts",
          "penetration_percent", "store_count", "as_of"], data.categories.map((row) => [from, to, row.categoryId,
          row.categoryName, row.receiptCount, data.denominator.eligibleReceipts, row.penetrationPercent, row.storeCount, data.asOf]));
      const selectedName = data.categories.find((row) => row.categoryId === data.selectedCategoryId)?.categoryName ?? `#${data.selectedCategoryId}`;
      const rows: CsvCell[][] = data.stores.map((row) => ["store", from, to, data.selectedCategoryId, selectedName,
        row.spotId, names.get(row.spotId) ?? `#${row.spotId}`, "", "", row.categoryReceipts, row.eligibleReceipts,
        row.penetrationPercent, data.asOf]);
      rows.push(...data.products.map((row) => ["product", from, to, row.categoryId, selectedName, "", "",
        row.productId, row.modificationId, row.receiptCount, data.denominator.eligibleReceipts,
        row.penetrationPercent, data.asOf]));
      return csv(`penetration-category-${data.selectedCategoryId}-${from}-${to}.csv`,
        ["row_type", "period_from", "period_to", "category_id", "category_name", "spot_id", "store_name",
          "product_id", "modification_id", "receipt_count", "eligible_receipts", "penetration_percent", "as_of"], rows);
    }

    const base = { from, to, spotIds, compareFrom: comparison?.from ?? null, compareTo: comparison?.to ?? null,
      asOf: query.period.resolvedAt, categoryId: query.categoryId, productId: query.productId,
      modificationId: query.modificationId, search: query.search, sort: query.sort, direction: query.direction };
    const first = await loadStoreCategoryProductAnalytics({ ...base, page: 1, pageSize: 100 });
    if (first.current.status !== "complete") return json({ error: "store_analytics_export_incomplete" }, 409);
    if (query.view === "categories") return csv(`categories-${from}-${to}.csv`,
      ["period_from", "period_to", "category_id", "category_name", "revenue_minor", "revenue_share_percent",
        "profit_minor", "foodcost_percent", "store_count", "product_count", "as_of"], first.categories.map((row) =>
        [from, to, row.categoryId, row.categoryName, row.revenueMinor, row.revenueSharePercent, row.profitMinor,
          row.classicFoodcostPercent, row.storeCoverageCount, row.distinctProductCount, first.asOf]));
    const productRows = [...first.products.rows];
    for (let page = 2; productRows.length < first.products.total; page += 1) {
      const next = await loadStoreCategoryProductAnalytics({ ...base, page, pageSize: 100 });
      if (next.current.status !== "complete" || next.products.total !== first.products.total || next.asOf !== first.asOf) {
        return json({ error: "store_analytics_export_snapshot_changed" }, 409);
      }
      productRows.push(...next.products.rows);
      if (!next.products.rows.length) return json({ error: "store_analytics_export_pagination_failed" }, 500);
    }
    return csv(`products-${from}-${to}.csv`, ["period_from", "period_to", "product_id", "modification_id",
      "product_name", "category_id", "category_name", "unit", "quantity", "revenue_minor", "profit_minor",
      "foodcost_percent", "store_count", "as_of"], productRows.map((row) => [from, to, row.productId,
      row.modificationId, row.productName, row.categoryId, row.categoryName, row.unit, row.quantity,
      row.revenueMinor, row.profitMinor, row.classicFoodcostPercent, row.storeCoverageCount, first.asOf]));
  } catch (error) {
    const code = error instanceof Error ? error.message : "store_analytics_export_failed";
    if (code.endsWith("schema_missing")) return json({ error: code }, 503);
    console.error(JSON.stringify({ event: "store_analytics_export", view: query.view, code }));
    return json({ error: "store_analytics_export_failed" }, 500);
  }
}

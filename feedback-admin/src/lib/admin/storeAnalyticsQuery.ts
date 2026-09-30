import { parseAnalyticsPeriod, type AnalyticsPeriod } from "./analyticsPeriod";
import { parseAnalyticsScope, type AnalyticsScope } from "./analyticsScope";

export const STORE_ANALYTICS_VIEWS = ["overview", "stores", "categories", "products", "penetration", "comparison", "quality"] as const;
export type StoreAnalyticsView = typeof STORE_ANALYTICS_VIEWS[number];
export type StoreAnalyticsQuery = {
  period: AnalyticsPeriod; scope: AnalyticsScope; view: StoreAnalyticsView;
  categoryId: number | "unknown" | null; productId: number | null; modificationId: number | null;
  page: number; pageSize: number; search: string;
  sort: "revenue" | "change" | "name"; direction: "asc" | "desc";
};
const ALLOWED = new Set(["tab", "view", "period", "days", "from", "to", "grain", "comparison",
  "compare_from", "compare_to", "spot_id", "spot_ids", "category_id", "product_id", "modification_id", "page", "page_size", "search", "sort", "direction"]);

function id(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("invalid_store_analytics_id");
  return Number(value);
}

/** Server-owned clock/asOf. Query parsing does not fetch data, authenticate or widen scope. */
export function parseStoreAnalyticsQuery(params: URLSearchParams, now = new Date()): StoreAnalyticsQuery {
  for (const [key] of params) {
    if (!ALLOWED.has(key)) throw new Error("unknown_store_analytics_query");
    if (params.getAll(key).length !== 1) throw new Error("duplicate_store_analytics_query");
  }
  if (params.has("tab") && params.get("tab") !== "analytics") throw new Error("invalid_store_analytics_tab");
  const normalized = new URLSearchParams(params);
  if (!normalized.has("days") && !normalized.has("period")) normalized.set("period", "30d");
  const period = parseAnalyticsPeriod(normalized, now);
  // Do not advertise live data until the separate provisional pipeline is accepted.
  if (period.provisionalDate !== null) throw new Error("store_analytics_provisional_not_supported");
  const scope = parseAnalyticsScope(params);
  const view = params.get("view") ?? "overview";
  if (!STORE_ANALYTICS_VIEWS.includes(view as StoreAnalyticsView)) throw new Error("invalid_store_analytics_view");
  const rawCategory = params.get("category_id"), rawProduct = params.get("product_id");
  const categoryId = rawCategory === null ? null : rawCategory === "unknown" ? "unknown" : id(rawCategory);
  const productId = rawProduct === null ? null : id(rawProduct);
  const rawModification = params.get("modification_id");
  const modificationId = rawModification === null ? null : (/^\d+$/.test(rawModification) && Number.isSafeInteger(Number(rawModification))
    ? Number(rawModification) : (() => { throw new Error("invalid_store_analytics_id"); })());
  if (modificationId !== null && productId === null) throw new Error("invalid_store_analytics_id");
  const page = params.has("page") ? id(params.get("page")!) : 1;
  const pageSize = params.has("page_size") ? id(params.get("page_size")!) : 25;
  if (page > 10000 || ![25, 50, 100].includes(pageSize)) throw new Error("invalid_store_analytics_pagination");
  const search = (params.get("search") ?? "").trim();
  if (search.length > 80 || /[\x00-\x1f\x7f]/.test(search)) throw new Error("invalid_store_analytics_search");
  const sort = params.get("sort") ?? "revenue", direction = params.get("direction") ?? "desc";
  if (!["revenue", "change", "name"].includes(sort) || !["asc", "desc"].includes(direction)) {
    throw new Error("invalid_store_analytics_sort");
  }
  return { period, scope, view: view as StoreAnalyticsView, categoryId, productId, modificationId, page, pageSize, search,
    sort: sort as StoreAnalyticsQuery["sort"], direction: direction as StoreAnalyticsQuery["direction"] };
}

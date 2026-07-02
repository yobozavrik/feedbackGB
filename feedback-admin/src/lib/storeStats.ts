import { FEEDBACK_STATUS_META } from "@/lib/feedbackStatus";
import type {
  StoreFeedRow,
  StoreRow,
  StoreSeller,
} from "@/app/(admin)/admin/stores/page";

// Pure aggregation + formatting helpers for the stores page. Moved verbatim
// from stores-client.tsx so the windowed KPI math is unit-testable and the
// table/drawer components stay presentational.

const DAY_MS = 24 * 60 * 60 * 1000;
export const KPI_WINDOW_DAYS = 30;
export const TREND_WINDOW_DAYS = 30;
const TOP_PRODUCTS = 8;
const RECENT_FEEDBACK = 10;

// Text labels come from the shared feedbackStatus source of truth (identical
// across admin pages). Colors stay local: this page uses antd's
// status-token palette (processing/warning/success/error), distinct from
// the palette admin-client.tsx uses for the same statuses — that's a
// deliberate per-page visual choice, not a bug, so we don't unify it.
export const STATUS_TAG: Record<
  string,
  "default" | "processing" | "success" | "warning" | "error"
> = {
  new: "processing",
  in_progress: "warning",
  resolved: "success",
  rejected: "error",
};

export function statusLabel(status: string): string {
  return (FEEDBACK_STATUS_META as Record<string, { text: string }>)[status]?.text ?? status;
}

const CATEGORY_TAG_COLOR: Record<string, string> = {
  missing_item: "orange",
  overstock: "geekblue",
  defect: "red",
  supply_problem: "gold",
  store_idea: "purple",
  spotted_elsewhere: "magenta",
  tech_issue: "cyan",
  customer_voice: "blue",
  consumables_request: "orange",
};

export function categoryTagColor(id: string): string {
  return CATEGORY_TAG_COLOR[id] ?? "default";
}

export { fmtRel, fmtAbs } from "./timeFormat";

export interface StoreSummary {
  store: StoreRow;
  total30: number;
  prev30: number;
  defect30: number;
  ideas30: number;
  topCategoryId: string | null;
  topCategoryTitle: string | null;
  lastAt: string | null;
  activeSellers: number;
  totalSellers: number;
}

export interface StoreDetail {
  store: StoreRow;
  trendData: Array<{ date: string; value: number }>;
  categoryData: Array<{ type: string; id: string; value: number }>;
  statusData: Array<{ type: string; value: number }>;
  topProducts: Array<{ name: string; count: number; defectCount: number }>;
  recent: StoreFeedRow[];
  sellers: StoreSeller[];
  total30Window: number;
}

export function groupSellersByStore(
  sellers: StoreSeller[],
): Map<number, StoreSeller[]> {
  const m = new Map<number, StoreSeller[]>();
  for (const s of sellers) {
    if (s.store_id == null) continue;
    const list = m.get(s.store_id);
    if (list) list.push(s);
    else m.set(s.store_id, [s]);
  }
  return m;
}

export function buildStoreSummaries(
  stores: StoreRow[],
  feed: StoreFeedRow[],
  sellersByStore: Map<number, StoreSeller[]>,
): StoreSummary[] {
  const now = Date.now();
  const cutoff30 = now - (KPI_WINDOW_DAYS - 1) * DAY_MS;
  const cutoff60 = now - (2 * KPI_WINDOW_DAYS - 1) * DAY_MS;

  const total30 = new Map<number, number>();
  const prev30 = new Map<number, number>();
  const defect30 = new Map<number, number>();
  const ideas30 = new Map<number, number>();
  const cats30 = new Map<number, Map<string, number>>();
  const titles = new Map<string, string>();
  const last = new Map<number, string>();

  for (const r of feed) {
    if (r.store_id == null) continue;
    const ts = new Date(r.created_at).getTime();
    if (r.category_title) titles.set(r.category, r.category_title);
    if (ts >= cutoff30) {
      total30.set(r.store_id, (total30.get(r.store_id) ?? 0) + 1);
      if (r.category === "defect") {
        defect30.set(r.store_id, (defect30.get(r.store_id) ?? 0) + 1);
      }
      if (r.category === "store_idea") {
        ideas30.set(r.store_id, (ideas30.get(r.store_id) ?? 0) + 1);
      }
      let inner = cats30.get(r.store_id);
      if (!inner) {
        inner = new Map<string, number>();
        cats30.set(r.store_id, inner);
      }
      inner.set(r.category, (inner.get(r.category) ?? 0) + 1);
    } else if (ts >= cutoff60) {
      prev30.set(r.store_id, (prev30.get(r.store_id) ?? 0) + 1);
    }
    const prevLast = last.get(r.store_id);
    if (!prevLast || new Date(prevLast).getTime() < ts) {
      last.set(r.store_id, r.created_at);
    }
  }

  return stores.map((store) => {
    const inner = cats30.get(store.id);
    let topId: string | null = null;
    let topCount = 0;
    if (inner) {
      for (const [k, v] of inner) {
        if (v > topCount) {
          topCount = v;
          topId = k;
        }
      }
    }
    const storeSellers = sellersByStore.get(store.id) ?? [];
    return {
      store,
      total30: total30.get(store.id) ?? 0,
      prev30: prev30.get(store.id) ?? 0,
      defect30: defect30.get(store.id) ?? 0,
      ideas30: ideas30.get(store.id) ?? 0,
      topCategoryId: topId,
      topCategoryTitle: topId ? titles.get(topId) ?? topId : null,
      lastAt: last.get(store.id) ?? null,
      activeSellers: storeSellers.filter((s) => s.is_active).length,
      totalSellers: storeSellers.length,
    };
  });
}

export function buildStoreDetail(
  summary: StoreSummary,
  feed: StoreFeedRow[],
  sellersByStore: Map<number, StoreSeller[]>,
): StoreDetail {
  const store = summary.store;
  const rows = feed.filter((r) => r.store_id === store.id);
  const cutoffTrend = Date.now() - (TREND_WINDOW_DAYS - 1) * DAY_MS;
  const trendRows = rows.filter(
    (r) => new Date(r.created_at).getTime() >= cutoffTrend,
  );

  // tренд по днях
  const buckets = new Map<string, number>();
  for (let i = TREND_WINDOW_DAYS - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY_MS)
      .toISOString()
      .slice(0, 10);
    buckets.set(key, 0);
  }
  for (const r of trendRows) {
    const key = new Date(r.created_at).toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const trendData = Array.from(buckets.entries()).map(([date, value]) => ({
    date,
    value,
  }));

  // розподіл по категоріях за 30 днів
  const catCount = new Map<string, number>();
  const catTitle = new Map<string, string>();
  const statusCount = new Map<string, number>();
  for (const r of trendRows) {
    catCount.set(r.category, (catCount.get(r.category) ?? 0) + 1);
    if (r.category_title) catTitle.set(r.category, r.category_title);
    statusCount.set(r.status, (statusCount.get(r.status) ?? 0) + 1);
  }
  const categoryData = Array.from(catCount.entries())
    .map(([id, value]) => ({
      type: catTitle.get(id) ?? id,
      id,
      value,
    }))
    .sort((a, b) => b.value - a.value);
  const statusData = Array.from(statusCount.entries()).map(([k, v]) => ({
    type: statusLabel(k),
    value: v,
  }));

  // топ продукти (за весь window)
  const productCount = new Map<
    string,
    { name: string; count: number; defectCount: number }
  >();
  for (const r of rows) {
    if (r.product_id == null || !r.product_name) continue;
    const key = `${r.product_id}`;
    const cur = productCount.get(key) ?? {
      name: r.product_name,
      count: 0,
      defectCount: 0,
    };
    cur.count += 1;
    if (r.category === "defect") cur.defectCount += 1;
    productCount.set(key, cur);
  }
  const topProducts = Array.from(productCount.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_PRODUCTS);

  const recent = rows.slice(0, RECENT_FEEDBACK);

  const storeSellers = sellersByStore.get(store.id) ?? [];

  return {
    store,
    trendData,
    categoryData,
    statusData,
    topProducts,
    recent,
    sellers: storeSellers,
    total30Window: trendRows.length,
  };
}

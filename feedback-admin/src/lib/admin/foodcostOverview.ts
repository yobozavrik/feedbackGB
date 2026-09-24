import { getServerSupabase } from "@/lib/supabase";
import { salesMetrics, type SalesMetrics } from "./posterSalesMath";

const PAGE = 500;
const MAX_PAGES = 20;
const METHODOLOGY = "poster-sales-dual-v1";

export type FoodcostOverviewRun = {
  id: string;
  business_date: string;
  spot_id: number;
  status: string;
  methodology_version: string;
  completed_at: string | null;
  source_fetched_at: string | null;
  source_row_count: number | null;
  payed_sum_minor: number | string | null;
  product_profit_minor: number | string | null;
  product_profit_netto_minor: number | string | null;
};

type Cell = { businessDate: string; spotId: number; reason: "missing_run" | "invalid_run" };
export type FoodcostOverview = {
  status: "complete" | "incomplete";
  dateFrom: string;
  dateTo: string;
  methodologyVersion: typeof METHODOLOGY;
  expectedCells: number;
  completedCells: number;
  missing: Cell[];
  sourceFetchedAt: string | null;
  newestSourceFetchedAt: string | null;
  metrics: SalesMetrics | null;
  days: { businessDate: string; metrics: SalesMetrics }[] | null;
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function datesBetween(dateFrom: string, dateTo: string): string[] {
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) {
    throw new Error("invalid_foodcost_period");
  }
  const dates: string[] = [];
  let cursor = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`).getTime();
  while (cursor.getTime() <= end) {
    if (dates.length >= 31) throw new Error("foodcost_period_too_long");
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

function integer(value: number | string | null, allowNull = false): number | null {
  if (allowNull && value === null) return null;
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error("invalid_foodcost_money");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("invalid_foodcost_money");
  return parsed;
}

function checkedRun(run: FoodcostOverviewRun) {
  if (run.status !== "completed" || run.methodology_version !== METHODOLOGY ||
    !run.completed_at || !run.source_fetched_at ||
    !Number.isSafeInteger(run.source_row_count) || (run.source_row_count ?? -1) < 0 ||
    Number.isNaN(Date.parse(run.source_fetched_at))) throw new Error("invalid_foodcost_run");
  return {
    payedSumMinor: integer(run.payed_sum_minor)!,
    productProfitMinor: integer(run.product_profit_minor)!,
    productProfitNettoMinor: integer(run.product_profit_netto_minor, true),
  };
}

/** Pure, strict coverage: a missing/invalid spot-day makes every KPI unavailable. */
export function buildFoodcostOverview(
  dateFrom: string, dateTo: string, spotIds: readonly number[], runs: readonly FoodcostOverviewRun[],
): FoodcostOverview {
  const dates = datesBetween(dateFrom, dateTo);
  if (!spotIds.length || spotIds.length > 100 || new Set(spotIds).size !== spotIds.length ||
    spotIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("invalid_foodcost_spots");

  const latest = new Map<string, FoodcostOverviewRun>();
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const key = `${run.business_date}:${run.spot_id}`;
    const prior = latest.get(key);
    if (!prior || (run.completed_at ?? "") > (prior.completed_at ?? "") ||
      (run.completed_at === prior.completed_at && run.id > prior.id)) latest.set(key, run);
  }
  const missing: Cell[] = [];
  const values: ReturnType<typeof checkedRun>[] = [];
  const byDay = new Map<string, ReturnType<typeof checkedRun>[]>();
  const fetchedAt: string[] = [];
  for (const businessDate of dates) for (const spotId of spotIds) {
    const run = latest.get(`${businessDate}:${spotId}`);
    if (!run) {
      missing.push({ businessDate, spotId, reason: "missing_run" });
      continue;
    }
    try {
      const parsed = checkedRun(run);
      values.push(parsed);
      const group = byDay.get(businessDate) ?? [];
      group.push(parsed);
      byDay.set(businessDate, group);
      fetchedAt.push(run.source_fetched_at!);
    } catch {
      missing.push({ businessDate, spotId, reason: "invalid_run" });
    }
  }
  const base = {
    dateFrom, dateTo, methodologyVersion: METHODOLOGY,
    expectedCells: dates.length * spotIds.length, completedCells: values.length, missing,
  } as const;
  if (missing.length) return {
    ...base, status: "incomplete", sourceFetchedAt: null, newestSourceFetchedAt: null,
    metrics: null, days: null,
  };
  fetchedAt.sort();
  return {
    ...base, status: "complete", sourceFetchedAt: fetchedAt[0],
    newestSourceFetchedAt: fetchedAt[fetchedAt.length - 1],
    metrics: salesMetrics(values),
    days: dates.map((businessDate) => ({ businessDate, metrics: salesMetrics(byDay.get(businessDate) ?? []) })),
  };
}

/** Bounded read of run-level aggregates, not thousands of raw fact rows. */
export async function loadFoodcostOverview(dateFrom: string, dateTo: string, spotIds: readonly number[]) {
  datesBetween(dateFrom, dateTo);
  if (!spotIds.length || spotIds.length > 100 || new Set(spotIds).size !== spotIds.length ||
    spotIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("invalid_foodcost_spots");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");

  const asOf = new Date().toISOString();
  const runs: FoodcostOverviewRun[] = [];
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    const page = await db.from("foodcost_sales_runs")
      .select("id,business_date,spot_id,status,methodology_version,completed_at,source_fetched_at,source_row_count,payed_sum_minor,product_profit_minor,product_profit_netto_minor")
      .gte("business_date", dateFrom).lte("business_date", dateTo)
      .in("spot_id", [...spotIds]).eq("status", "completed").lte("completed_at", asOf)
      .order("completed_at", { ascending: false }).order("id", { ascending: false })
      .range(pageNo * PAGE, (pageNo + 1) * PAGE - 1);
    if (page.error) throw new Error(page.error.code === "42P01" ? "schema_missing" : "foodcost_overview_read_failed");
    const rows = (page.data ?? []) as FoodcostOverviewRun[];
    runs.push(...rows);
    if (rows.length < PAGE) break;
    if (pageNo === MAX_PAGES - 1) throw new Error("foodcost_overview_limit");
  }
  return buildFoodcostOverview(dateFrom, dateTo, spotIds, runs);
}

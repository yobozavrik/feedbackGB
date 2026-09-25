import { getServerSupabase } from "@/lib/supabase";
import { buildFoodcostSalesReadModel, type SalesFactRead, type SalesRunRead } from "./foodcostSalesReadModel";

const PAGE = 500;
const MAX_RUN_PAGES = 10;
const MAX_FACT_PAGES = 100;

function dbError(error: { code?: string } | null, stage: string): void {
  if (error) throw new Error(error.code === "42P01" ? "schema_missing" : `foodcost_read_${stage}_${error.code ?? "unknown"}`);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Read-only bounded loader. A three-day limit is intentional until historical
 * roster membership and longer windows have passed their own coverage gate. */
export async function loadFoodcostSalesPeriod(businessDates: readonly string[], spotIds: readonly number[]) {
  if (!businessDates.length || businessDates.length > 3 ||
    new Set(businessDates).size !== businessDates.length || businessDates.some((date) => !validDate(date)) ||
    !spotIds.length || spotIds.length > 100 ||
    new Set(spotIds).size !== spotIds.length ||
    spotIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("invalid_sales_read_scope");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");

  // Fix an upper bound so a newly completed run cannot shift offset pages.
  const asOf = new Date().toISOString();
  const runs: SalesRunRead[] = [];
  for (let pageNo = 0; pageNo < MAX_RUN_PAGES; pageNo++) {
    const page = await db.from("foodcost_sales_runs")
      .select("id,business_date,spot_id,status,completed_at,source_fetched_at,source_row_count,payed_sum_minor,product_profit_minor,product_profit_netto_minor")
      .in("business_date", [...businessDates]).in("spot_id", [...spotIds]).eq("status", "completed")
      .lte("completed_at", asOf)
      .order("completed_at", { ascending: false }).order("id", { ascending: false })
      .range(pageNo * PAGE, (pageNo + 1) * PAGE - 1);
    dbError(page.error, "runs");
    const rows = (page.data ?? []) as SalesRunRead[];
    runs.push(...rows);
    if (rows.length < PAGE) break;
    if (pageNo === MAX_RUN_PAGES - 1) throw new Error("foodcost_read_runs_limit");
  }
  const latest = new Map<string, SalesRunRead>();
  for (const run of runs) {
    const key = `${run.business_date}:${run.spot_id}`;
    if (!latest.has(key)) latest.set(key, run);
  }
  const runIds = [...latest.values()].map((run) => run.id);

  const facts: SalesFactRead[] = [];
  if (runIds.length) for (let pageNo = 0; pageNo < MAX_FACT_PAGES; pageNo++) {
    const page = await db.from("foodcost_sales_facts")
      .select("run_id,source_row_no,product_id,modification_id,category_id_snapshot,category_name_snapshot,product_name_snapshot,quantity,unit,weight_based,payed_sum_minor,product_profit_minor,product_profit_netto_minor,product_sum_minor,bonus_sum_minor,cert_sum_minor,discount_minor")
      .in("run_id", runIds).order("run_id").order("source_row_no")
      .range(pageNo * PAGE, (pageNo + 1) * PAGE - 1);
    dbError(page.error, "facts");
    const rows = (page.data ?? []) as SalesFactRead[];
    facts.push(...rows);
    if (rows.length < PAGE) break;
    if (pageNo === MAX_FACT_PAGES - 1) throw new Error("foodcost_read_facts_limit");
  }

  return buildFoodcostSalesReadModel(businessDates, spotIds, [...latest.values()], facts);
}

export async function loadFoodcostSalesDay(businessDate: string, spotIds: readonly number[]) {
  return loadFoodcostSalesPeriod([businessDate], spotIds);
}

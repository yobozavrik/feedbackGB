import { getServerSupabase } from "@/lib/supabase";
import { posterRequest } from "./posterApi";
import { buildFoodcostSalesSnapshot } from "./foodcostSalesSnapshot";
import { sameFoodcostSalesFacts } from "./foodcostSalesFactsEqual";

const FACT_BATCH = 200;

function assertDb(error: { code?: string } | null, stage: string): void {
  if (error) throw new Error(error.code === "42P01" ? "schema_missing" : `foodcost_db_${stage}_${error.code ?? "unknown"}`);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function kyivToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * Versioned single-day, single-spot sync. No route or scheduler calls it yet.
 * Call only after staging is available and the operator explicitly starts a
 * bounded test. Readers must select only the latest *completed* run.
 */
export async function syncPosterSalesSpotDay(businessDate: string, spotId: number) {
  if (!validDate(businessDate) || !Number.isSafeInteger(spotId) || spotId <= 0) {
    throw new Error("invalid_sales_sync_scope");
  }
  // Today's POS totals are still moving; a completed snapshot must cover a
  // closed Kyiv business day. Historical re-sync creates a new version.
  if (businessDate >= kyivToday(new Date())) throw new Error("sales_day_not_closed");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("poster_token_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");

  const spots = await posterRequest<unknown>("access.getSpots", {}, token);
  if (!Array.isArray(spots)) throw new Error("invalid_poster_spots");
  if (!spots.some((spot) => spot && typeof spot === "object" &&
    Number((spot as { spot_id?: unknown }).spot_id) === spotId)) {
    throw new Error("unknown_poster_spot");
  }

  const compact = businessDate.replaceAll("-", "");
  const raw = await posterRequest<unknown>("dash.getProductsSales", {
    date_from: compact, date_to: compact, spot_id: String(spotId),
  }, token);
  const sourceFetchedAt = new Date().toISOString();
  // Validate the *entire* response before creating any database row.
  const snapshot = buildFoodcostSalesSnapshot(raw);

  // An unchanged historical response does not need another version. Compare
  // all source fields, not just the totals: corrections can cancel each other.
  const prior = await db.from("foodcost_sales_runs")
    .select("id,source_row_count,payed_sum_minor,product_profit_minor,product_profit_netto_minor,source_fetched_at")
    .eq("business_date", businessDate).eq("spot_id", spotId).eq("status", "completed")
    .order("completed_at", { ascending: false }).order("id", { ascending: false })
    .limit(1).maybeSingle();
  assertDb(prior.error, "latest_run");
  const previous = prior.data;
  if (previous && previous.source_row_count === snapshot.sourceRowCount &&
    Number(previous.payed_sum_minor) === snapshot.payedSumMinor &&
    Number(previous.product_profit_minor) === snapshot.productProfitMinor &&
    (previous.product_profit_netto_minor === null ? null : Number(previous.product_profit_netto_minor)) ===
      snapshot.productProfitNettoMinor && snapshot.sourceRowCount <= 10000) {
    const stored: Record<string, unknown>[] = [];
    for (let offset = 0; offset < snapshot.sourceRowCount; offset += 500) {
      const page = await db.from("foodcost_sales_facts")
        .select("product_id,modification_id,category_id_snapshot,product_name_snapshot,category_name_snapshot,quantity,unit,weight_based,payed_sum_minor,product_profit_minor,product_profit_netto_minor,product_sum_minor,bonus_sum_minor,cert_sum_minor,discount_minor")
        .eq("run_id", previous.id).order("source_row_no").range(offset, offset + 499);
      assertDb(page.error, "latest_facts");
      stored.push(...(page.data ?? []));
    }
    if (sameFoodcostSalesFacts(snapshot.facts, stored)) {
      return { runId: previous.id, businessDate, spotId, ...snapshot,
        sourceFetchedAt: previous.source_fetched_at, unchanged: true };
    }
  }

  const inserted = await db.from("foodcost_sales_runs")
    .insert({ business_date: businessDate, spot_id: spotId, status: "running" })
    .select("id").single();
  assertDb(inserted.error, "create_run");
  const runId = inserted.data?.id as string | undefined;
  if (!runId) throw new Error("foodcost_db_missing_run_id");

  try {
    for (let offset = 0; offset < snapshot.facts.length; offset += FACT_BATCH) {
      const batch = snapshot.facts.slice(offset, offset + FACT_BATCH)
        .map((fact) => ({ run_id: runId, ...fact }));
      const saved = await db.from("foodcost_sales_facts").insert(batch);
      assertDb(saved.error, "insert_facts");
    }

    const counted = await db.from("foodcost_sales_facts")
      .select("source_row_no", { count: "exact", head: true }).eq("run_id", runId);
    assertDb(counted.error, "count_facts");
    if (counted.count !== snapshot.sourceRowCount) throw new Error("foodcost_fact_count_mismatch");

    let readCount = 0;
    let paidReadback = 0;
    let profitReadback = 0;
    let nettoReadback = 0;
    let nettoComplete = true;
    for (let offset = 0; offset < snapshot.sourceRowCount; offset += 500) {
      const page = await db.from("foodcost_sales_facts")
        .select("source_row_no,payed_sum_minor,product_profit_minor,product_profit_netto_minor")
        .eq("run_id", runId).order("source_row_no").range(offset, offset + 499);
      assertDb(page.error, "readback_facts");
      for (const fact of page.data ?? []) {
        if (fact.source_row_no !== readCount) throw new Error("foodcost_fact_order_mismatch");
        readCount++;
        paidReadback += Number(fact.payed_sum_minor);
        profitReadback += Number(fact.product_profit_minor);
        if (fact.product_profit_netto_minor == null) nettoComplete = false;
        else nettoReadback += Number(fact.product_profit_netto_minor);
      }
    }
    if (readCount !== snapshot.sourceRowCount ||
      !Number.isSafeInteger(paidReadback) || !Number.isSafeInteger(profitReadback) ||
      !Number.isSafeInteger(nettoReadback) ||
      paidReadback !== snapshot.payedSumMinor || profitReadback !== snapshot.productProfitMinor ||
      (nettoComplete ? nettoReadback : null) !== snapshot.productProfitNettoMinor) {
      throw new Error("foodcost_fact_totals_mismatch");
    }

    const completed = await db.from("foodcost_sales_runs").update({
      status: "completed",
      source_row_count: snapshot.sourceRowCount,
      payed_sum_minor: snapshot.payedSumMinor,
      product_profit_minor: snapshot.productProfitMinor,
      product_profit_netto_minor: snapshot.productProfitNettoMinor,
      source_fetched_at: sourceFetchedAt,
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("status", "running").select("id").single();
    assertDb(completed.error, "complete_run");
    if (completed.data?.id !== runId) throw new Error("foodcost_db_completion_mismatch");
    return { runId, businessDate, spotId, ...snapshot, sourceFetchedAt, unchanged: false };
  } catch (error) {
    // The failed run and its facts remain for diagnosis but are never visible
    // to readers, which must filter status=completed.
    const code = error instanceof Error ? error.message.slice(0, 120) : "unknown_sync_error";
    await db.from("foodcost_sales_runs")
      .update({ status: "failed", error_code: code })
      .eq("id", runId).eq("status", "running");
    throw error;
  }
}

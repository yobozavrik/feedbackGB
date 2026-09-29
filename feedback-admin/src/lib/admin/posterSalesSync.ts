import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase";
import { posterRequest } from "./posterApi";
import { buildFoodcostSalesSnapshot } from "./foodcostSalesSnapshot";
import { sameFoodcostSalesFacts } from "./foodcostSalesFactsEqual";

const FACT_BATCH = 200;

function withAbortSignal<T>(query: T, signal?: AbortSignal): T {
  if (!signal) return query;
  const candidate = query as { abortSignal?: (value: AbortSignal) => T };
  if (typeof candidate.abortSignal !== "function") throw new Error("supabase_abort_unsupported");
  return candidate.abortSignal(signal);
}

function cleanupSignal(): AbortSignal {
  return AbortSignal.timeout(5000);
}

function safeSyncErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "";
  const safeCodes = new Set(["poster_unavailable", "poster_invalid_response", "invalid_poster_spots",
    "unknown_poster_spot", "sales_day_not_closed", "foodcost_sync_in_progress",
    "foodcost_fact_count_mismatch", "foodcost_fact_order_mismatch", "foodcost_fact_totals_mismatch",
    "foodcost_db_completion_mismatch", "schema_missing", "supabase_abort_unsupported"]);
  if (safeCodes.has(value)) return value;
  return "foodcost_sync_failed";
}

function assertDb(error: { code?: string } | null, stage: string): void {
  if (error) throw new Error(["42P01", "42883", "PGRST202"].includes(error.code ?? "")
    ? "schema_missing" : `foodcost_db_${stage}_${error.code ?? "unknown"}`);
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

export function lastThreeClosedKyivDates(now: Date): string[] {
  const today = kyivToday(now);
  const midnight = new Date(`${today}T00:00:00Z`).getTime();
  return [1, 2, 3].map((daysAgo) => new Date(midnight - daysAgo * 86_400_000)
    .toISOString().slice(0, 10));
}

export function posterSpotIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("invalid_poster_spots");
  const ids = value.map((spot) => Number(spot && typeof spot === "object"
    ? (spot as { spot_id?: unknown }).spot_id : null));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length) throw new Error("invalid_poster_spots");
  return ids.sort((a, b) => a - b);
}

/**
 * Versioned single-day, single-spot sync.
 * Migration 038 is required: a DB lease serializes same-spot/day workers and
 * the completion RPC verifies lease ownership plus fact totals atomically.
 * Readers must select only the latest *completed* run.
 */
export async function syncPosterSalesSpotDay(
  businessDate: string, spotId: number, verifiedPosterSpotIds?: ReadonlySet<number>, signal?: AbortSignal,
  options: { missingOnly?: boolean } = {},
) {
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

  const ownerToken = randomUUID();
  const lease = await withAbortSignal(db.rpc("acquire_foodcost_sales_sync_lease", {
    p_business_date: businessDate, p_spot_id: spotId,
    // Longer than the route's 300 s maximum so a slow valid worker cannot
    // lose ownership immediately before the atomic completion RPC.
    p_owner_token: ownerToken, p_ttl_seconds: 600,
  }), signal);
  assertDb(lease.error, "acquire_lease");
  if (lease.data !== true) throw new Error("foodcost_sync_in_progress");

  let runId: string | undefined;
  let primaryError: unknown = null;
  try {

  // In missing-only mode this check is protected by the existing atomic cell
  // lease, closing the race between the queue's preflight lookup and this sync.
  if (options.missingOnly) {
    const existing = await withAbortSignal(db.from("foodcost_sales_runs")
      .select("id").eq("business_date", businessDate).eq("spot_id", spotId)
      .eq("status", "completed").order("completed_at", { ascending: false })
      .order("id", { ascending: false }).limit(1).maybeSingle(), signal);
    assertDb(existing.error, "missing_only_run");
    if (existing.data?.id) return { runId: String(existing.data.id), businessDate, spotId,
      unchanged: true as const, alreadyCompleted: true as const };
  }

  const validSpots = verifiedPosterSpotIds ?? new Set(posterSpotIds(await (signal
    ? posterRequest<unknown>("access.getSpots", {}, token, signal)
    : posterRequest<unknown>("access.getSpots", {}, token))));
  if (!validSpots.has(spotId)) {
    throw new Error("unknown_poster_spot");
  }

  const compact = businessDate.replaceAll("-", "");
  const raw = await posterRequest<unknown>("dash.getProductsSales", {
    date_from: compact, date_to: compact, spot_id: String(spotId),
  }, token, ...(signal ? [signal] : []));
  const sourceFetchedAt = new Date().toISOString();
  // Validate the *entire* response before creating any database row.
  const snapshot = buildFoodcostSalesSnapshot(raw);

  // An unchanged historical response does not need another version. Compare
  // all source fields, not just the totals: corrections can cancel each other.
  const prior = await withAbortSignal(db.from("foodcost_sales_runs")
    .select("id,source_row_count,payed_sum_minor,product_profit_minor,product_profit_netto_minor,source_fetched_at")
    .eq("business_date", businessDate).eq("spot_id", spotId).eq("status", "completed")
    .order("completed_at", { ascending: false }).order("id", { ascending: false })
    .limit(1).maybeSingle(), signal);
  assertDb(prior.error, "latest_run");
  const previous = prior.data;
  if (previous && previous.source_row_count === snapshot.sourceRowCount &&
    Number(previous.payed_sum_minor) === snapshot.payedSumMinor &&
    Number(previous.product_profit_minor) === snapshot.productProfitMinor &&
    (previous.product_profit_netto_minor === null ? null : Number(previous.product_profit_netto_minor)) ===
      snapshot.productProfitNettoMinor && snapshot.sourceRowCount <= 10000) {
    const stored: Record<string, unknown>[] = [];
    for (let offset = 0; offset < snapshot.sourceRowCount; offset += 500) {
      const page = await withAbortSignal(db.from("foodcost_sales_facts")
        .select("product_id,modification_id,category_id_snapshot,product_name_snapshot,category_name_snapshot,quantity,unit,weight_based,payed_sum_minor,product_profit_minor,product_profit_netto_minor,product_sum_minor,bonus_sum_minor,cert_sum_minor,discount_minor")
        .eq("run_id", previous.id).order("source_row_no").range(offset, offset + 499), signal);
      assertDb(page.error, "latest_facts");
      stored.push(...(page.data ?? []));
    }
    if (sameFoodcostSalesFacts(snapshot.facts, stored)) {
      return { runId: previous.id, businessDate, spotId, ...snapshot,
        sourceFetchedAt: previous.source_fetched_at, unchanged: true };
    }
  }

  const inserted = await withAbortSignal(db.from("foodcost_sales_runs")
    .insert({ business_date: businessDate, spot_id: spotId, status: "running" })
    .select("id").single(), signal);
  assertDb(inserted.error, "create_run");
  runId = inserted.data?.id as string | undefined;
  if (!runId) throw new Error("foodcost_db_missing_run_id");

    for (let offset = 0; offset < snapshot.facts.length; offset += FACT_BATCH) {
      const batch = snapshot.facts.slice(offset, offset + FACT_BATCH)
        .map((fact) => ({ run_id: runId, ...fact }));
      const saved = await withAbortSignal(db.from("foodcost_sales_facts").insert(batch), signal);
      assertDb(saved.error, "insert_facts");
    }

    const counted = await withAbortSignal(db.from("foodcost_sales_facts")
      .select("source_row_no", { count: "exact", head: true }).eq("run_id", runId), signal);
    assertDb(counted.error, "count_facts");
    if (counted.count !== snapshot.sourceRowCount) throw new Error("foodcost_fact_count_mismatch");

    let readCount = 0;
    let paidReadback = 0;
    let profitReadback = 0;
    let nettoReadback = 0;
    let nettoComplete = true;
    for (let offset = 0; offset < snapshot.sourceRowCount; offset += 500) {
      const page = await withAbortSignal(db.from("foodcost_sales_facts")
        .select("source_row_no,payed_sum_minor,product_profit_minor,product_profit_netto_minor")
        .eq("run_id", runId).order("source_row_no").range(offset, offset + 499), signal);
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

    const completed = await withAbortSignal(db.rpc("complete_foodcost_sales_sync_run", {
      p_run_id: runId, p_owner_token: ownerToken,
      p_source_row_count: snapshot.sourceRowCount,
      p_payed_sum_minor: snapshot.payedSumMinor,
      p_product_profit_minor: snapshot.productProfitMinor,
      p_product_profit_netto_minor: snapshot.productProfitNettoMinor,
      p_source_fetched_at: sourceFetchedAt,
    }), signal);
    assertDb(completed.error, "complete_run");
    if (completed.data !== runId) throw new Error("foodcost_db_completion_mismatch");
    return { runId, businessDate, spotId, ...snapshot, sourceFetchedAt, unchanged: false };
  } catch (error) {
    primaryError = error;
    if (runId) {
      // Failed runs and their facts remain for diagnosis, never for readers.
      try {
        await withAbortSignal(db.from("foodcost_sales_runs")
          .update({ status: "failed", error_code: safeSyncErrorCode(error) })
          .eq("id", runId).eq("status", "running"), cleanupSignal());
      } catch { /* Preserve the source failure; the run remains non-readable. */ }
    }
    throw error;
  } finally {
    // Completion already releases its lease; this also covers unchanged and
    // source/API failures. A lost release cannot override the primary error.
    try {
      const released = await withAbortSignal(db.rpc("release_foodcost_sales_sync_lease", {
        p_business_date: businessDate, p_spot_id: spotId, p_owner_token: ownerToken,
      }), cleanupSignal());
      if (!primaryError) assertDb(released.error, "release_lease");
    } catch (error) { if (!primaryError) throw error; }
  }
}

/**
 * Explicit operator rolling refresh. Fail-stop: a later invocation safely
 * rechecks unchanged cells. The nightly cron uses the missing-only queue instead.
 * The roster is fetched once for the entire run to avoid 78 extra API calls.
 */
export async function syncPosterSalesRecentDays(now = new Date()) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("poster_token_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const ownerToken = randomUUID();
  const acquireBatch = async () => {
    const lease = await db.rpc("acquire_foodcost_sales_batch_lease", {
      p_owner_token: ownerToken, p_ttl_seconds: 900,
    });
    assertDb(lease.error, "acquire_batch_lease");
    if (lease.data !== true) throw new Error("foodcost_batch_in_progress");
  };
  await acquireBatch();
  let primaryError: unknown = null;
  try {
    const ids = posterSpotIds(await posterRequest<unknown>("access.getSpots", {}, token));
    const verifiedIds = new Set(ids);
    const dates = lastThreeClosedKyivDates(now);
    const summary = { dates, spotCount: ids.length, expectedCells: dates.length * ids.length,
      processedCells: 0, changedCells: 0, unchangedCells: 0 };
    for (const date of dates) for (const spotId of ids) {
      // Renew ownership before each cell, so a CLI run lasting longer than the
      // initial TTL cannot silently overlap another whole-network sweep.
      await acquireBatch();
      const result = await syncPosterSalesSpotDay(date, spotId, verifiedIds);
      summary.processedCells++;
      if (result.unchanged) summary.unchangedCells++;
      else summary.changedCells++;
      if (summary.processedCells < summary.expectedCells) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (spotId === ids[ids.length - 1]) {
        console.info(JSON.stringify({ event: "poster_foodcost_sales_sync_day", businessDate: date,
          processedCells: summary.processedCells, expectedCells: summary.expectedCells,
          changedCells: summary.changedCells, unchangedCells: summary.unchangedCells }));
      }
    }
    return summary;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const released = await db.rpc("release_foodcost_sales_batch_lease", {
      p_owner_token: ownerToken,
    });
    if (!primaryError) assertDb(released.error, "release_batch_lease");
  }
}

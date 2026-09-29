import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase";
import { loadVerifiedCurrentFoodcostSpotIds } from "./foodcostRecentNetwork";
import { syncPosterSalesSpotDay } from "./posterSalesSync";

const MAX_JOBS = 80;
const MAX_RUNTIME_MS = 210_000;
const MIN_START_BUDGET_MS = 110_000;
const JOB_DEADLINE_MS = 75_000;
const RPC_DEADLINE_MS = 8_000;

type QueueJob = {
  business_date: string;
  spot_id: number;
  attempt_no: number;
  owner_token: string;
  lease_expires_at: string;
};

const SAFE_FAILURE_CODES = new Set([
  "schema_missing", "service_role_missing", "poster_token_missing", "supabase_missing",
  "poster_unavailable", "poster_invalid_response", "invalid_poster_spots",
  "foodcost_roster_unavailable", "foodcost_roster_mismatch", "unknown_poster_spot",
  "foodcost_sync_in_progress", "supabase_abort_unsupported", "foodcost_lease_lost",
  "invalid_sales_sync_scope", "invalid_foodcost_backfill_seed", "sales_day_not_closed",
  "foodcost_fact_count_mismatch", "foodcost_fact_order_mismatch", "foodcost_fact_totals_mismatch",
  "foodcost_db_completion_mismatch", "backfill_deadline", "backfill_lease_expired",
]);

function bounded<T>(query: T, signal: AbortSignal): T {
  const candidate = query as { abortSignal?: (value: AbortSignal) => T };
  if (typeof candidate.abortSignal !== "function") throw new Error("supabase_abort_unsupported");
  return candidate.abortSignal(signal);
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "";
  return SAFE_FAILURE_CODES.has(value) ? value : "backfill_unexpected_error";
}

function assertRpc(error: { code?: string } | null, stage: string): void {
  if (error) throw new Error(["42P01", "42883", "PGRST202"].includes(error.code ?? "")
    ? "schema_missing" : `foodcost_queue_${stage}_${error.code ?? "unknown"}`);
}

function kyivToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (kind: string) => parts.find((item) => item.type === kind)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function getJob(value: unknown, spotIds: readonly number[], ownerToken: string): QueueJob | null {
  if (!Array.isArray(value)) throw new Error("foodcost_queue_invalid_claim");
  if (value.length === 0) return null;
  if (value.length !== 1 || !value[0] || typeof value[0] !== "object") {
    throw new Error("foodcost_queue_invalid_claim");
  }
  const row = value[0] as Record<string, unknown>;
  const businessDate = row.business_date;
  const date = typeof businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(businessDate)
    ? new Date(`${businessDate}T00:00:00Z`) : null;
  const spotId = Number(row.spot_id);
  const attempt = Number(row.attempt_no);
  const expiry = typeof row.lease_expires_at === "string" ? Date.parse(row.lease_expires_at) : NaN;
  const oldestAllowed = new Date(Date.parse(`${kyivToday()}T00:00:00Z`) - 120 * 86_400_000)
    .toISOString().slice(0, 10);
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== businessDate ||
    businessDate >= kyivToday() || businessDate < oldestAllowed || !Number.isSafeInteger(spotId) || !spotIds.includes(spotId) ||
    !Number.isSafeInteger(attempt) || attempt < 1 || attempt > 8 || row.owner_token !== ownerToken ||
    !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("foodcost_queue_invalid_claim");
  return { business_date: businessDate, spot_id: spotId, attempt_no: attempt,
    owner_token: ownerToken, lease_expires_at: String(row.lease_expires_at) };
}

async function queueRpc<T>(db: ReturnType<typeof getServerSupabase>, method: string,
  args: Record<string, unknown>, stage: string, requestSignal?: AbortSignal): Promise<T> {
  if (!db) throw new Error("supabase_missing");
  const timeoutSignal = AbortSignal.timeout(RPC_DEADLINE_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
  const result = await bounded(db.rpc(method, args), signal);
  assertRpc(result.error, stage);
  return result.data as T;
}

/**
 * Missing-only, resumable worker for the current verified roster. Each claimed
 * job is awaited to completion or actual transport cancellation before moving on.
 */
export async function syncPosterFoodcostSalesNightly(now = new Date(),
  options: { maxJobs?: number; jobDeadlineMs?: number } = {}) {
  const jobLimit = options.maxJobs ?? MAX_JOBS;
  const jobDeadlineMs = options.jobDeadlineMs ?? JOB_DEADLINE_MS;
  if (!Number.isSafeInteger(jobLimit) || jobLimit < 1 || jobLimit > MAX_JOBS ||
    !Number.isSafeInteger(jobDeadlineMs) || jobDeadlineMs < 1 || jobDeadlineMs > JOB_DEADLINE_MS) {
    throw new Error("invalid_foodcost_worker_limit");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  if (!process.env.POSTER_TOKEN) throw new Error("poster_token_missing");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const started = Date.now();
  const workerSignal = AbortSignal.timeout(MAX_RUNTIME_MS);
  const rosterSignal = AbortSignal.any([workerSignal, AbortSignal.timeout(15_000)]);
  const spotIds = await loadVerifiedCurrentFoodcostSpotIds(rosterSignal);
  const checkedAt = now.toISOString();
  const seeded = await queueRpc<number>(db, "seed_foodcost_sales_backfill_jobs", {
    p_spot_ids: spotIds, p_now: checkedAt,
  }, "seed");
  const ownerToken = randomUUID();
  const seededCount = Number(seeded);
  if (!Number.isSafeInteger(seededCount) || seededCount < 0) throw new Error("foodcost_queue_seed_invalid");
  const summary = { spotCount: spotIds.length,
    seededJobs: seededCount, processedJobs: 0, completedJobs: 0,
    failedJobs: 0, timedOutJobs: 0, remaining: true };

  for (let index = 0; index < jobLimit; index++) {
    if (Date.now() - started + MIN_START_BUDGET_MS > MAX_RUNTIME_MS) break;
    const claimed = await queueRpc<unknown>(db, "claim_foodcost_sales_backfill_job", {
      p_owner_token: ownerToken, p_spot_ids: spotIds,
    }, "claim");
    const job = getJob(claimed, spotIds, ownerToken);
    if (!job) break;
    summary.processedJobs++;

    const jobSignal = AbortSignal.any([workerSignal, AbortSignal.timeout(jobDeadlineMs)]);
    let stage = "completed_lookup";
    try {
      const prior = await bounded(db.from("foodcost_sales_runs")
        .select("id").eq("business_date", job.business_date).eq("spot_id", job.spot_id)
        .eq("status", "completed").order("completed_at", { ascending: false })
        .order("id", { ascending: false }).limit(1).maybeSingle(), jobSignal);
      if (prior.error) throw new Error("foodcost_completed_lookup_failed");
      let runId: string;
      let outcome: "completed" | "already_completed";
      if (prior.data?.id) {
        runId = String(prior.data.id);
        outcome = "already_completed";
      } else {
        stage = "poster_sync";
        const result = await syncPosterSalesSpotDay(job.business_date, Number(job.spot_id),
          new Set(spotIds), jobSignal, { missingOnly: true });
        runId = result.runId;
        outcome = result.alreadyCompleted ? "already_completed" : "completed";
      }
      stage = "queue_completion";
      const finished = await queueRpc<boolean>(db, "complete_foodcost_sales_backfill_job", {
        p_business_date: job.business_date, p_spot_id: job.spot_id,
        p_owner_token: job.owner_token || ownerToken, p_run_id: runId, p_outcome: outcome,
      }, "complete", jobSignal);
      if (!finished) throw new Error("foodcost_queue_completion_rejected");
      summary.completedJobs++;
    } catch (error) {
      const code = jobSignal.aborted ? "backfill_deadline" : safeErrorCode(error);
      if (code === "backfill_deadline") summary.timedOutJobs++;
      console.warn(JSON.stringify({ event: "poster_foodcost_sales_job_failed",
        businessDate: job.business_date, spotId: job.spot_id, stage, code }));
      const failed = await bounded(db.rpc("fail_foodcost_sales_backfill_job", {
        p_business_date: job.business_date, p_spot_id: job.spot_id,
        p_owner_token: job.owner_token || ownerToken, p_error_code: code,
      }), AbortSignal.timeout(5000));
      assertRpc(failed.error, "fail");
      if (!["retryable_failed", "failed"].includes(String(failed.data))) {
        throw new Error("foodcost_queue_fail_rejected");
      }
      summary.failedJobs++;
      if (code === "schema_missing") throw new Error("schema_missing");
    }
  }
  const healthSignal = AbortSignal.timeout(RPC_DEADLINE_MS);
  const healthResult = await bounded(db.from("v_foodcost_sales_backfill_health").select("*").maybeSingle(), healthSignal);
  if (healthResult.error && ["42P01", "42883", "PGRST202", "PGRST205"].includes(healthResult.error.code ?? "")) {
    throw new Error("schema_missing");
  }
  if (healthResult.error || !healthResult.data || typeof healthResult.data !== "object") {
    throw new Error("foodcost_queue_health_unavailable");
  }
  const row = healthResult.data as Record<string, unknown>;
  const count = (field: string) => {
    const raw = row[field];
    if (raw === null || raw === undefined || typeof raw === "boolean" || raw === "") {
      throw new Error("foodcost_queue_health_invalid");
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("foodcost_queue_health_invalid");
    return value;
  };
  const health = {
    dateFrom: String(row.date_from), dateTo: String(row.date_to), spotCount: count("spot_count"),
    expectedCells: count("expected_cells"), completedCells: count("completed_cells"),
    missingCells: count("missing_cells"), pendingJobs: count("pending_jobs"),
    runningJobs: count("running_jobs"), retryableJobs: count("retryable_jobs"),
    failedJobs: count("failed_jobs"), historicalRosterVerified: false as const,
  };
  const startDay = Date.parse(`${health.dateFrom}T00:00:00Z`);
  const endDay = Date.parse(`${health.dateTo}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(health.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(health.dateTo) ||
    !Number.isFinite(startDay) || !Number.isFinite(endDay) || endDay - startDay !== 119 * 86_400_000 ||
    new Date(startDay).toISOString().slice(0, 10) !== health.dateFrom ||
    new Date(endDay).toISOString().slice(0, 10) !== health.dateTo ||
    health.dateTo !== new Date(Date.parse(`${kyivToday()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) ||
    health.spotCount !== spotIds.length || health.expectedCells !== 120 * health.spotCount ||
    health.completedCells + health.missingCells !== health.expectedCells || row.historical_roster_verified !== false) {
    throw new Error("foodcost_queue_health_invalid");
  }
  summary.remaining = health.missingCells > 0;
  const status = health.missingCells === 0 ? "complete" as const : "partial" as const;
  return { ...summary, status, health };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getServerSupabase: vi.fn(), loadVerifiedCurrentFoodcostSpotIds: vi.fn(),
  syncPosterSalesSpotDay: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: mocked.getServerSupabase }));
vi.mock("../foodcostRecentNetwork", () => ({
  loadVerifiedCurrentFoodcostSpotIds: mocked.loadVerifiedCurrentFoodcostSpotIds,
}));
vi.mock("../posterSalesSync", () => ({ syncPosterSalesSpotDay: mocked.syncPosterSalesSpotDay }));

import { syncPosterFoodcostSalesNightly } from "../foodcostSalesNightlyWorker";

const originalService = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalPoster = process.env.POSTER_TOKEN;

function isoDayOffset(offset: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (kind: string) => parts.find((item) => item.type === kind)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

function installDb(options: { job?: Record<string, unknown>; jobs?: Record<string, unknown>[];
  claim?: unknown; failureResult?: string; priorRun?: boolean; health?: Record<string, unknown>;
  healthError?: { code: string } } = {}) {
  let claimCount = 0;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const signals: AbortSignal[] = [];
  const abortable = <T,>(promise: Promise<T>) => Object.assign(promise, {
    abortSignal(signal: AbortSignal) { signals.push(signal); return promise; },
  });
  const db = {
    rpc: vi.fn((method: string, args: Record<string, unknown>) => abortable((async () => {
      calls.push([method, args]);
      if (method === "seed_foodcost_sales_backfill_jobs") return { data: 0, error: null };
      if (method === "claim_foodcost_sales_backfill_job") {
        claimCount++;
        if (options.claim !== undefined && claimCount === 1) return {
          data: Array.isArray(options.claim) ? options.claim.map((item) => ({ ...item,
            owner_token: item.owner_token === "filled-by-claim" ? args.p_owner_token : item.owner_token,
          })) : options.claim, error: null,
        };
        const candidate = options.jobs?.[claimCount - 1] ?? (claimCount === 1 ? options.job : undefined);
        const job = candidate ? { ...candidate, owner_token: args.p_owner_token } : null;
        return { data: job ? [job] : [], error: null };
      }
      if (method === "complete_foodcost_sales_backfill_job") return { data: true, error: null };
      if (method === "fail_foodcost_sales_backfill_job") return { data: options.failureResult ?? "retryable_failed", error: null };
      throw new Error(`unexpected_rpc_${method}`);
    })())),
    from(table: string) {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        query[method] = vi.fn(() => query);
      }
      query.abortSignal = vi.fn(() => query);
      query.maybeSingle = vi.fn(() => abortable(Promise.resolve(table === "foodcost_sales_runs"
        ? { data: options.priorRun === false ? null : { id: "completed-run" }, error: null }
        : { data: {
          date_from: isoDayOffset(-120), date_to: isoDayOffset(-1), spot_count: 1,
          expected_cells: 120, completed_cells: 119, missing_cells: 1,
          pending_jobs: 0, running_jobs: 0, retryable_jobs: 1, failed_jobs: 0,
          historical_roster_verified: false,
          ...options.health,
        }, error: options.healthError ?? null })));
      return query;
    },
  };
  mocked.getServerSupabase.mockReturnValue(db);
  return { db, calls, signals };
}

function validJob(overrides: Record<string, unknown> = {}) {
  return { business_date: isoDayOffset(-1), spot_id: 1, attempt_no: 1,
    owner_token: "filled-by-claim", lease_expires_at: new Date(Date.now() + 600_000).toISOString(), ...overrides };
}

describe("nightly missing-only foodcost worker", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    process.env.POSTER_TOKEN = "test-poster-token";
    mocked.getServerSupabase.mockReset();
    mocked.loadVerifiedCurrentFoodcostSpotIds.mockReset().mockResolvedValue([1]);
    mocked.syncPosterSalesSpotDay.mockReset();
  });
  afterEach(() => {
    if (originalService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalService;
    if (originalPoster === undefined) delete process.env.POSTER_TOKEN;
    else process.env.POSTER_TOKEN = originalPoster;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips Poster for an already completed pair and reports partial horizon health", async () => {
    const { db, calls, signals } = installDb({ job: validJob() });
    const result = await syncPosterFoodcostSalesNightly();
    expect(result).toMatchObject({ status: "partial", remaining: true,
      health: { expectedCells: 120, completedCells: 119, missingCells: 1,
        historicalRosterVerified: false } });
    expect(mocked.syncPosterSalesSpotDay).not.toHaveBeenCalled();
    expect(calls.find(([method]) => method === "complete_foodcost_sales_backfill_job")?.[1])
      .toMatchObject({ p_run_id: "completed-run", p_outcome: "already_completed" });
    expect(db.rpc.mock.calls.filter(([method]) => method === "claim_foodcost_sales_backfill_job")).toHaveLength(2);
    expect(signals.length).toBeGreaterThanOrEqual(5);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it("rejects an out-of-roster claim before any per-job operation", async () => {
    installDb({ job: validJob({ spot_id: 9 }) });
    await expect(syncPosterFoodcostSalesNightly()).rejects.toThrow("foodcost_queue_invalid_claim");
    expect(mocked.syncPosterSalesSpotDay).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong owner", () => validJob({ owner_token: "forged-owner" })],
    ["expired lease", () => validJob({ lease_expires_at: new Date(Date.now() - 1000).toISOString() })],
    ["today", () => validJob({ business_date: isoDayOffset(0) })],
    ["older than 120 days", () => validJob({ business_date: isoDayOffset(-121) })],
    ["noncanonical date", () => validJob({ business_date: "2026-9-1" })],
  ])("rejects a claim with %s", async (_label, makeJob) => {
    installDb({ claim: [makeJob()] });
    await expect(syncPosterFoodcostSalesNightly()).rejects.toThrow("foodcost_queue_invalid_claim");
  });

  it("rejects a claim RPC that returns more than one row", async () => {
    installDb({ claim: [validJob(), validJob()] });
    await expect(syncPosterFoodcostSalesNightly()).rejects.toThrow("foodcost_queue_invalid_claim");
  });

  it("validates the job cap and never claims when it is invalid", async () => {
    installDb();
    await expect(syncPosterFoodcostSalesNightly(new Date(), { maxJobs: 81 }))
      .rejects.toThrow("invalid_foodcost_worker_limit");
    expect(mocked.getServerSupabase).not.toHaveBeenCalled();
  });

  it("does not claim when the 110-second next-job reserve is unavailable", async () => {
    const { db } = installDb();
    const base = Date.now();
    vi.spyOn(Date, "now").mockImplementationOnce(() => base).mockImplementation(() => base + 101_000);
    const result = await syncPosterFoodcostSalesNightly();
    expect(result.processedJobs).toBe(0);
    expect(db.rpc.mock.calls.filter(([method]) => method === "claim_foodcost_sales_backfill_job")).toHaveLength(0);
  });

  it("limits claims to maxJobs and returns remaining health", async () => {
    const { db } = installDb({ jobs: [validJob(), validJob()] });
    const result = await syncPosterFoodcostSalesNightly(new Date(), { maxJobs: 1 });
    expect(result.processedJobs).toBe(1);
    expect(result.remaining).toBe(true);
    expect(db.rpc.mock.calls.filter(([method]) => method === "claim_foodcost_sales_backfill_job")).toHaveLength(1);
  });

  it.each([
    ["null counts", { missing_cells: null }],
    ["incorrect history flag", { historical_roster_verified: true }],
    ["stale range", { date_to: isoDayOffset(-2) }],
  ])("rejects health with %s", async (_label, override) => {
    installDb({ health: override });
    await expect(syncPosterFoodcostSalesNightly()).rejects.toThrow("foodcost_queue_health_invalid");
  });

  it("awaits an aborted job, records a safe deadline failure, and continues", async () => {
    const { db, calls } = installDb({ job: validJob(), priorRun: false });
    mocked.syncPosterSalesSpotDay.mockImplementation((_date: string, _spot: number,
      _ids: ReadonlySet<number>, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = await syncPosterFoodcostSalesNightly(new Date(), { jobDeadlineMs: 5 });
    expect(result.timedOutJobs).toBe(1);
    expect(calls.find(([method]) => method === "fail_foodcost_sales_backfill_job")?.[1])
      .toMatchObject({ p_error_code: "backfill_deadline" });
    expect(db.rpc.mock.calls.some(([method]) => method === "complete_foodcost_sales_backfill_job")).toBe(false);
  });

  it("reports complete only when the entire horizon is covered", async () => {
    installDb({ health: { completed_cells: 120, missing_cells: 0, retryable_jobs: 0 } });
    const result = await syncPosterFoodcostSalesNightly();
    expect(result).toMatchObject({ status: "complete", remaining: false, processedJobs: 0 });
  });

  it("reports a missing health view as schema_missing", async () => {
    installDb({ healthError: { code: "PGRST205" } });
    await expect(syncPosterFoodcostSalesNightly()).rejects.toThrow("schema_missing");
  });

  it("journals a failure and then processes the next job", async () => {
    const { calls } = installDb({ jobs: [validJob(), validJob({ business_date: isoDayOffset(-2) })], priorRun: false });
    mocked.syncPosterSalesSpotDay.mockRejectedValueOnce(new Error("poster_unavailable"))
      .mockResolvedValueOnce({ runId: "new-run", alreadyCompleted: false });
    const result = await syncPosterFoodcostSalesNightly();
    expect(result).toMatchObject({ processedJobs: 2, completedJobs: 1, failedJobs: 1, status: "partial" });
    expect(calls.find(([method]) => method === "fail_foodcost_sales_backfill_job")?.[1])
      .toMatchObject({ p_error_code: "poster_unavailable" });
    expect(calls.find(([method]) => method === "complete_foodcost_sales_backfill_job")?.[1])
      .toMatchObject({ p_run_id: "new-run", p_outcome: "completed" });
  });

  it("stops after a schema failure has been journaled", async () => {
    const { db } = installDb({ jobs: [validJob(), validJob()], priorRun: false });
    mocked.syncPosterSalesSpotDay.mockRejectedValue(new Error("schema_missing"));
    await expect(syncPosterFoodcostSalesNightly()).rejects.toThrow("schema_missing");
    expect(db.rpc.mock.calls.filter(([method]) => method === "fail_foodcost_sales_backfill_job")).toHaveLength(1);
    expect(db.rpc.mock.calls.filter(([method]) => method === "claim_foodcost_sales_backfill_job")).toHaveLength(1);
  });

  it("does not continue when failure journaling rejects the owner", async () => {
    installDb({ job: validJob(), priorRun: false, failureResult: "lease_lost" });
    mocked.syncPosterSalesSpotDay.mockRejectedValue(new Error("poster_unavailable"));
    await expect(syncPosterFoodcostSalesNightly()).rejects.toThrow("foodcost_queue_fail_rejected");
  });
});

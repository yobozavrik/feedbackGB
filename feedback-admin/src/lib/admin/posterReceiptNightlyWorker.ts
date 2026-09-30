import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase";
import { syncPosterReceiptDay } from "./posterReceiptSync";

const LOOKBACK_DAYS = 7;
const WORKER_DEADLINE_MS = 260_000;
const LEASE_SECONDS = 360;

type Audit = {
  status: "verified";
  day: string;
  runId: string;
  receipts: number;
  lines: number;
  clients: number;
  sourcePages: number;
};

type Claim = {
  status: "claimed" | "already_verified" | "in_progress";
  day: string;
  runId?: string;
  attemptNo?: number;
};

type ImportResult = {
  runId: string;
  receipts: number;
  lines: number;
  clients: number;
  sourcePages: number;
  replayed: boolean;
};

export type ReceiptNightlyDependencies = {
  claim: (accountId: string, day: string, ownerToken: string,
    leaseSeconds: number, signal: AbortSignal) => Promise<Claim>;
  audit: (day: string, runId: string | null, signal: AbortSignal) => Promise<Audit>;
  complete: (accountId: string, day: string, ownerToken: string,
    audit: Audit, signal: AbortSignal) => Promise<boolean>;
  fail: (accountId: string, day: string, ownerToken: string,
    code: string, signal: AbortSignal) => Promise<boolean>;
  importDay: (day: string, env: Record<string, string | undefined>,
    signal: AbortSignal) => Promise<ImportResult>;
  ownerToken: () => string;
};

function kyivToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (kind: string) => parts.find((item) => item.type === kind)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Oldest first: a missed day cannot remain hidden behind a new yesterday forever. */
export function receiptCronCandidateDays(now: Date): string[] {
  const today = kyivToday(now);
  const base = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(base)) throw new Error("receipt_cron_clock_invalid");
  return Array.from({ length: LOOKBACK_DAYS }, (_, index) =>
    new Date(base - (LOOKBACK_DAYS - index) * 86_400_000).toISOString().slice(0, 10));
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "";
  return /^receipt_[a-z_]{1,72}$/.test(value) ? value : "receipt_cron_failed";
}

function assertEnv(env: Record<string, string | undefined>): string {
  if (env.POSTER_RECEIPT_IMPORT_ENABLED !== "true") {
    throw new Error("receipt_publishing_disabled");
  }
  if (!env.POSTER_TOKEN) throw new Error("receipt_token_missing");
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("receipt_service_config_missing");
  }
  const accountId = env.POSTER_RECEIPT_ACCOUNT_ID ?? env.POSTER_ACCOUNT;
  if (!accountId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(accountId)) {
    throw new Error("receipt_account_config_missing");
  }
  return accountId;
}

/**
 * Bounded workflow: claim at most one missing closed day, import it once, then
 * verify the immutable archive before marking the operational journal complete.
 */
export async function runPosterReceiptNightly(now: Date,
  env: Record<string, string | undefined>, dependencies: ReceiptNightlyDependencies,
  requestSignal?: AbortSignal) {
  const accountId = assertEnv(env);
  const workerSignal = requestSignal
    ? AbortSignal.any([requestSignal, AbortSignal.timeout(WORKER_DEADLINE_MS)])
    : AbortSignal.timeout(WORKER_DEADLINE_MS);
  const ownerToken = dependencies.ownerToken();
  if (!/^[0-9a-f-]{36}$/.test(ownerToken)) throw new Error("receipt_cron_owner_invalid");

  const days = receiptCronCandidateDays(now);
  let claimedDay: string | null = null;
  let lastVerifiedRunId: string | null = null;

  for (const day of days) {
    workerSignal.throwIfAborted();
    const claim = await dependencies.claim(accountId, day, ownerToken,
      LEASE_SECONDS, workerSignal);
    if (claim.day !== day) throw new Error("receipt_cron_claim_invalid");
    if (claim.status === "already_verified") {
      if (!claim.runId || !/^[0-9a-f-]{36}$/.test(claim.runId)) {
        throw new Error("receipt_cron_claim_invalid");
      }
      lastVerifiedRunId = claim.runId;
      continue;
    }
    if (claim.status === "in_progress") {
      return { status: "in_progress" as const, day, checkedDays: days.indexOf(day) + 1 };
    }
    if (claim.status !== "claimed" || !Number.isSafeInteger(claim.attemptNo) ||
      Number(claim.attemptNo) < 1) throw new Error("receipt_cron_claim_invalid");
    claimedDay = day;
    break;
  }

  if (!claimedDay) {
    const latestDay = days[days.length - 1];
    const audit = await dependencies.audit(latestDay, lastVerifiedRunId, workerSignal);
    return { status: "up_to_date" as const, day: latestDay,
      runId: audit.runId, receipts: audit.receipts, lines: audit.lines,
      clients: audit.clients, checkedDays: days.length };
  }

  try {
    const imported = await dependencies.importDay(claimedDay, env, workerSignal);
    const audit = await dependencies.audit(claimedDay, imported.runId, workerSignal);
    if (audit.receipts !== imported.receipts || audit.lines !== imported.lines ||
      audit.clients !== imported.clients || audit.sourcePages !== imported.sourcePages) {
      throw new Error("receipt_cron_audit_mismatch");
    }
    const completed = await dependencies.complete(accountId, claimedDay, ownerToken,
      audit, workerSignal);
    if (!completed) throw new Error("receipt_cron_lease_lost");
    return { status: "verified" as const, day: claimedDay, runId: audit.runId,
      receipts: audit.receipts, lines: audit.lines, clients: audit.clients,
      sourcePages: audit.sourcePages, replayed: imported.replayed };
  } catch (error) {
    // A timed-out publication can still have committed. Read back before writing
    // a failure state; never rebuild and blindly publish a second bundle.
    try {
      const audit = await dependencies.audit(claimedDay, null,
        AbortSignal.timeout(20_000));
      const completed = await dependencies.complete(accountId, claimedDay,
        ownerToken, audit, AbortSignal.timeout(10_000));
      if (completed) {
        return { status: "verified_after_ambiguous_result" as const,
          day: claimedDay, runId: audit.runId, receipts: audit.receipts,
          lines: audit.lines, clients: audit.clients, sourcePages: audit.sourcePages };
      }
    } catch {
      // The original safe error is retained below.
    }
    const code = safeErrorCode(error);
    const failed = await dependencies.fail(accountId, claimedDay, ownerToken,
      code, AbortSignal.timeout(10_000));
    if (!failed) throw new Error("receipt_cron_lease_lost");
    throw new Error(code);
  }
}

function bounded<T>(query: T, signal: AbortSignal): T {
  const candidate = query as { abortSignal?: (value: AbortSignal) => T };
  if (typeof candidate.abortSignal !== "function") {
    throw new Error("receipt_supabase_abort_unsupported");
  }
  return candidate.abortSignal(signal);
}

function dbError(error: { code?: string; message?: string } | null): never {
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error?.code ?? "")) {
    throw new Error("receipt_schema_missing");
  }
  throw new Error("receipt_cron_db_failed");
}

function parseCount(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("receipt_cron_audit_invalid");
  }
  return number;
}

function parseAudit(value: unknown, day: string): Audit {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("receipt_cron_audit_invalid");
  }
  const row = value as Record<string, unknown>;
  if (row.status !== "verified" || row.day !== day ||
    typeof row.run_id !== "string" || !/^[0-9a-f-]{36}$/.test(row.run_id)) {
    throw new Error("receipt_cron_audit_failed");
  }
  for (const field of ["invalid_payloads", "page_mismatches", "identity_mismatches",
    "client_link_errors", "duplicate_identities", "line_count_mismatches"]) {
    if (parseCount(row[field]) !== 0) throw new Error("receipt_cron_audit_failed");
  }
  const receipts = parseCount(row.receipts), lines = parseCount(row.lines);
  if (receipts !== parseCount(row.declared_receipts) ||
    lines !== parseCount(row.declared_lines) ||
    receipts !== parseCount(row.source_items)) {
    throw new Error("receipt_cron_audit_failed");
  }
  return { status: "verified", day, runId: row.run_id,
    receipts, lines, clients: parseCount(row.clients),
    sourcePages: parseCount(row.source_pages) };
}

async function loadRoster(token: string, signal?: AbortSignal): Promise<unknown> {
  const operationSignal = signal ?? AbortSignal.timeout(20_000);
  const url = new URL("https://joinposter.com/api/access.getSpots");
  url.searchParams.set("token", token);
  const response = await fetch(url, { cache: "no-store", redirect: "error",
    signal: AbortSignal.any([operationSignal, AbortSignal.timeout(20_000)]) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error("receipt_roster_unavailable");
  }
  if (!response.body) throw new Error("receipt_roster_invalid");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024 * 1024) throw new Error("receipt_roster_invalid");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.concat(chunks, length).toString("utf8")); }
  catch { throw new Error("receipt_roster_invalid"); }
  if (!body || body.error || !Array.isArray(body.response)) {
    throw new Error("receipt_roster_invalid");
  }
  return body.response;
}

function productionDependencies(): ReceiptNightlyDependencies {
  const db = getServerSupabase();
  if (!db) throw new Error("receipt_service_config_missing");
  const rpc = async (method: string, args: Record<string, unknown>,
    signal: AbortSignal) => {
    const result = await bounded(db.rpc(method, args), signal);
    if (result.error) dbError(result.error);
    return result.data;
  };
  return {
    ownerToken: randomUUID,
    async claim(accountId, day, ownerToken, leaseSeconds, signal) {
      const value = await rpc("claim_poster_receipt_cron_day", {
        p_account_id: accountId, p_day: day, p_owner_token: ownerToken,
        p_lease_seconds: leaseSeconds,
      }, signal);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("receipt_cron_claim_invalid");
      }
      const row = value as Record<string, unknown>;
      if (!["claimed", "already_verified", "in_progress"].includes(String(row.status))) {
        throw new Error("receipt_cron_claim_invalid");
      }
      return { status: row.status as Claim["status"], day: String(row.day),
        runId: typeof row.run_id === "string" ? row.run_id : undefined,
        attemptNo: row.attempt_no === undefined ? undefined : Number(row.attempt_no) };
    },
    async audit(day, runId, signal) {
      const value = await rpc("audit_poster_receipt_day", {
        p_day: day, p_run_id: runId,
      }, signal);
      return parseAudit(value, day);
    },
    async complete(accountId, day, ownerToken, audit, signal) {
      const value = await rpc("complete_poster_receipt_cron_day", {
        p_account_id: accountId, p_day: day, p_owner_token: ownerToken,
        p_run_id: audit.runId, p_receipt_count: audit.receipts,
        p_line_count: audit.lines, p_client_count: audit.clients,
      }, signal);
      return value === true;
    },
    async fail(accountId, day, ownerToken, code, signal) {
      const value = await rpc("fail_poster_receipt_cron_day", {
        p_account_id: accountId, p_day: day, p_owner_token: ownerToken,
        p_error_code: code,
      }, signal);
      return value === true;
    },
    async importDay(day, env, signal) {
      const result = await syncPosterReceiptDay([`--date=${day}`, "--publish"], env, {
        getRoster: loadRoster,
        getRpc: () => async (bundle, rpcSignal) => await bounded(
          db.rpc("import_poster_receipt_bundle", { p_bundle: bundle }), rpcSignal),
      }, signal);
      if (result.status !== "accepted" || !result.publication ||
        result.diagnostics.day !== day) throw new Error("receipt_worker_response_invalid");
      return { runId: result.publication.runId,
        receipts: result.diagnostics.receiptCount,
        lines: result.diagnostics.productLineCount,
        clients: result.diagnostics.clientSnapshots,
        sourcePages: result.diagnostics.sourcePages,
        replayed: result.publication.replayed };
    },
  };
}

export async function syncPosterReceiptsNightly(now = new Date(),
  requestSignal?: AbortSignal) {
  return runPosterReceiptNightly(now, process.env, productionDependencies(), requestSignal);
}

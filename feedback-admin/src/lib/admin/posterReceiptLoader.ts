import { setTimeout as delay } from "node:timers/promises";
import { assertReceiptPagesStable, buildPosterReceiptBundle, buildPlainPosterReceiptBundle, parseReceiptSource,
  ReceiptBundleOptions, ReceiptSourcePage, ReceiptClientReply } from "./posterReceiptBundle";

export class ReceiptLoaderError extends Error {
  constructor(public readonly code: string, public readonly retryable = false,
    public readonly progress?: { stage: string; requestAttempts: number; sourcePages: number; distinctClients: number; completedClientSnapshots: number }) { super(code); }
}
type SourceMethod = "transactions.getTransactions" | "clients.getClient";
type Dependencies = { fetch: typeof fetch; sleep: (ms: number, signal: AbortSignal) => Promise<void>; now: () => Date };
export type ReceiptLoadOptions = Omit<ReceiptBundleOptions, "observedAt"> & { token: string; signal?: AbortSignal;
  requestBudget?: number; timeoutMs?: number; archiveMode?: "encrypted" };
export type PlainReceiptLoadOptions = Omit<ReceiptLoadOptions, "key" | "keyId" | "archiveMode"> & { archiveMode: "raw" };
const defaults: Dependencies = { fetch: (...args) => fetch(...args), sleep: (ms, signal) => delay(ms, undefined, { signal }), now: () => new Date() };
const fail = (code: string): never => { throw new ReceiptLoaderError(code); };
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail("receipt_source_invalid");
  return v as Record<string, unknown>;
}
function integer(v: unknown, max: number, zero = true): number {
  if (typeof v !== "string" || !/^(0|[1-9]\d*)$/.test(v)) return fail("receipt_source_invalid");
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n > max || (!zero && n === 0)) return fail("receipt_source_invalid");
  return n;
}
async function rawBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const max = 32 * 1024 * 1024;
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > max) return fail("receipt_response_too_large");
  if (!response.body) return fail("receipt_source_invalid");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) return fail("receipt_response_too_large");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Backend/CLI only. Read-only Poster calls; no Supabase access, logging or disk persistence.
 * A failed/changed/incomplete day never produces a publishable bundle. No source filtering.
 */
export async function loadPosterReceiptDay(options: ReceiptLoadOptions | PlainReceiptLoadOptions, overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides }, started = deps.now();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(started);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.businessDate) || !Number.isFinite(Date.parse(options.businessDate)) ||
    new Date(options.businessDate).toISOString().slice(0, 10) !== options.businessDate ||
    options.businessDate < "2026-01-01" || options.businessDate >= today) return fail("receipt_day_not_closed");
  if (!options.token || (options.archiveMode !== "raw" && (options.key.length !== 32 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(options.keyId))) ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(options.accountId) || !options.verifiedSpotIds.length || options.verifiedSpotIds.length > 100 ||
    new Set(options.verifiedSpotIds).size !== options.verifiedSpotIds.length || options.verifiedSpotIds.some(v => !/^[1-9]\d*$/.test(v))) return fail("receipt_config_invalid");
  // This is a bounded OFFLINE worker, not a web request. Cold referenced-client enrichment
  // can require more than512 requests. Caller can lower budgets, but cannot remove bounds.
  const requestBudget = options.requestBudget ?? 4096, timeoutMs = options.timeoutMs ?? 900000;
  if (!Number.isSafeInteger(requestBudget) || requestBudget < 2 || requestBudget > 20000 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) return fail("receipt_config_invalid");
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let requests = 0, totalBytes = 0;
  const progress = { stage: "receipt_scans", requestAttempts: 0, sourcePages: 0, distinctClients: 0, completedClientSnapshots: 0 };
  async function request(method: SourceMethod, params: Record<string, string>): Promise<Uint8Array> {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      if (requests >= requestBudget) return fail("receipt_request_budget_exceeded");
      requests++; progress.requestAttempts = requests;
      if (requests > 1) await deps.sleep(attempt ? 500 * 2 ** attempt : 200, signal);
      const url = new URL(method, "https://joinposter.com/api/");
      url.searchParams.set("token", options.token);
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      const perRequestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      let response: Response;
      try { response = await deps.fetch(url, { cache: "no-store", redirect: "error", signal: perRequestSignal }); }
      catch {
        if (signal.aborted) return fail("receipt_load_aborted");
        if (attempt < 2) continue;
        throw new ReceiptLoaderError("receipt_source_unavailable", true);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const transient = response.status === 429 || response.status >= 500;
        if (transient && attempt < 2) continue;
        throw new ReceiptLoaderError("receipt_source_unavailable", transient);
      }
      let raw: Uint8Array;
      try { raw = await rawBody(response, perRequestSignal); }
      catch (e) { if (e instanceof ReceiptLoaderError) throw e; return fail("receipt_source_unavailable"); }
      totalBytes += raw.length;
      if (totalBytes > 64 * 1024 * 1024) return fail("receipt_byte_budget_exceeded");
      const body = record(parseReceiptSource(raw));
      if ((body.error !== undefined && body.error !== null && body.error !== false) || !("response" in body)) return fail("receipt_source_invalid");
      return raw;
    }
    return fail("receipt_source_unavailable");
  }
  async function scan(): Promise<ReceiptSourcePage[]> {
    const pages: ReceiptSourcePage[] = []; let total = -1, needed = 1;
    for (let page = 1; page <= needed; page++) {
      const bytes = await request("transactions.getTransactions", { date_from: options.businessDate, date_to: options.businessDate, per_page: "1000", page: String(page) });
      const source = record(record(parseReceiptSource(bytes)).response), info = record(source.page);
      const declared = integer(source.count, 20000);
      if (total === -1) { total = declared; needed = Math.max(1, Math.ceil(total / 1000)); }
      if (total !== declared || integer(info.page, 128, false) !== page || integer(info.per_page, 1000, false) !== 1000 ||
        !Array.isArray(source.data) || integer(info.count, 1000) !== source.data.length ||
        source.data.length !== Math.min(1000, Math.max(0, total - (page - 1) * 1000))) return fail("receipt_pages_incomplete");
      pages.push({ bytes });
    }
    return pages;
  }
  try {
    const first = await scan(), second = await scan();
    progress.sourcePages = first.length;
    assertReceiptPagesStable(first, second);
    const clients = new Set<string>();
    for (const page of first) {
      const source = record(record(parseReceiptSource(page.bytes)).response);
      for (const row of source.data as unknown[]) {
        const client = record(row).client_id ?? "0";
        if (typeof client !== "string" || !/^(0|[1-9]\d*)$/.test(client) || client.length > 19 || BigInt(client) > 9223372036854775807n) return fail("receipt_source_invalid");
        if (client !== "0") clients.add(client);
      }
    }
    const replies: ReceiptClientReply[] = [];
    progress.stage = "client_snapshots"; progress.distinctClients = clients.size;
    // Known insufficiency fails BEFORE fetching any profiles, rather than wasting a partial batch.
    if (requests + clients.size > requestBudget) return fail("receipt_request_budget_exceeded");
    for (const clientId of clients) {
      replies.push({ clientId, bytes: await request("clients.getClient", { client_id: clientId, "1c": "true" }) });
      progress.completedClientSnapshots++;
    }
    progress.stage = "bundle_validation";
    signal.throwIfAborted();
    const bundle = options.archiveMode === "raw"
      ? buildPlainPosterReceiptBundle({ ...options, observedAt: started.toISOString() }, first, replies)
      : buildPosterReceiptBundle({ ...options, observedAt: started.toISOString() }, first, replies);
    return { bundle, diagnostics: { day: options.businessDate, sourcePages: first.length, receiptCount: bundle.source_count,
      productLineCount: bundle.receipts.reduce((n, r) => n + r.lines.length, 0), clientSnapshots: replies.length,
      requests, sourceBytes: totalBytes, scanStability: "two_identical_scans" as const,
      startedAt: started.toISOString(), finishedAt: deps.now().toISOString() } };
  } catch (error) {
    if (signal.aborted) throw new ReceiptLoaderError("receipt_load_aborted", false, { ...progress });
    if (error instanceof ReceiptLoaderError) throw new ReceiptLoaderError(error.code, error.retryable, { ...progress });
    const safe = new Set(["receipt_pages_incomplete", "receipt_unknown_spot", "receipt_duplicate_transaction",
      "receipt_date_unverified", "receipt_client_incomplete", "receipt_bundle_too_large", "receipt_source_changed", "receipt_source_invalid", "receipt_archive_invalid"]);
    const code = error instanceof Error && safe.has(error.message) ? error.message : "receipt_load_failed";
    throw new ReceiptLoaderError(code, false, { ...progress });
  }
}

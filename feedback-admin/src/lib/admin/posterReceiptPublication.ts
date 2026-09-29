import { setTimeout as delay } from "node:timers/promises";
import { buildPosterReceiptBundle } from "./posterReceiptBundle";
export type ReceiptBundle = ReturnType<typeof buildPosterReceiptBundle>;
export type ReceiptRpc = (bundle: ReceiptBundle, signal: AbortSignal) => Promise<{ data: unknown; error: { code?: string; message?: string } | null; status?: number }>;
export class ReceiptPublishError extends Error {
  readonly sqlState: string | null;
  readonly httpStatus: number | null;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.sqlState = code && (/^[A-Z0-9]{5}$/.test(code) || /^PGRST\d{3}$/.test(code)) ? code : null;
    this.httpStatus = Number.isInteger(status) && status! >= 0 && status! <= 599 ? status! : null;
  }
}
const domainErrors = new Set(["receipt_ingestion_disabled", "receipt_bundle_invalid", "receipt_bundle_incomplete",
  "receipt_client_incomplete", "receipt_run_conflict", "receipt_bundle_stale", "receipt_unknown_spot", "receipt_date_unverified"]);

/** Backend-only. Never log the request bundle or Supabase error details.
 * On ambiguous transport failure retry the EXACT SAME run/ciphertext, not a rebuilt bundle.
 */
export async function publishPosterReceiptBundle(bundle: ReceiptBundle, rpc: ReceiptRpc, options: {
  enabled: boolean; signal?: AbortSignal; sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  if (!options.enabled) throw new Error("receipt_publishing_disabled");
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  const sleep = options.sleep ?? ((ms: number, s: AbortSignal) => delay(ms, undefined, { signal: s }));
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      if (attempt) await sleep(500 * 2 ** attempt, signal);
      let result: Awaited<ReturnType<ReceiptRpc>>;
      try { result = await rpc(bundle, signal); }
      catch { if (signal.aborted) throw new Error("receipt_publish_aborted"); if (attempt < 2) continue; throw new Error("receipt_publish_outcome_unknown"); }
      if (result.error) {
        // Supabase can resolve (not throw) an uncertain transport failure.
        if (result.status === 0) {
          if (attempt < 2) continue;
          throw new ReceiptPublishError("receipt_publish_outcome_unknown", result.error.code, result.status);
        }
        if (domainErrors.has(result.error.message ?? "")) throw new Error(result.error.message);
        if (["42P01", "42883", "PGRST202"].includes(result.error.code ?? "")) throw new Error("receipt_schema_missing");
        if (["40001", "40P01"].includes(result.error.code ?? "") && attempt < 2) continue;
        throw new ReceiptPublishError(result.error.code === "57014" ? "receipt_publish_timeout" : "receipt_publish_failed", result.error.code, result.status);
      }
      const value = result.data;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("receipt_publish_response_invalid");
      const row = value as Record<string, unknown>;
      if (row.run_id !== bundle.run_id || row.status !== "accepted" || typeof row.replayed !== "boolean" ||
        String(row.receipt_count) !== String(bundle.source_count)) throw new Error("receipt_publish_response_invalid");
      return { runId: bundle.run_id, status: "accepted" as const, replayed: row.replayed, receiptCount: bundle.source_count, attempts: attempt + 1 };
    }
    throw new Error("receipt_publish_failed");
  } catch (error) {
    if (signal.aborted) throw new Error("receipt_publish_aborted");
    if (error instanceof Error && /^receipt_[a-z_]+$/.test(error.message)) throw error;
    throw new Error("receipt_publish_failed");
  }
}

export function receiptArchiveConfig(env: Record<string, string | undefined>) {
  const encoded = env.POSTER_RECEIPT_ARCHIVE_KEY;
  const keyId = env.POSTER_RECEIPT_ARCHIVE_KEY_ID, accountId = env.POSTER_RECEIPT_ACCOUNT_ID;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded) || !keyId || !accountId ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(keyId) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(accountId)) throw new Error("receipt_config_invalid");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("receipt_config_invalid");
  return { key, keyId, accountId, enabled: env.POSTER_RECEIPT_IMPORT_ENABLED === "true" };
}

/** No encryption config. Namespace must be stable across token rotation, never the token. */
export function receiptPlainArchiveConfig(env: Record<string, string | undefined>) {
  const accountId = env.POSTER_RECEIPT_ACCOUNT_ID ?? env.POSTER_ACCOUNT;
  if (!accountId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(accountId)) throw new Error("receipt_account_config_missing");
  return { accountId, enabled: env.POSTER_RECEIPT_IMPORT_ENABLED === "true" };
}

import { loadPosterReceiptDay } from "./posterReceiptLoader";
import { publishPosterReceiptBundle, receiptPlainArchiveConfig, ReceiptRpc } from "./posterReceiptPublication";

export function parseReceiptSyncArgs(args: string[]) {
  const dates = args.filter(value => /^--date=\d{4}-\d{2}-\d{2}$/.test(value));
  const modes = args.filter(value => value === "--publish" || value === "--prepare-only");
  if (dates.length !== 1 || modes.length > 1 || args.length !== dates.length + modes.length)
    throw new Error("receipt_cli_arguments_invalid");
  return { businessDate: dates[0].slice(7), publish: modes[0] === "--publish" };
}

type Dependencies = {
  getRoster: (token: string, signal?: AbortSignal) => Promise<unknown>;
  getRpc: () => ReceiptRpc;
  load: typeof loadPosterReceiptDay;
  publish: typeof publishPosterReceiptBundle;
};

/** Explicit operator worker, not an HTTP route. No raw source/bundle returned or logged.
 * Defaults to preparation only; DB write requires BOTH --publish and enabled environment.
 * DB policy is an independent final gate inside the atomic RPC.
 */
export async function syncPosterReceiptDay(args: string[], env: Record<string, string | undefined>,
  dependencies: Pick<Dependencies, "getRoster" | "getRpc"> & Partial<Dependencies>, signal?: AbortSignal) {
  const options = parseReceiptSyncArgs(args), config = receiptPlainArchiveConfig(env);
  if (!env.POSTER_TOKEN) throw new Error("receipt_token_missing");
  if (options.publish && !config.enabled) throw new Error("receipt_publishing_disabled");
  if (options.publish && (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL))
    throw new Error("receipt_service_config_missing");
  signal?.throwIfAborted();
  // Preparation must not even instantiate a database client.
  const rpc = options.publish ? dependencies.getRpc() : null;
  const roster = await dependencies.getRoster(env.POSTER_TOKEN, signal);
  if (!Array.isArray(roster) || !roster.length) throw new Error("receipt_roster_invalid");
  const ids = roster.map(row => row && typeof row === "object" ? String(row.spot_id) : "");
  if (ids.length > 100 || ids.some(id => !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length)
    throw new Error("receipt_roster_invalid");
  const loaded = await (dependencies.load ?? loadPosterReceiptDay)({ token: env.POSTER_TOKEN,
    businessDate: options.businessDate, accountId: config.accountId, archiveMode: "raw",
    verifiedSpotIds: ids, signal });
  const publication = rpc ? await (dependencies.publish ?? publishPosterReceiptBundle)(loaded.bundle, rpc,
    { enabled: config.enabled, signal }) : null;
  return { status: publication ? "accepted" as const : "prepared_only" as const,
    databaseWriteRequested: options.publish, diagnostics: loaded.diagnostics, publication,
    currentRosterCount: ids.length, archiveFormat: "raw-utf8-v1" as const };
}

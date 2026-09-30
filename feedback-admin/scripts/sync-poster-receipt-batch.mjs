/** Resumable month backfill: max three closed days by default, or explicit --all-month.
 * Requires 048 audit RPC for checkpoints. Never prints raw Poster or customer data.
 * Default is read-only. --publish additionally needs POSTER_RECEIPT_IMPORT_ENABLED=true.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseBatchArgs, closedDaysDescending, assertAudit } from "./receipt-batch-core.mjs";

const require = createRequire(import.meta.url);
const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inherited = { ...process.env };
require("@next/env").loadEnvConfig(appDir, false, { info() {}, error() {} });
const appEnv = { ...process.env };
require("@next/env").loadEnvConfig(path.resolve(appDir, ".."), false,
  { info() {}, error() {} }, true);
const env = { ...process.env, ...inherited, ...appEnv };
for (const [name, value] of Object.entries(env)) if (value !== undefined) process.env[name] = value;
const ts = require("typescript"), Module = require("node:module"), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.resolve(appDir, "src", request.slice(2)) : request,
    parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { syncPosterReceiptDay } = require("../src/lib/admin/posterReceiptSync.ts");
const safeCode = error => /^receipt_[a-z_]{1,80}$/.test(error?.message ?? "")
  ? error.message : "receipt_batch_failed";
const output = value => console.log(JSON.stringify(value));

async function importDay(day) {
  const result = await syncPosterReceiptDay([`--date=${day}`, "--publish"], env, {
    getRoster: async (token, signal) => {
      const url = new URL("https://joinposter.com/api/access.getSpots");
      url.searchParams.set("token", token);
      const response = await fetch(url, { cache: "no-store", redirect: "error",
        signal: AbortSignal.any([signal ?? AbortSignal.timeout(20000), AbortSignal.timeout(20000)]) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("receipt_roster_unavailable"); }
      if (!response.body) throw new Error("receipt_roster_invalid");
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > 1024 * 1024) throw new Error("receipt_roster_invalid");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
      if (!body || body.error) throw new Error("receipt_roster_invalid");
      return body.response;
    },
    getRpc: () => {
      const { getServerSupabase } = require("../src/lib/supabase.ts");
      const client = getServerSupabase();
      if (!client) throw new Error("receipt_service_config_missing");
      return (bundle, signal) => client.rpc("import_poster_receipt_bundle", { p_bundle: bundle }).abortSignal(signal);
    },
  });
  if (result.status !== "accepted" || result.databaseWriteRequested !== true ||
      result.publication?.status !== "accepted" ||
      !/^[0-9a-f-]{36}$/.test(result.publication?.runId ?? "") ||
      result.diagnostics?.day !== day) throw new Error("receipt_worker_response_invalid");
  return result;
}

let currentDay = null;
try {
  const options = parseBatchArgs(process.argv.slice(2));
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("receipt_service_config_missing");
  }
  if (options.publish && env.POSTER_RECEIPT_IMPORT_ENABLED !== "true") {
    throw new Error("receipt_publishing_disabled");
  }
  const { createClient } = require("@supabase/supabase-js");
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "feedbackgb" } });
  const todayKyiv = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const days = closedDaysDescending(options.month, todayKyiv);
  const results = [];
  for (const day of days) {
    currentDay = day;
    const { data, error } = await db.rpc("audit_poster_receipt_day", { p_day: day });
    if (error) throw new Error("receipt_batch_audit_unavailable");
    const state = assertAudit(data, day);
    if (state === "verified") continue;
    if (results.length >= options.maxDays) break;
    if (!options.publish) {
      results.push({ day, status: "pending" });
      continue;
    }
    const worker = await importDay(day);
    // If publication timed out or returned an ambiguous status, stop; never rebuild/retry blindly.
    const check = await db.rpc("audit_poster_receipt_day",
      { p_day: day, p_run_id: worker.publication.runId });
    if (check.error) throw new Error("receipt_batch_audit_unavailable");
    assertAudit(check.data, day, worker.publication.runId, worker.diagnostics);
    const row = { day, status: "verified", runId: worker.publication.runId,
      receipts: worker.diagnostics.receiptCount,
      lines: worker.diagnostics.productLineCount,
      clients: worker.diagnostics.clientSnapshots };
    results.push(row);
    output(row);
  }
  output({ status: options.publish ? "batch_complete" : "preview_only",
    month: options.month, maxDays: options.maxDays, results });
} catch (error) {
  output({ status: "stopped", day: currentDay, code: safeCode(error) });
  process.exitCode = 1;
}

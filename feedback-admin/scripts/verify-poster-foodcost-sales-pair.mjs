/** Live read-only reconciliation by default. --check-idempotency explicitly acquires/releases
 * the existing cell lease and repeats queue seed; it must not create another completed run.
 * Prints only safe aggregates/hashes, never tokens or raw product rows.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [date, spotText, ...flags] = process.argv.slice(2);
const spotId = Number(spotText);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isSafeInteger(spotId) || spotId <= 0 ||
    flags.some(flag => flag !== "--check-idempotency") || flags.length > 1) {
  throw new Error("usage: node scripts/verify-poster-foodcost-sales-pair.mjs YYYY-MM-DD SPOT_ID [--check-idempotency]");
}
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const ts = require("typescript");
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.resolve("src", request.slice(2)) : request, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

try {
  const checkIdempotency = flags.length === 1;
  if (checkIdempotency && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    throw new Error("shared_db_nonproduction_write_forbidden");
  }
  if (!process.env.POSTER_TOKEN || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("credentials_missing");
  const db = require("../src/lib/supabase.ts").getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const signal = AbortSignal.timeout(120_000);
  const { loadVerifiedCurrentFoodcostSpotIds } = require("../src/lib/admin/foodcostRecentNetwork.ts");
  const ids = await loadVerifiedCurrentFoodcostSpotIds(signal);
  if (!ids.includes(spotId)) throw new Error("unknown_poster_spot");
  const must = async (query) => {
    const result = await query.abortSignal(signal);
    if (result.error) throw new Error("readback_failed");
    return result;
  };
  const readRun = () => must(db.from("foodcost_sales_runs")
    .select("id,source_row_count,payed_sum_minor,product_profit_minor,product_profit_netto_minor")
    .eq("business_date", date).eq("spot_id", spotId).eq("status", "completed")
    .order("completed_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle());
  const readCount = () => must(db.from("foodcost_sales_runs").select("id", { count: "exact", head: true })
    .eq("business_date", date).eq("spot_id", spotId).eq("status", "completed"));
  const run = (await readRun()).data;
  if (!run || !Number.isSafeInteger(run.source_row_count) || run.source_row_count < 0 || run.source_row_count > 10000) {
    throw new Error("completed_run_missing_or_invalid");
  }
  const raw = await require("../src/lib/admin/posterApi.ts").posterRequest("dash.getProductsSales", {
    date_from: date.replaceAll("-", ""), date_to: date.replaceAll("-", ""), spot_id: String(spotId),
  }, process.env.POSTER_TOKEN, signal);
  const snapshot = require("../src/lib/admin/foodcostSalesSnapshot.ts").buildFoodcostSalesSnapshot(raw);
  const stored = [];
  for (let offset = 0; offset < run.source_row_count; offset += 500) {
    const page = await must(db.from("foodcost_sales_facts")
      .select("source_row_no,product_id,modification_id,category_id_snapshot,product_name_snapshot,category_name_snapshot,quantity,unit,weight_based,payed_sum_minor,product_profit_minor,product_profit_netto_minor,product_sum_minor,bonus_sum_minor,cert_sum_minor,discount_minor")
      .eq("run_id", run.id).order("source_row_no").range(offset, offset + 499));
    stored.push(...page.data);
  }
  const counted = await must(db.from("foodcost_sales_facts").select("source_row_no", { count: "exact", head: true }).eq("run_id", run.id));
  // Independent raw-field integer totals: do not use the ingestion aggregator for this check.
  const rawSum = (key, nullable = false) => {
    if (nullable && raw.some(row => row[key] === null || row[key] === undefined || row[key] === "")) return null;
    return raw.reduce((sum, row) => {
      if (!/^-?\d+$/.test(String(row[key]))) throw new Error("invalid_live_integer");
      return sum + BigInt(row[key]);
    }, 0n).toString();
  };
  const sameMoney = (actual, expected) => expected === null ? actual === null : String(actual) === expected;
  const totals = { paidMinor: rawSum("payed_sum"), profitMinor: rawSum("product_profit"), nettoMinor: rawSum("product_profit_netto", true) };
  const checks = {
    countEqual: raw.length === run.source_row_count && counted.count === raw.length && stored.length === raw.length,
    rowOrderContiguous: stored.every((row, index) => row.source_row_no === index),
    allSourceFieldsEqual: require("../src/lib/admin/foodcostSalesFactsEqual.ts").sameFoodcostSalesFacts(snapshot.facts, stored),
    independentPaidEqual: sameMoney(run.payed_sum_minor, totals.paidMinor),
    independentProfitEqual: sameMoney(run.product_profit_minor, totals.profitMinor),
    independentNettoEqual: sameMoney(run.product_profit_netto_minor, totals.nettoMinor),
  };
  if (!Object.values(checks).every(Boolean)) throw new Error("live_reconciliation_mismatch");
  let idempotency = null;
  if (checkIdempotency) {
    const beforeCount = (await readCount()).count;
    const repeated = await require("../src/lib/admin/posterSalesSync.ts").syncPosterSalesSpotDay(date, spotId, new Set(ids), signal, { missingOnly: true });
    const seed = await must(db.rpc("seed_foodcost_sales_backfill_jobs", { p_spot_ids: ids, p_now: new Date().toISOString() }));
    const afterRun = (await readRun()).data;
    const afterCount = (await readCount()).count;
    idempotency = { sameRun: repeated.runId === run.id && afterRun?.id === run.id,
      alreadyCompleted: repeated.alreadyCompleted === true, beforeCount, afterCount,
      repeatedSeedInserted: seed.data };
    if (!idempotency.sameRun || !idempotency.alreadyCompleted || beforeCount !== afterCount || seed.data !== 0) {
      throw new Error("idempotency_check_failed");
    }
  }
  process.stdout.write(JSON.stringify({ status: "passed", checkedAt: new Date().toISOString(), date, spotId,
    runId: run.id, sourceRows: raw.length, rawResponseSha256: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
    totals, checks, idempotency, scope: "one_completed_pair_not_whole_network" }) + "\n");
} catch (error) {
  const safe = new Set(["shared_db_nonproduction_write_forbidden", "credentials_missing", "supabase_missing",
    "unknown_poster_spot", "readback_failed", "completed_run_missing_or_invalid", "invalid_live_integer",
    "live_reconciliation_mismatch", "idempotency_check_failed", "poster_unavailable", "poster_invalid_response"]);
  process.stderr.write((safe.has(error?.message) ? error.message : "pair_verification_failed") + "\n");
  process.exitCode = 1;
}

/** Read-only plan verification: live roster, completed run coverage and invoice snapshot.
 * Does not sync, insert, update, or delete. Prints only bounded safe aggregates.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
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
  const { getServerSupabase } = require("../src/lib/supabase.ts");
  const { loadVerifiedCurrentFoodcostSpotIds } = require("../src/lib/admin/foodcostRecentNetwork.ts");
  const { foodcostPeriodWindows } = require("../src/lib/admin/foodcostPeriod.ts");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const db = getServerSupabase(); if (!db) throw new Error("supabase_missing");
  const now = new Date(); const asOf = now.toISOString();
  const spots = await loadVerifiedCurrentFoodcostSpotIds();
  const widest = foodcostPeriodWindows(60, now);
  const runs = [];
  for (let page = 0; page < 20; page++) {
    const result = await db.from("foodcost_sales_runs")
      .select("id,business_date,spot_id,methodology_version,source_fetched_at,completed_at,source_row_count,payed_sum_minor,product_profit_minor,product_profit_netto_minor")
      .eq("status", "completed").in("spot_id", spots).gte("business_date", widest.previous.from)
      .lte("business_date", widest.current.to).lte("completed_at", asOf)
      .order("completed_at", { ascending: false }).order("id", { ascending: false }).range(page * 500, page * 500 + 499);
    if (result.error) throw new Error("runs_read_failed");
    runs.push(...result.data);
    if (result.data.length < 500) break;
    if (page === 19) throw new Error("runs_limit");
  }
  const latest = new Map();
  for (const run of runs) {
    const key = `${run.business_date}:${run.spot_id}`;
    if (!latest.has(key)) latest.set(key, run);
  }
  function coverage(window) {
    const rows = [...latest.values()].filter(row => row.business_date >= window.from && row.business_date <= window.to);
    const valid = rows.filter(row => row.methodology_version === "poster-sales-dual-v1");
    return { from: window.from, to: window.to, completedCells: valid.length, expectedCells: window.dates.length * spots.length,
      versions: [...new Set(rows.map(row => row.methodology_version))], missingNetto: valid.filter(row => row.product_profit_netto_minor == null).length,
      firstSourceFetchedAt: valid.map(row => row.source_fetched_at).sort()[0] ?? null,
      lastSourceFetchedAt: valid.map(row => row.source_fetched_at).sort().at(-1) ?? null };
  }
  const supply = await db.from("poster_supply_cost_runs").select("id,window_start,window_end,expected_supplies,completed_at")
    .eq("status", "completed").order("window_end", { ascending: false }).limit(1).maybeSingle();
  if (supply.error) throw new Error("supply_read_failed");
  let supplyCoverage = null;
  if (supply.data) {
    const docs = await db.from("poster_supply_cost_documents").select("supply_id", { count: "exact", head: true }).eq("run_id", supply.data.id);
    if (docs.error) throw new Error("supply_documents_read_failed");
    supplyCoverage = { from: supply.data.window_start, to: supply.data.window_end, expectedDocuments: supply.data.expected_supplies,
      storedDocuments: docs.count, completedAt: supply.data.completed_at };
  }
  const result = { checkedAt: asOf, readOnly: true, currentRosterVerifiedAgainstPoster: true, historicalRosterVerified: false,
    spotCount: spots.length, periods: [7, 14, 30, 60].map(days => {
      const windows = foodcostPeriodWindows(days, now);
      return { days, current: coverage(windows.current), previous: coverage(windows.previous) };
    }), supply: supplyCoverage };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  const allowlist = new Set(["service_role_missing", "supabase_missing", "poster_token_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
    "poster_unavailable", "poster_invalid_response", "runs_read_failed", "runs_limit", "supply_read_failed", "supply_documents_read_failed"]);
  const raw = error instanceof Error ? error.message : "unknown";
  process.stderr.write((allowlist.has(raw) ? raw : "plan_readback_failed") + "\n");
  process.exitCode = 1;
}

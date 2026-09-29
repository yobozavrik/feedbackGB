/**
 * Explicit bounded operator entry point for the missing-only 120-day worker.
 * Read-only preflight is the default. --execute is required for database writes.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let execute = false;
let maxJobs = 80;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--execute" && !execute) execute = true;
  else if (args[index] === "--max-jobs" && index + 1 < args.length) {
    const value = args[++index];
    if (!/^\d+$/.test(value)) throw new Error("invalid_max_jobs");
    maxJobs = Number(value);
  } else throw new Error("usage: node scripts/sync-poster-foodcost-sales-nightly.mjs [--execute] [--max-jobs 1..80]");
}
if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 80) throw new Error("invalid_max_jobs");

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const ts = require("typescript");
const Module = require("node:module");
const root = path.resolve(process.cwd(), "src");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveSource(request, parent, ...rest) {
  const mapped = request.startsWith("@/") ? path.join(root, request.slice(2)) : request;
  return originalResolve.call(this, mapped, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

function closedKyivDates(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (kind) => parts.find((item) => item.type === kind)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const midnight = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 120 }, (_, index) =>
    new Date(midnight - (index + 1) * 86_400_000).toISOString().slice(0, 10));
}

try {
  if (execute && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    throw new Error("shared_db_nonproduction_write_forbidden");
  }
  const { loadVerifiedCurrentFoodcostSpotIds } = require("../src/lib/admin/foodcostRecentNetwork.ts");
  const spotIds = await loadVerifiedCurrentFoodcostSpotIds(AbortSignal.timeout(15_000));
  if (!execute) {
    const db = require("../src/lib/supabase.ts").getServerSupabase();
    if (!db || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
    const result = await db.from("v_foodcost_sales_backfill_health").select("*").maybeSingle()
      .abortSignal(AbortSignal.timeout(8000));
    if (result.error) throw new Error(["42P01", "42883", "PGRST202", "PGRST205"].includes(result.error.code)
      ? "schema_missing" : "foodcost_health_unavailable");
    const dates = closedKyivDates();
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", dateFrom: dates[dates.length - 1],
      dateTo: dates[0], spotCount: spotIds.length, healthAvailable: Boolean(result.data), writes: false })}\n`);
  } else {
    const { syncPosterFoodcostSalesNightly } = require("../src/lib/admin/foodcostSalesNightlyWorker.ts");
    const result = await syncPosterFoodcostSalesNightly(new Date(), { maxJobs });
    process.stdout.write(`${JSON.stringify({ mode: "execute", ...result })}\n`);
  }
} catch (error) {
  const raw = error instanceof Error ? error.message : "";
  const allowed = new Set(["schema_missing", "service_role_missing", "poster_token_missing",
    "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
    "invalid_poster_spots", "invalid_max_jobs", "foodcost_health_unavailable",
    "shared_db_nonproduction_write_forbidden"]);
  process.stderr.write(`${allowed.has(raw) ? raw : "foodcost_nightly_worker_failed"}\n`);
  process.exitCode = 1;
}

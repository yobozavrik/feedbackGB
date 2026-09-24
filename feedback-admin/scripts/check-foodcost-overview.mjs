/** Read-only operator check: current active stores and one bounded period. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const [dateFrom, dateTo] = process.argv.slice(2);
if (!dateFrom || !dateTo || process.argv.length !== 4) {
  throw new Error("usage: node scripts/check-foodcost-overview.mjs YYYY-MM-DD YYYY-MM-DD");
}

try {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
  const { getServerSupabase } = require("../src/lib/supabase.ts");
  const { loadFoodcostOverview } = require("../src/lib/admin/foodcostOverview.ts");
  const db = getServerSupabase();
  if (!db) throw new Error("supabase_missing");
  const stores = await db.from("v_stores").select("id").order("id");
  if (stores.error) throw new Error("stores_read_failed");
  const spotIds = (stores.data ?? []).map((row) => Number(row.id));
  const result = await loadFoodcostOverview(dateFrom, dateTo, spotIds);
  process.stdout.write(`${JSON.stringify({
    scope: "current_active_v_stores", status: result.status,
    dateFrom, dateTo, spotIds, expectedCells: result.expectedCells,
    completedCells: result.completedCells, missing: result.missing,
    sourceFetchedAt: result.sourceFetchedAt,
    newestSourceFetchedAt: result.newestSourceFetchedAt,
    methodologyVersion: result.methodologyVersion,
    metrics: result.metrics,
    days: result.days,
  })}\n`);
} catch (error) {
  // Never print a provider URL or an untrusted response body.
  const code = error instanceof Error ? error.message : "unknown_error";
  process.stderr.write(`foodcost_overview_failed:${code.slice(0, 120)}\n`);
  process.exitCode = 1;
}

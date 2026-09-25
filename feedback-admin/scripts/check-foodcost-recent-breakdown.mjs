/** Read-only category/product reconciliation for the current three-day window. */
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

try {
  const { loadFoodcostRecentBreakdown } = require("../src/lib/admin/foodcostRecentNetwork.ts");
  const data = await loadFoodcostRecentBreakdown();
  if (data.status !== "complete" || !data.metrics || !data.categories || !data.products) {
    process.stdout.write(`${JSON.stringify({ status: "incomplete", dateFrom: data.dateFrom,
      dateTo: data.dateTo, expectedCells: data.expectedCells, completedCells: data.completedCells })}\n`);
    process.exitCode = 2;
  } else {
    const { getServerSupabase } = require("../src/lib/supabase.ts");
    const db = getServerSupabase();
    if (!db) throw new Error("supabase_missing");
    const catalog = await db.from("v_products").select("id")
      .in("id", data.products.map((row) => row.productId)).limit(5000);
    if (catalog.error) throw new Error("foodcost_catalog_read_failed");
    const catalogIds = new Set((catalog.data ?? []).map((row) => Number(row.id)));
    const missingCatalogIds = data.products.filter((row) => !catalogIds.has(row.productId))
      .map((row) => row.productId);
    const amounts = ["payedSumMinor", "productProfitMinor"];
    const reconcile = (rows) => amounts.every((field) =>
      rows.reduce((sum, row) => sum + row[field], 0) === data.metrics[field]);
    const categoryMatched = reconcile(data.categories);
    const productMatched = reconcile(data.products);
    process.stdout.write(`${JSON.stringify({ status: "complete", dateFrom: data.dateFrom,
      dateTo: data.dateTo, spotCount: data.spotCount, completedCells: data.completedCells,
      expectedCells: data.expectedCells, categoryCount: data.categories.length,
      categoriesWithoutName: data.categories.filter((row) => !row.displayName && row.categoryId !== null).length,
      namesFromCurrentPoster: data.categories.filter((row) => row.nameSource === "current_poster_catalog").length,
      categoryNameConflicts: data.categories.filter((row) => row.categoryNameConflict).length,
      productCount: data.products.length, categoryMatched, productMatched,
      productNameConflicts: data.products.filter((row) => row.productNameConflict).length,
      categoryConflicts: data.products.filter((row) => row.categoryConflict).length,
      unitConflicts: data.products.filter((row) => row.unitConflict).length,
      productsMissingFromCurrentCatalog: missingCatalogIds.length,
      missingCatalogIdSample: missingCatalogIds.slice(0, 10),
      payedSumMinor: data.metrics.payedSumMinor,
      productProfitMinor: data.metrics.productProfitMinor })}\n`);
    if (!categoryMatched || !productMatched) process.exitCode = 2;
  }
} catch (error) {
  const raw = error instanceof Error ? error.message : "unknown_error";
  const safe = ["schema_missing", "service_role_missing", "poster_token_missing",
    "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
    "foodcost_read_facts_limit", "foodcost_read_runs_limit",
    "foodcost_catalog_read_failed"].includes(raw) ? raw : "foodcost_breakdown_failed";
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}

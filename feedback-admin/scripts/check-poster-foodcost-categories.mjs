/** Read-only Poster category schema probe; never prints token or request URL. */
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
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

try {
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("poster_token_missing");
  const { posterRequest } = require("../src/lib/admin/posterApi.ts");
  const result = await posterRequest("menu.getCategories", {}, token);
  if (!Array.isArray(result)) throw new Error("poster_categories_invalid_response");
  const categories = result.map((entry) => ({
    id: Number(entry?.category_id), name: typeof entry?.category_name === "string" ? entry.category_name : null,
  }));
  const { loadFoodcostRecentBreakdown } = require("../src/lib/admin/foodcostRecentNetwork.ts");
  const breakdown = await loadFoodcostRecentBreakdown();
  if (breakdown.status !== "complete" || !breakdown.categories) throw new Error("foodcost_breakdown_incomplete");
  const known = new Set(categories.map((row) => row.id));
  const unmatched = breakdown.categories.filter((row) => row.categoryId !== null && !known.has(row.categoryId))
    .map((row) => row.categoryId);
  process.stdout.write(`${JSON.stringify({ count: categories.length, sample: categories.slice(0, 5),
    soldCategoryCount: breakdown.categories.length, unmatchedSoldIds: unmatched })}\n`);
} catch (error) {
  const raw = error instanceof Error ? error.message : "unknown_error";
  const safe = ["poster_token_missing", "poster_categories_invalid_response"].includes(raw)
    ? raw : "poster_categories_probe_failed";
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}

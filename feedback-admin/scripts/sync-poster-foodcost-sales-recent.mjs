/**
 * Operator entry point for the approved last-3-closed-Kyiv-days window.
 * Dry-run is default. --write requires migration 038 and staging QA first.
 * This file is NOT a scheduler and is not referenced by vercel.json.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] ?? "--dry-run";
if (!["--dry-run", "--write"].includes(mode) || process.argv.length > 3) {
  throw new Error("usage: node scripts/sync-poster-foodcost-sales-recent.mjs [--dry-run|--write]");
}

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
  const { lastThreeClosedKyivDates, syncPosterSalesRecentDays } =
    require("../src/lib/admin/posterSalesSync.ts");
  if (mode === "--dry-run") {
    const { posterRequest } = require("../src/lib/admin/posterApi.ts");
    const token = process.env.POSTER_TOKEN;
    if (!token) throw new Error("poster_token_missing");
    const spots = await posterRequest("access.getSpots", {}, token);
    if (!Array.isArray(spots) || !spots.length || spots.length > 100 ||
      spots.some((spot) => !Number.isSafeInteger(Number(spot?.spot_id)) || Number(spot.spot_id) <= 0) ||
      new Set(spots.map((spot) => Number(spot.spot_id))).size !== spots.length) {
      throw new Error("invalid_poster_spots");
    }
    const dates = lastThreeClosedKyivDates(new Date());
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", dates, spotCount: spots.length,
      expectedCells: dates.length * spots.length, writes: false })}\n`);
  } else {
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
      throw new Error("shared_db_preview_write_forbidden");
    }
    const result = await syncPosterSalesRecentDays();
    process.stdout.write(`${JSON.stringify({ mode: "write", ...result })}\n`);
  }
} catch (error) {
  const raw = error instanceof Error ? error.message : "unknown_error";
  const safe = /^(schema_missing|service_role_missing|poster_token_missing|supabase_missing|invalid_poster_spots|foodcost_sync_in_progress|shared_db_preview_write_forbidden|foodcost_db_[a-z_]+_[A-Z0-9]+)$/.test(raw)
    ? raw : "foodcost_recent_sync_failed";
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}

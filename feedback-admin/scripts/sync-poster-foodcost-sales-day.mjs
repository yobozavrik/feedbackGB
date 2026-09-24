/**
 * Explicit, bounded operator CLI for one closed Kyiv day and one Poster spot.
 * Dry-run is the default. --write is required for Supabase mutation.
 * --verify compares the latest completed snapshot with a fresh Poster read.
 * --verify-detail also prints bounded product-level numeric differences.
 * Never print a Poster URL, token, Supabase key, or raw response body.
 */
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

const date = process.argv[2];
const spotId = Number(process.argv[3]);
const mode = process.argv[4] ?? "--dry-run";
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isSafeInteger(spotId) || spotId <= 0 ||
  !["--dry-run", "--write", "--verify", "--verify-detail"].includes(mode) || process.argv.length > 5) {
  throw new Error("usage: node scripts/sync-poster-foodcost-sales-day.mjs YYYY-MM-DD SPOT_ID [--dry-run|--write|--verify|--verify-detail]");
}

try {
if (mode === "--dry-run" || mode === "--verify" || mode === "--verify-detail") {
  const { posterRequest } = require("../src/lib/admin/posterApi.ts");
  const { buildFoodcostSalesSnapshot } = require("../src/lib/admin/foodcostSalesSnapshot.ts");
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("poster_token_missing");
  const spots = await posterRequest("access.getSpots", {}, token);
  if (!Array.isArray(spots) || !spots.some((spot) => Number(spot?.spot_id) === spotId)) {
    throw new Error("unknown_poster_spot");
  }
  const compact = date.replaceAll("-", "");
  const raw = await posterRequest("dash.getProductsSales", {
    date_from: compact, date_to: compact, spot_id: String(spotId),
  }, token);
  const snapshot = buildFoodcostSalesSnapshot(raw);
  if (mode === "--dry-run") {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", date, spotId,
      checkedAt: new Date().toISOString(), rows: snapshot.sourceRowCount,
      paidMinor: snapshot.payedSumMinor, profitMinor: snapshot.productProfitMinor,
      profitNettoMinor: snapshot.productProfitNettoMinor })}\n`);
  } else {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_missing");
    const { getServerSupabase } = require("../src/lib/supabase.ts");
    const db = getServerSupabase();
    if (!db) throw new Error("supabase_missing");
    const latest = await db.from("foodcost_sales_runs")
      .select("id,source_row_count,payed_sum_minor,product_profit_minor,product_profit_netto_minor,source_fetched_at")
      .eq("business_date", date).eq("spot_id", spotId).eq("status", "completed")
      .order("completed_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).single();
    if (latest.error || !latest.data) throw new Error(`verify_run_${latest.error?.code ?? "missing"}`);
    const stored = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      const page = await db.from("foodcost_sales_facts").select("*")
        .eq("run_id", latest.data.id).order("source_row_no").range(offset, offset + 499);
      if (page.error) throw new Error(`verify_facts_${page.error.code ?? "unknown"}`);
      stored.push(...(page.data ?? []));
      if ((page.data ?? []).length < 500) break;
      if (offset === 9500) throw new Error("verify_facts_limit");
    }
    const columns = ["product_id", "modification_id", "category_id_snapshot", "product_name_snapshot",
      "category_name_snapshot", "quantity", "unit", "weight_based", "payed_sum_minor",
      "product_profit_minor", "product_profit_netto_minor", "product_sum_minor", "bonus_sum_minor",
      "cert_sum_minor", "discount_minor"];
    const signature = (fact) => JSON.stringify(columns.map((column) => {
      const value = fact[column];
      if (value === null) return null;
      if (column === "quantity") return Number(value).toFixed(7);
      if (column.endsWith("_minor") || column.endsWith("_id") || column === "category_id_snapshot") return Number(value);
      return value;
    }));
    const counts = new Map();
    for (const fact of stored) {
      const key = signature(fact);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let unmatchedPosterRows = 0;
    for (const fact of snapshot.facts) {
      const key = signature(fact);
      const count = counts.get(key) ?? 0;
      if (count) counts.set(key, count - 1);
      else unmatchedPosterRows++;
    }
    const unmatchedStoredRows = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const result = {
      mode: "verify", date, spotId, runId: latest.data.id,
      sourceFetchedAt: latest.data.source_fetched_at, checkedAt: new Date().toISOString(),
      posterRows: snapshot.sourceRowCount, storedRows: stored.length,
      paidDeltaMinor: snapshot.payedSumMinor - Number(latest.data.payed_sum_minor),
      profitDeltaMinor: snapshot.productProfitMinor - Number(latest.data.product_profit_minor),
      profitNettoDeltaMinor: snapshot.productProfitNettoMinor === null || latest.data.product_profit_netto_minor === null
        ? null : snapshot.productProfitNettoMinor - Number(latest.data.product_profit_netto_minor),
      unmatchedPosterRows, unmatchedStoredRows,
    };
    result.verified = result.posterRows === result.storedRows && result.unmatchedPosterRows === 0 &&
      result.unmatchedStoredRows === 0 && result.paidDeltaMinor === 0 &&
      result.profitDeltaMinor === 0 && result.profitNettoDeltaMinor === 0;
    if (mode === "--verify-detail" && !result.verified) {
      const byProduct = (rows) => {
        const groups = new Map();
        for (const row of rows) {
          const key = `${row.product_id}:${row.modification_id}`;
          const group = groups.get(key) ?? { productId: Number(row.product_id),
            modificationId: Number(row.modification_id), rows: 0, paidMinor: 0,
            profitMinor: 0, nettoMinor: 0, nettoComplete: true };
          group.rows++;
          group.paidMinor += Number(row.payed_sum_minor);
          group.profitMinor += Number(row.product_profit_minor);
          if (row.product_profit_netto_minor == null) group.nettoComplete = false;
          else group.nettoMinor += Number(row.product_profit_netto_minor);
          groups.set(key, group);
        }
        return groups;
      };
      const liveByProduct = byProduct(snapshot.facts);
      const storedByProduct = byProduct(stored);
      const changed = [];
      for (const key of new Set([...liveByProduct.keys(), ...storedByProduct.keys()])) {
        const live = liveByProduct.get(key);
        const old = storedByProduct.get(key);
        if (JSON.stringify(live) === JSON.stringify(old)) continue;
        changed.push({ productId: (live ?? old).productId,
          modificationId: (live ?? old).modificationId,
          liveRows: live?.rows ?? 0, storedRows: old?.rows ?? 0,
          paidDeltaMinor: (live?.paidMinor ?? 0) - (old?.paidMinor ?? 0),
          profitDeltaMinor: (live?.profitMinor ?? 0) - (old?.profitMinor ?? 0),
          nettoDeltaMinor: live?.nettoComplete && old?.nettoComplete
            ? live.nettoMinor - old.nettoMinor : null });
      }
      result.changedProductGroups = changed.length;
      result.productDeltas = changed.sort((a, b) => a.productId - b.productId).slice(0, 20);
      result.productDeltasTruncated = changed.length > 20;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.verified) process.exitCode = 2;
  }
} else {
  const { syncPosterSalesSpotDay } = require("../src/lib/admin/posterSalesSync.ts");
  const result = await syncPosterSalesSpotDay(date, spotId);
  process.stdout.write(`${JSON.stringify({ mode: "write", runId: result.runId,
    unchanged: result.unchanged,
    date: result.businessDate, spotId: result.spotId, sourceFetchedAt: result.sourceFetchedAt,
    rows: result.sourceRowCount, paidMinor: result.payedSumMinor,
    profitMinor: result.productProfitMinor, profitNettoMinor: result.productProfitNettoMinor })}\n`);
}
} catch (error) {
  // The Poster URL embeds a secret; never print a raw fetch exception or body.
  const code = error && typeof error === "object" && "code" in error ? error.code :
    error instanceof Error ? error.message : "unknown_error";
  process.stderr.write(`foodcost_sync_failed:${String(code).slice(0, 120)}\n`);
  process.exitCode = 1;
}

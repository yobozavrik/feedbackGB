/** READ ONLY. Bounded history contract probe; no Supabase writes, raw receipts, PII or secrets. */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const ts = require("typescript");
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.resolve("src", request.slice(2)) : request, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { posterRequest } = require("../src/lib/admin/posterApi.ts");
const probe = require("../src/lib/admin/analyticsHistoryProbe.ts");
const token = process.env.POSTER_TOKEN;
if (!token) throw new Error("poster_token_missing");
if (process.argv.length > 2) throw new Error("usage: node scripts/probe-poster-analytics-history.mjs");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const lastClosed = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const dates = [...new Set(["2026-01-01", "2026-01-15", lastClosed])];
if (dates.some(date => probe.probeIsoDate(date) >= today)) throw new Error("probe_date_not_closed");
const checks = [];
const startedAt = new Date().toISOString();
const deadline = AbortSignal.timeout(180000);
async function check(label, method, params, summarize) {
  try {
    const raw = await posterRequest(method, params, token, deadline);
    const summary = summarize(raw);
    checks.push({ label, method, params, status: "passed", checkedAt: new Date().toISOString(), summary,
      responseSha256: createHash("sha256").update(JSON.stringify(raw)).digest("hex") });
    return raw;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const safe = /^(probe_[a-z_]+|poster_unavailable|poster_invalid_response)$/.test(message) ? message : "probe_failed";
    checks.push({ label, method, params, status: "failed", checkedAt: new Date().toISOString(), code: safe });
    return null;
  }
}
const roster = await check("current-roster", "access.getSpots", {}, probe.probeSpots);
if (roster) {
  const spotId = probe.probeSpots(roster).spotIds[0];
  for (const date of dates) {
    const compact = date.replaceAll("-", "");
    await check(`network-sales-${date}`, "dash.getProductsSales", { date_from: compact, date_to: compact }, probe.probeSales);
    await check(`spot-${spotId}-sales-${date}`, "dash.getProductsSales", { date_from: compact, date_to: compact, spot_id: String(spotId) }, probe.probeSales);
    const supplies = await check(`supplies-${date}`, "storage.getSupplies", { dateFrom: compact, dateTo: compact },
      raw => probe.probeSupplies(raw, date, date));
    if (supplies) {
      const supplyId = probe.probeSupplies(supplies, date, date).sampleSupplyId;
      if (supplyId) await check(`supply-lines-${date}`, "storage.getSupplyIngredients", { supply_id: String(supplyId) }, probe.probeSupplyLines);
    }
  }
  for (const date of ["2026-01-15", lastClosed]) {
    const receipts = await check(`receipt-page-${date}`, "transactions.getTransactions", { date_from: date, date_to: date, per_page: "2", page: "1" },
      raw => probe.probeReceiptPage(raw, 1, 2));
    if (receipts) {
      const compact = date.replaceAll("-", "");
      await check(`receipt-money-bridge-${date}`, "dash.getTransactions", { dateFrom: compact, dateTo: compact, status: "2", timezone: "client" },
        raw => probe.probeReceiptMoneyBridge(receipts, raw));
    }
  }
}
process.stdout.write(JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), readOnly: true,
  status: checks.some(row => row.status !== "passed") ? "failed" : "passed", checks,
  limits: ["Selected dates and one spot only; not full year coverage", "Receipts are page samples, not full-day imports",
    "Fiscal flag does not establish all business refunds", "Historical store/storage validity intervals are not confirmed"] }, null, 2) + "\n");
if (checks.some(row => row.status !== "passed")) process.exitCode = 1;

/**
 * Projects already accepted immutable receipt days into safe analytics facts.
 * Default is read-only preview. --publish invokes the service-role-only RPC.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inherited = { ...process.env };
require("@next/env").loadEnvConfig(appDir, false, { info() {}, error() {} });
const appEnv = { ...process.env };
require("@next/env").loadEnvConfig(path.resolve(appDir, ".."), false,
  { info() {}, error() {} }, true);
const env = { ...process.env, ...inherited, ...appEnv };

const args = process.argv.slice(2);
const monthArg = args.find((value) => value.startsWith("--month="));
const maxArg = args.find((value) => value.startsWith("--max-days="));
const publish = args.includes("--publish");
if (!monthArg || args.some((value) => !value.startsWith("--month=") &&
  !value.startsWith("--max-days=") && value !== "--publish")) {
  throw new Error("receipt_analytics_cli_arguments_invalid");
}
const month = monthArg.slice(8);
if (!/^2026-(0[1-9]|1[0-2])$/.test(month)) throw new Error("receipt_analytics_cli_arguments_invalid");
const maxDays = maxArg ? Number(maxArg.slice(11)) : 3;
if (!Number.isSafeInteger(maxDays) || maxDays < 1 || maxDays > 31) {
  throw new Error("receipt_analytics_cli_arguments_invalid");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("receipt_service_config_missing");
}

const { createClient } = require("@supabase/supabase-js");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "feedbackgb" } });
const [year, monthNumber] = month.split("-").map(Number);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
const days = Array.from({ length: last }, (_, index) =>
  `${month}-${String(index + 1).padStart(2, "0")}`).filter((day) => day < today);
const safeStatus = new Set(["verified", "missing_source", "ambiguous_source", "missing_projection", "invalid"]);
const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

let changed = 0;
let stoppedDay = null;
try {
  const results = [];
  const missingSource = [];
  const coverage = { verifiedDays: 0, receipts: 0, lines: 0, eligibleReceipts: 0,
    fiscalReturns: 0, otherExcluded: 0 };
  for (const day of days) {
    stoppedDay = day;
    const before = await db.rpc("audit_poster_receipt_analytics_day", { p_day: day });
    if (before.error || !before.data || !safeStatus.has(before.data.status)) {
      throw new Error("receipt_analytics_audit_unavailable");
    }
    if (before.data.status === "verified") {
      coverage.verifiedDays += 1;
      coverage.receipts += Number(before.data.receipts);
      coverage.lines += Number(before.data.lines);
      coverage.eligibleReceipts += Number(before.data.eligible_receipts);
      coverage.fiscalReturns += Number(before.data.fiscal_returns);
      coverage.otherExcluded += Number(before.data.other_excluded);
      continue;
    }
    if (before.data.status === "missing_source") {
      missingSource.push(day);
      continue;
    }
    if (before.data.status !== "missing_projection") throw new Error("receipt_analytics_audit_failed");
    if (!publish) {
      results.push({ day, status: "pending" });
      continue;
    }
    if (changed >= maxDays) break;
    const projected = await db.rpc("project_poster_receipt_analytics_day", { p_day: day });
    if (projected.error || projected.data?.status !== "projected") {
      throw new Error("receipt_analytics_projection_failed");
    }
    const after = await db.rpc("audit_poster_receipt_analytics_day", { p_day: day });
    if (after.error || after.data?.status !== "verified") {
      throw new Error("receipt_analytics_audit_failed");
    }
    changed += 1;
    coverage.verifiedDays += 1;
    coverage.receipts += Number(after.data.receipts);
    coverage.lines += Number(after.data.lines);
    coverage.eligibleReceipts += Number(after.data.eligible_receipts);
    coverage.fiscalReturns += Number(after.data.fiscal_returns);
    coverage.otherExcluded += Number(after.data.other_excluded);
    const row = { day, status: "verified", receipts: Number(after.data.receipts),
      lines: Number(after.data.lines), eligibleReceipts: Number(after.data.eligible_receipts),
      fiscalReturns: Number(after.data.fiscal_returns), otherExcluded: Number(after.data.other_excluded) };
    results.push(row);
    output(row);
  }
  output({ status: publish ? "projection_batch_complete" : "preview_only",
    month, maxDays, changed, missingSource, coverage, results });
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const code = /^receipt_[a-z_]+$/.test(message) ? message : "receipt_analytics_batch_failed";
  output({ status: "stopped", day: stoppedDay, changed, code });
  process.exitCode = 1;
}

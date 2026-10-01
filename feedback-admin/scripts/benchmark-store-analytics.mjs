/**
 * Read-only PostgREST benchmark for store analytics readers.
 * Optional --sync-day replays an already projected receipt day while readers run;
 * the projection RPC is idempotent and the script rejects non-replayed writes.
 *
 * Usage:
 *   node scripts/benchmark-store-analytics.mjs
 *   node scripts/benchmark-store-analytics.mjs --from=2026-09-16 --to=2026-09-22 \
 *     --runs=20 --concurrency=20 --sync-day=2026-09-16
 */
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
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

const option = (name) => process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;
const allowed = new Set(["from", "to", "runs", "concurrency", "sync-day"]);
for (const value of process.argv.slice(2)) {
  if (!/^--[a-z-]+=[^=].*$/.test(value) || !allowed.has(value.slice(2).split("=")[0])) {
    throw new Error("store_analytics_benchmark_arguments_invalid");
  }
}

const from = option("from") ?? "2026-09-16";
const to = option("to") ?? "2026-09-22";
const runs = Number(option("runs") ?? "20");
const concurrency = Number(option("concurrency") ?? "20");
const syncDay = option("sync-day");
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
if (!isoDate.test(from) || !isoDate.test(to) || from > to ||
  !Number.isSafeInteger(runs) || runs < 5 || runs > 100 ||
  !Number.isSafeInteger(concurrency) || concurrency < 2 || concurrency > 50 ||
  (syncDay !== null && !isoDate.test(syncDay))) {
  throw new Error("store_analytics_benchmark_arguments_invalid");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("store_analytics_benchmark_config_missing");
}

const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  "Accept-Profile": "feedbackgb",
  "Content-Profile": "feedbackgb",
};
const asOf = new Date().toISOString();

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function request(pathname, init = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    ...init, headers: { ...headers, ...(init.headers ?? {}) }, cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const durationMs = round(performance.now() - started);
  if (!response.ok) throw new Error(`store_analytics_benchmark_http_${response.status}`);
  const data = JSON.parse(text);
  return { data, durationMs, rawBytes: Buffer.byteLength(text), gzipBytes: gzipSync(text).byteLength };
}

async function rpc(name, body) {
  return request(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
}

async function loadSpotIds() {
  const result = await request("v_stores?select=id&order=id.asc", { method: "GET" });
  if (!Array.isArray(result.data)) throw new Error("store_analytics_benchmark_roster_invalid");
  const ids = result.data.map((row) => Number(row?.id));
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(ids).size !== ids.length) throw new Error("store_analytics_benchmark_roster_invalid");
  return ids;
}

const readers = (spotIds) => ({
  overview: {
    name: "read_store_analytics_overview",
    body: { p_from: from, p_to: to, p_spot_ids: spotIds,
      p_compare_from: null, p_compare_to: null, p_as_of: asOf },
  },
  catalog: {
    name: "read_store_category_product_analytics",
    body: { p_from: from, p_to: to, p_spot_ids: spotIds,
      p_compare_from: null, p_compare_to: null, p_as_of: asOf,
      p_category_id: null, p_category_unknown: false, p_product_id: null,
      p_modification_id: null, p_search: "", p_sort: "revenue",
      p_direction: "desc", p_limit: 25, p_offset: 0 },
  },
  penetration: {
    name: "read_store_penetration_analytics",
    body: { p_from: from, p_to: to, p_spot_ids: spotIds,
      p_as_of: asOf, p_category_id: null },
  },
});

async function measureReader(reader) {
  const cold = await rpc(reader.name, reader.body);
  const warm = [];
  for (let index = 0; index < runs; index += 1) warm.push(await rpc(reader.name, reader.body));
  const parallel = await Promise.all(Array.from({ length: concurrency }, () => rpc(reader.name, reader.body)));
  const warmTimes = warm.map((item) => item.durationMs);
  const parallelTimes = parallel.map((item) => item.durationMs);
  const shapes = new Set([cold, ...warm, ...parallel].map((item) =>
    `${item.rawBytes}:${item.gzipBytes}`));
  return {
    coldMs: cold.durationMs,
    warm: { samples: warmTimes.length, p50Ms: percentile(warmTimes, 0.5),
      p95Ms: percentile(warmTimes, 0.95), maxMs: Math.max(...warmTimes) },
    concurrent: { readers: parallelTimes.length, p50Ms: percentile(parallelTimes, 0.5),
      p95Ms: percentile(parallelTimes, 0.95), maxMs: Math.max(...parallelTimes) },
    payload: { rawBytes: cold.rawBytes, gzipBytes: cold.gzipBytes,
      stableAcrossSamples: shapes.size === 1 },
  };
}

const spotIds = await loadSpotIds();
const definitions = readers(spotIds);
const measurements = {};
for (const [key, reader] of Object.entries(definitions)) {
  measurements[key] = await measureReader(reader);
}

let concurrentSync = null;
if (syncDay !== null) {
  const reader = definitions.penetration;
  const readerRequests = Array.from({ length: concurrency }, () => rpc(reader.name, reader.body));
  const syncRequest = rpc("project_poster_receipt_analytics_day", { p_day: syncDay });
  const [sync, values] = await Promise.all([syncRequest, Promise.all(readerRequests)]);
  if (sync.data?.status !== "projected" || sync.data?.replayed !== true) {
    throw new Error("store_analytics_benchmark_sync_not_replay");
  }
  const times = values.map((item) => item.durationMs);
  concurrentSync = { day: syncDay, replayed: true, syncMs: sync.durationMs,
    readers: times.length, readerP50Ms: percentile(times, 0.5),
    readerP95Ms: percentile(times, 0.95), readerMaxMs: Math.max(...times) };
}

process.stdout.write(`${JSON.stringify({
  mode: "service_role_postgrest_rpc_benchmark",
  readOnly: syncDay === null,
  period: { from, to }, asOf, spotCount: spotIds.length, runs, concurrency,
  measurements, concurrentSync,
  limitations: [
    "PostgREST RPC timing is not protected Next.js route timing",
    "EXPLAIN ANALYZE is not available without a direct PostgreSQL connection or SQL Editor",
    "coldMs is the first request in this process, not a guaranteed cold PostgreSQL cache",
  ],
}, null, 2)}\n`);

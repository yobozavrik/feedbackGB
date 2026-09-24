/**
 * Read-only, sequential Poster load probe for one closed Kyiv date.
 * No response bodies, credentials, URLs, or product names are printed.
 * Usage: node scripts/measure-poster-foodcost-sales.mjs YYYY-MM-DD [--sample=3]
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const token = process.env.POSTER_TOKEN;
if (!token) throw new Error("poster_token_missing");

const date = process.argv[2];
const sampleArg = process.argv[3];
function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
if (!validIsoDate(date) ||
  (sampleArg && !/^--sample=([1-9]\d*)$/.test(sampleArg)) || process.argv.length > 4) {
  throw new Error("usage: node scripts/measure-poster-foodcost-sales.mjs YYYY-MM-DD [--sample=N]");
}
const sample = sampleArg ? Number(sampleArg.slice(9)) : null;
if (sample !== null && (!Number.isSafeInteger(sample) || sample > 100)) throw new Error("invalid_sample_size");

function kyivToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (kind) => parts.find((part) => part.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
if (date >= kyivToday()) throw new Error("sales_day_not_closed");

async function callPoster(method, params = {}) {
  const url = new URL(`https://joinposter.com/api/${method}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const started = performance.now();
  let response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("poster_transport_or_timeout");
  }
  if (!response.ok) throw new Error(`poster_http_${response.status}`);
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || body.error || !Object.hasOwn(body, "response")) {
    throw new Error("poster_invalid_response");
  }
  return { data: body.response, durationMs: Math.round(performance.now() - started) };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

const startedAt = new Date().toISOString();
const started = performance.now();
const timings = [];
let spotsChecked = 0;
let rowsRead = 0;
let resultCode = "ok";
let spotsAvailable = null;
try {
  const list = await callPoster("access.getSpots");
  timings.push(list.durationMs);
  if (!Array.isArray(list.data)) throw new Error("invalid_poster_spots");
  const spotIds = list.data.map((spot) => Number(spot?.spot_id));
  if (spotIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(spotIds).size !== spotIds.length || !spotIds.length) throw new Error("invalid_poster_spots");
  spotIds.sort((a, b) => a - b);
  spotsAvailable = spotIds.length;
  const selected = sample === null ? spotIds : spotIds.slice(0, sample);
  const compact = date.replaceAll("-", "");
  for (const spotId of selected) {
    const sales = await callPoster("dash.getProductsSales", {
      date_from: compact, date_to: compact, spot_id: spotId,
    });
    timings.push(sales.durationMs);
    if (!Array.isArray(sales.data)) throw new Error("invalid_poster_sales");
    spotsChecked++;
    rowsRead += sales.data.length;
    if (spotsChecked < selected.length) await new Promise((resolve) => setTimeout(resolve, 300));
  }
} catch (error) {
  resultCode = error instanceof Error && /^poster_http_\d{3}$/.test(error.message) ? error.message :
    error instanceof Error && ["poster_transport_or_timeout", "poster_invalid_response",
      "invalid_poster_spots", "invalid_poster_sales"].includes(error.message)
      ? error.message : "unknown_probe_error";
  process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify({ mode: "read_only_measurement", date, startedAt,
  completedAt: new Date().toISOString(), resultCode, spotsAvailable, spotsChecked,
  requestsCompleted: timings.length, productRowsRead: rowsRead,
  elapsedMs: Math.round(performance.now() - started),
  requestP50Ms: percentile(timings, 0.5), requestP95Ms: percentile(timings, 0.95),
  maxRequestMs: timings.length ? Math.max(...timings) : null,
  pauseBetweenSpotRequestsMs: 300 })}\n`);

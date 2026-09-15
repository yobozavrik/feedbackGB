/*
 * Staging-only API/Storage stress test for the photo-report submission path.
 *
 * Required environment variables:
 *   LOAD_TEST_BASE_URL=https://staging.example.com
 *   LOAD_TEST_ALLOW_HOST=staging.example.com
 *   LOAD_TEST_SESSIONS_JSON=[{"name":"seller-001","cookie":"fbgb_session=..."}, ...]
 *   LOAD_TEST_CONFIRM_STAGING=YES
 *
 * Run with a process large enough for 100 x ~5.47 MiB request bodies:
 *   node --max-old-space-size=2048 scripts/load-photo-report.mjs
 *
 * It creates test feedback and Storage objects. Never point it at production.
 */
import { randomUUID } from "node:crypto";

const USERS = 100;
const PHOTOS_PER_REPORT = 15;
const PHOTO_BYTES = 280 * 1024;

function fail(message) {
  console.error(`LOAD TEST REFUSED: ${message}`);
  process.exit(2);
}

if (process.env.LOAD_TEST_CONFIRM_STAGING !== "YES") fail("set LOAD_TEST_CONFIRM_STAGING=YES");
if (!process.env.LOAD_TEST_BASE_URL || !process.env.LOAD_TEST_ALLOW_HOST) fail("set BASE_URL and exact ALLOW_HOST");

const baseUrl = new URL(process.env.LOAD_TEST_BASE_URL);
if (baseUrl.host !== process.env.LOAD_TEST_ALLOW_HOST) fail("BASE_URL host does not equal LOAD_TEST_ALLOW_HOST");

let sessions;
try {
  sessions = JSON.parse(process.env.LOAD_TEST_SESSIONS_JSON ?? "[]");
} catch {
  fail("LOAD_TEST_SESSIONS_JSON is not JSON");
}
if (!Array.isArray(sessions) || sessions.length < USERS) fail(`need at least ${USERS} distinct staging sessions`);
if (new Set(sessions.slice(0, USERS).map((session) => session?.name)).size !== USERS) fail("staging session names must be unique");
if (sessions.slice(0, USERS).some((session) => typeof session?.cookie !== "string" || !session.cookie.includes("="))) fail("each session needs a cookie string");

// The server validates MIME/base64/byte ceiling, then passes bytes to private Storage.
// This fixture measures the network + API + Storage path, not browser canvas compression.
const image = `data:image/jpeg;base64,${Buffer.alloc(PHOTO_BYTES, 0x61).toString("base64")}`;

function percentile(values, p) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return [...values].sort((a, b) => a - b)[index];
}

async function run(session) {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL("/api/feedback", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session.cookie },
      body: JSON.stringify({
        category: "photo_report",
        fields: {},
        photo_urls: Array.from({ length: PHOTOS_PER_REPORT }, () => image),
        client_submission_id: randomUUID(),
        client_created_at: new Date().toISOString(),
      }),
    });
    return { name: session.name, status: response.status, ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { name: session.name, status: 0, ms: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.message : String(error) };
  }
}

const results = await Promise.all(sessions.slice(0, USERS).map(run));
const successful = results.filter((result) => result.status >= 200 && result.status < 300);
const failed = results.filter((result) => !(result.status >= 200 && result.status < 300));
const timing = successful.map((result) => result.ms);
console.log(JSON.stringify({
  target: baseUrl.origin,
  users: USERS,
  photos_per_report: PHOTOS_PER_REPORT,
  payload_per_report_mib: Number(((image.length * PHOTOS_PER_REPORT) / 1024 / 1024).toFixed(2)),
  success: successful.length,
  failure: failed.length,
  p50_ms: percentile(timing, 0.5),
  p95_ms: percentile(timing, 0.95),
  p99_ms: percentile(timing, 0.99),
  failures: failed.map(({ name, status, ms, error }) => ({ name, status, ms, error })),
}, null, 2));

process.exitCode = failed.length === 0 ? 0 : 1;

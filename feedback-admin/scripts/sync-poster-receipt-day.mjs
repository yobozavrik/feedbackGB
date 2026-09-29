/** Explicit one-day operator worker. Default is prepare-only, no Supabase connection.
 * NEVER print source, bundle, URL, client ID/profile, environment value or raw error.
 * Plaintext archive: no encryption key required. Raw bundles contain PII; never print them.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
// Existing app env takes precedence; repository-root env fills missing variables only.
const envLoader = require("@next/env"), appEnv = { ...process.env };
envLoader.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const resolvedAppEnv = { ...process.env };
envLoader.loadEnvConfig(path.resolve(process.cwd(), ".."), false, { info() {}, error() {} }, true);
const workerEnv = { ...process.env, ...appEnv, ...resolvedAppEnv };
for (const [name, value] of Object.entries(workerEnv)) if (value !== undefined) process.env[name] = value;
const ts = require("typescript"), Module = require("node:module"), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.resolve("src", request.slice(2)) : request, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { syncPosterReceiptDay } = require("../src/lib/admin/posterReceiptSync.ts");
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  const result = await syncPosterReceiptDay(process.argv.slice(2), process.env, {
    getRoster: async (token, signal) => {
      const url = new URL("https://joinposter.com/api/access.getSpots");
      url.searchParams.set("token", token);
      const response = await fetch(url, { cache: "no-store", redirect: "error",
        signal: AbortSignal.any([signal ?? controller.signal, AbortSignal.timeout(20000)]) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("receipt_roster_unavailable"); }
      if (!response.body) throw new Error("receipt_roster_invalid");
      const reader = response.body.getReader(); const chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > 1024 * 1024) throw new Error("receipt_roster_invalid");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
      if (!body || body.error) throw new Error("receipt_roster_invalid");
      return body.response;
    },
    getRpc: () => {
      // Lazily loaded only after explicit --publish + validated service config.
      const { getServerSupabase } = require("../src/lib/supabase.ts");
      const db = getServerSupabase();
      if (!db) throw new Error("receipt_service_config_missing");
      return (bundle, signal) => db.rpc("import_poster_receipt_bundle", { p_bundle: bundle }).abortSignal(signal);
    },
  }, controller.signal);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const code = controller.signal.aborted ? "receipt_worker_aborted" :
    /^receipt_[a-z_]{1,80}$/.test(message) ? message : "receipt_worker_failed";
  // An ambiguous publication error is NOT evidence that the DB did not commit.
  console.log(JSON.stringify({ status: "failed", code, sqlState: error?.sqlState ?? null,
    httpStatus: error?.httpStatus ?? null })); process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
}

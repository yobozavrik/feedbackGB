/** Read-only live Poster day verification. NO Supabase client/import calls or files.
 * Source/client bytes encrypted only in RAM with an ephemeral key, discarded at exit.
 * Emits safe aggregate diagnostics ONLY. Never dump a bundle, values, URLs or errors.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const ts = require("typescript"), Module = require("node:module"), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.resolve("src", request.slice(2)) : request, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { posterRequest } = require("../src/lib/admin/posterApi.ts");
const { loadPosterReceiptDay } = require("../src/lib/admin/posterReceiptLoader.ts");
const { decryptReceiptArchive } = require("../src/lib/admin/posterReceiptArchive.ts");
if (process.argv.length !== 3 || !/^--date=\d{4}-\d{2}-\d{2}$/.test(process.argv[2])) throw new Error("receipt_readonly_date_required");
const key = randomBytes(32), startedAt = new Date().toISOString();
try {
  const token = process.env.POSTER_TOKEN;
  if (!token) throw new Error("receipt_token_missing");
  const spots = await posterRequest("access.getSpots", {}, token, AbortSignal.timeout(30000));
  if (!Array.isArray(spots) || !spots.length) throw new Error("receipt_roster_invalid");
  const ids = spots.map(s => String(s.spot_id));
  if (ids.some(id => !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) throw new Error("receipt_roster_invalid");
  const accountId = "readonly-verification-NOT-a-production-account";
  const { bundle, diagnostics } = await loadPosterReceiptDay({ token, accountId,
    businessDate: process.argv[2].slice(7), verifiedSpotIds: ids, keyId: "ephemeral-not-production", key });
  // Authenticated decryption checked in RAM; no values or plaintext are emitted.
  for (const p of bundle.payloads) {
    const clear = decryptReceiptArchive({ format: "aes-256-gcm-v1", keyId: p.key_id,
      nonce: p.nonce, tag: p.auth_tag, ciphertext: p.ciphertext }, { accountId, objectId: p.id, endpoint: p.endpoint }, key);
    if (!clear.length) throw new Error("receipt_archive_invalid");
    clear.fill(0);
  }
  console.log(JSON.stringify({ status: "passed", readOnly: true, startedAt, finishedAt: new Date().toISOString(),
    verifiedCurrentRosterCount: ids.length, diagnostics,
    limits: ["No Supabase connection or writes, ingestion policy not changed", "Ephemeral encryption namespace/key only, no persistent archive",
      "Current roster is NOT historical membership proof", "One completed day only; no full Jan1 history validation",
      "No normalized monetary/time/quantity KPI verification", "Two matching scans do not guarantee no later Poster corrections"] }, null, 2));
} catch (error) {
  const value = error instanceof Error ? error.message : "";
  const code = /^receipt_[a-z_]{1,80}$/.test(value) ? value : "receipt_readonly_probe_failed";
  console.log(JSON.stringify({ status: "failed", readOnly: true, startedAt, finishedAt: new Date().toISOString(), code,
    progress: error?.progress ?? null }));
  process.exitCode = 1;
} finally { key.fill(0); }

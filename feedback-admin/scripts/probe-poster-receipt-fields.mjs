/** READ ONLY schema inventory: field paths and types ONLY, never receipt values or PII. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const ts = require("typescript"), Module = require("node:module"), resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.resolve("src", request.slice(2)) : request, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { posterRequest } = require("../src/lib/admin/posterApi.ts");
if (process.argv.length > 2) throw new Error("probe_arguments_not_supported");
const token = process.env.POSTER_TOKEN;
if (!token) throw new Error("poster_token_missing");
const fields = new Map();
function inventory(value, prefix = "response", depth = 0) {
  if (depth > 10) throw new Error("probe_max_depth");
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = fields.get(prefix) ?? new Set(); types.add(type); fields.set(prefix, types);
  if (Array.isArray(value)) for (const item of value.slice(0, 100)) inventory(item, `${prefix}[]`, depth + 1);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    // Never print dynamic names/IDs/free-form keys from source payloads.
    const field = /^[a-z_][a-z_0-9]{0,63}$/.test(key) ? key : "[dynamic_key]";
    inventory(item, `${prefix}.${field}`, depth + 1);
  }
}
const startedAt = new Date().toISOString();
try {
  const data = await posterRequest("transactions.getTransactions", {
    date_from: "2026-09-28", date_to: "2026-09-28", page: "1", per_page: "2",
  }, token, AbortSignal.timeout(30000));
  if (!data || !Array.isArray(data.data) || data.data.length > 2) throw new Error("probe_invalid_page");
  inventory(data);
  console.log(JSON.stringify({ readOnly: true, status: "passed", startedAt, finishedAt: new Date().toISOString(),
    method: "transactions.getTransactions", sampleDate: "2026-09-28", sampledRows: data.data.length,
    fields: [...fields].sort(([a], [b]) => a.localeCompare(b)).map(([field, types]) => ({ field, types: [...types].sort() })),
    limits: ["Two receipt samples only; absent fields are not proven unsupported", "No customer enrichment or Supabase writes", "Field types do not prove money/time/status semantics"] }, null, 2));
} catch {
  console.log(JSON.stringify({ readOnly: true, status: "failed", code: "receipt_field_probe_failed" }));
  process.exitCode = 1;
}

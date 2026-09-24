/** Read-only check of the current Poster/v_stores roster and three closed days. */
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

try {
  const { loadFoodcostRecentNetwork } = require("../src/lib/admin/foodcostRecentNetwork.ts");
  const result = await loadFoodcostRecentNetwork();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "complete") process.exitCode = 2;
} catch (error) {
  // Provider URLs may contain secrets; only allowlisted error codes reach stdout.
  const raw = error instanceof Error ? error.message : "unknown_error";
  const safe = ["schema_missing", "service_role_missing", "poster_token_missing",
    "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
    "poster_unavailable", "poster_invalid_response"].includes(raw) ? raw : "foodcost_recent_network_failed";
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}

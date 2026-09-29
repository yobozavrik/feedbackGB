/** No imports/rows. Calls RPC with INVALID bundles that must fail before INSERT.
 * Safe status/code diagnostics only, never error body/URL/keys/source/customer data.
 */
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url), loader = require("@next/env");
loader.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const app = { ...process.env };
loader.loadEnvConfig(path.resolve(".."), false, { info() {}, error() {} }, true);
const env = { ...process.env, ...app };
const { createClient } = require("@supabase/supabase-js");
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log(JSON.stringify({ code: "receipt_service_config_missing" })); process.exitCode = 1;
} else {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { db: { schema: "feedbackgb" }, auth: { persistSession: false } });
  for (const [name, payload] of [["invalid_small", null], ["invalid_source_sized", "x".repeat(8 * 1024 * 1024)]]) {
    const started = Date.now();
    try {
      const result = await db.rpc("import_poster_receipt_bundle", { p_bundle: payload }).abortSignal(AbortSignal.timeout(30000));
      const code = result.error?.code;
      console.log(JSON.stringify({ name, elapsedMs: Date.now() - started, httpStatus: result.status,
        sqlState: typeof code === "string" && /^[A-Z0-9]{5}$|^PGRST\d{3}$/.test(code) ? code : null,
        domainError: ["receipt_bundle_invalid", "receipt_ingestion_disabled"].includes(result.error?.message) ? result.error.message : null,
        unexpectedlySucceeded: !result.error }));
      if (!result.error) { process.exitCode = 1; break; }
    } catch { console.log(JSON.stringify({ name, code: "receipt_probe_transport_failed" })); process.exitCode = 1; break; }
  }
}

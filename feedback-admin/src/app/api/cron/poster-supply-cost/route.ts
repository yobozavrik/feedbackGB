import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { syncPosterSupplyCosts } from "@/lib/admin/posterSupplySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: true, skipped: true, reason: "non_production_environment" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "cron_secret_not_configured" }, 503);
  const auth = checkCronAuth(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    const result = await syncPosterSupplyCosts();
    console.info(JSON.stringify({ event: "poster_supply_cost_sync", status: result.status,
      window: result.window, expected: result.expected, remaining: result.remaining }));
    return json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "supply_sync_failed";
    const safeCode = code === "schema_missing" ? code : "supply_sync_failed";
    const diagnosticCode = code === "schema_missing" || code.startsWith("supply_db_") ||
      ["service_role_missing", "poster_token_missing", "supabase_missing", "invalid_supply_header",
        "invalid_supply_list", "duplicate_supply_id", "supply_document_count_mismatch",
        "incomplete_supply_document", "incomplete_supply_snapshot"].includes(code)
      ? code : "unexpected_error";
    console.error(JSON.stringify({ event: "poster_supply_cost_sync_failed", code: diagnosticCode }));
    return json({ ok: false, error: safeCode }, safeCode === "schema_missing" ? 503 : 500);
  }
}

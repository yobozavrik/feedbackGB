import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { syncPosterSupplyCosts } from "@/lib/admin/posterSupplySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Preview shares the production database. Never let its cron write there.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: true, reason: "non_production_environment" });
  }
  try {
    const result = await syncPosterSupplyCosts();
    console.info(JSON.stringify({ event: "poster_supply_cost_sync", status: result.status,
      window: result.window, expected: result.expected, remaining: result.remaining }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "supply_sync_failed";
    const safeCode = code === "schema_missing" ? code : "supply_sync_failed";
    const diagnosticCode = code === "schema_missing" || code.startsWith("supply_db_") ||
      ["service_role_missing", "poster_token_missing", "supabase_missing", "invalid_supply_header",
        "invalid_supply_list", "duplicate_supply_id", "supply_document_count_mismatch",
        "incomplete_supply_document", "incomplete_supply_snapshot"].includes(code)
      ? code : "unexpected_error";
    console.error(JSON.stringify({ event: "poster_supply_cost_sync_failed", code: diagnosticCode }));
    return NextResponse.json({ ok: false, error: safeCode }, { status: safeCode === "schema_missing" ? 503 : 500 });
  }
}

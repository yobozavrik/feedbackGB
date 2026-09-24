import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { syncPosterSalesRecentDays } from "@/lib/admin/posterSalesSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily 07:00 UTC; writes only on Production after a bearer-secret check. */
export async function GET(request: Request) {
  // Without CRON_SECRET, the shared legacy auth helper can accept a spoofable
  // x-vercel-cron header. This write route must fail closed in Production.
  if (process.env.VERCEL_ENV === "production" && !process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  }
  const auth = checkCronAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Preview and Production use the same database. Never mutate it via Preview.
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: true, reason: "non_production_environment" });
  }
  try {
    const result = await syncPosterSalesRecentDays();
    console.info(JSON.stringify({ event: "poster_foodcost_sales_sync", status: "completed",
      expectedCells: result.expectedCells, processedCells: result.processedCells,
      changedCells: result.changedCells, unchangedCells: result.unchangedCells }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "unknown_error";
    const code = ["schema_missing", "service_role_missing", "poster_token_missing",
      "supabase_missing", "foodcost_sync_in_progress", "foodcost_batch_in_progress",
      "invalid_poster_spots"].includes(raw)
      ? raw : "foodcost_recent_sync_failed";
    console.error(JSON.stringify({ event: "poster_foodcost_sales_sync", status: "failed", code }));
    return NextResponse.json({ ok: false, error: code }, {
      status: code === "schema_missing" ? 503 :
        ["foodcost_sync_in_progress", "foodcost_batch_in_progress"].includes(code) ? 409 : 500,
    });
  }
}

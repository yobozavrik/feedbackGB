import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { syncPosterFoodcostSalesNightly } from "@/lib/admin/foodcostSalesNightlyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Writes only on Production after an exact bearer-secret check. */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return json({ ok: true, skipped: true, reason: "non_production_environment" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "cron_secret_not_configured" }, 503);
  const auth = checkCronAuth(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    const result = await syncPosterFoodcostSalesNightly();
    console.info(JSON.stringify({ event: "poster_foodcost_sales_sync", status: result.status,
      spotCount: result.spotCount, seededJobs: result.seededJobs,
      processedJobs: result.processedJobs, completedJobs: result.completedJobs,
      failedJobs: result.failedJobs, timedOutJobs: result.timedOutJobs,
      remaining: result.remaining, health: result.health }));
    return json({ ok: true, ...result });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "unknown_error";
    const code = ["schema_missing", "service_role_missing", "poster_token_missing",
      "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
      "invalid_poster_spots", "supabase_abort_unsupported"].includes(raw)
      ? raw : "foodcost_recent_sync_failed";
    console.error(JSON.stringify({ event: "poster_foodcost_sales_sync", status: "failed", code }));
    return json({ ok: false, error: code }, code === "schema_missing" ? 503 : 500);
  }
}

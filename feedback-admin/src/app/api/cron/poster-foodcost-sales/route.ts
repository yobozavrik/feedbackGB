import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { syncPosterSalesRecentDays } from "@/lib/admin/posterSalesSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Prepared endpoint; deliberately absent from vercel.json until Gate 2 passes. */
export async function GET(request: Request) {
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

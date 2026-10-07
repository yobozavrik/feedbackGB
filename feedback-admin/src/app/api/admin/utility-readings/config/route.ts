import { NextResponse } from "next/server";
import { adminUtilityContext } from "@/lib/admin/utilityAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "true") {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
  }
  const context = await adminUtilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const { db } = context;
  const { data: currentPeriodId, error: ensureError } = await db.rpc("ensure_current_utility_period");
  if (ensureError || !currentPeriodId) return NextResponse.json({ error: "period_unavailable" }, { status: 503 });
  const [stores, periods] = await Promise.all([
    db.from("v_stores").select("id,name,is_active", { count: "exact" })
      .eq("is_active", true).order("name").limit(1000),
    db.from("utility_periods").select("id,period_start,period_end,due_at,status")
      .order("period_start", { ascending: false }).limit(24),
  ]);
  if (stores.error || periods.error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if ((stores.count ?? 0) > (stores.data?.length ?? 0)) {
    return NextResponse.json({ error: "store_catalog_too_large" }, { status: 507 });
  }
  return NextResponse.json({ stores: stores.data ?? [], periods: periods.data ?? [], current_period_id: currentPeriodId });
}

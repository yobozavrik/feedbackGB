import { NextResponse } from "next/server";
import { canUseUtilityStore, utilityContext } from "@/lib/utilityAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current month is an internal key; the seller never chooses a period. */
export async function GET(req: Request) {
  const context = await utilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const { db, actor } = context;
  const storeId = Number(new URL(req.url).searchParams.get("store_id"));
  if (!Number.isInteger(storeId) || storeId <= 0) return NextResponse.json({ error: "invalid_store" }, { status: 400 });
  if (!(await canUseUtilityStore(db, actor, storeId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: periodId, error: ensureError } = await db.rpc("ensure_current_utility_period");
  if (ensureError || !periodId) return NextResponse.json({ error: "period_unavailable" }, { status: 503 });
  const [{ data: period, error: periodError }, { data: latest, error: latestError }] = await Promise.all([
    db.from("utility_periods").select("id,period_start,period_end,due_at,status").eq("id", periodId).single(),
    db.from("utility_submissions").select("id,category,review_status,revision,submitted_at")
      .eq("store_id", storeId).eq("period_id", periodId).is("superseded_at", null),
  ]);
  if (periodError || latestError || !period) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  return NextResponse.json({ period, latest: latest ?? [] });
}

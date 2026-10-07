import { canUseUtilityStore, utilityContext } from "@/lib/utilityAccess";
import { utilityTrace } from "@/lib/utilityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current month is an internal key; the seller never chooses a period. */
export async function GET(req: Request) {
  const trace = utilityTrace(req, "GET /api/utility-readings");
  const context = await utilityContext();
  if ("error" in context) return trace.fail(context.error, context.status,
    context.status >= 500 ? "utility.access.backend_failed" : "utility.access.denied",
    context.status >= 500 ? "error" : "warn");
  const { db, actor } = context;
  const params = new URL(req.url).searchParams;
  const storeId = Number(params.get("store_id"));
  const historyOffset = Number(params.get("history_offset") ?? 0);
  if (!Number.isInteger(storeId) || storeId <= 0) return trace.fail("invalid_store", 400, "utility.access.invalid_store", "info");
  if (!Number.isInteger(historyOffset) || historyOffset < 0 || historyOffset > 10_000) {
    return trace.fail("invalid_history_offset", 400, "utility.history.invalid", "info");
  }
  if (!(await canUseUtilityStore(db, actor, storeId))) return trace.fail("forbidden", 403, "utility.access.denied", "warn", { store_id: storeId });
  const { data: periodId, error: ensureError } = await db.rpc("ensure_current_utility_period");
  if (ensureError || !periodId) return trace.fail("period_unavailable", 503, "utility.period.ensure_failed", "error", { store_id: storeId });
  const [{ data: period, error: periodError }, { data: latest, error: latestError }] = await Promise.all([
    db.from("utility_periods").select("id,period_start,period_end,due_at,status").eq("id", periodId).single(),
    db.from("utility_submissions").select("id,category,review_status,review_note,revision,submitted_at")
      .eq("store_id", storeId).eq("period_id", periodId).is("superseded_at", null),
  ]);
  if (periodError || latestError || !period) return trace.fail("query_failed", 500, "utility.period.read_failed", "error", { store_id: storeId, period_id: periodId });
  const { data: oldSubmissions, error: historyError, count: historyCount } = await db
    .from("utility_submissions")
    .select("id,period_id,category,review_status,review_note,revision,submitted_at", { count: "exact" })
    .eq("store_id", storeId).neq("period_id", periodId).is("superseded_at", null)
    .order("submitted_at", { ascending: false }).range(historyOffset, historyOffset + 19);
  if (historyError) return trace.fail("query_failed", 500, "utility.history.read_failed", "error", { store_id: storeId });
  const oldPeriodIds = [...new Set((oldSubmissions ?? []).map((item) => item.period_id))];
  const { data: oldPeriods, error: oldPeriodsError } = oldPeriodIds.length
    ? await db.from("utility_periods").select("id,period_start,period_end,due_at,status").in("id", oldPeriodIds)
    : { data: [], error: null };
  if (oldPeriodsError || (oldPeriods?.length ?? 0) !== oldPeriodIds.length) {
    return trace.fail("query_failed", 500, "utility.history.period_read_failed", "error", { store_id: storeId });
  }
  const periodById = new Map((oldPeriods ?? []).map((item) => [item.id, item]));
  const history = (oldSubmissions ?? []).map((item) => ({ ...item, period: periodById.get(item.period_id) }));
  return trace.json({ period, latest: latest ?? [], history,
    history_has_more: historyOffset + history.length < (historyCount ?? 0) });
}

import { adminUtilityContext } from "@/lib/admin/utilityAccess";
import { utilityTrace } from "@/lib/admin/utilityLog";
import { utilityReadingsEnabled } from "@/lib/admin/utilityFeature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const trace = utilityTrace(req, "GET /api/admin/utility-readings/config");
  if (!utilityReadingsEnabled()) {
    return trace.fail("feature_disabled", 404, "utility.access.denied", "warn");
  }
  const context = await adminUtilityContext();
  if ("error" in context) {
    const status = context.status ?? 500;
    return trace.fail(context.error ?? "backend_unavailable", status,
      status >= 500 ? "utility.access.backend_failed" : "utility.access.denied",
      status >= 500 ? "error" : "warn");
  }
  const { db } = context;
  const { data: currentPeriodId, error: ensureError } = await db.rpc("ensure_current_utility_period");
  if (ensureError || !currentPeriodId) return trace.fail("period_unavailable", 503, "utility.period.ensure_failed", "error");
  const [stores, periods] = await Promise.all([
    db.from("v_stores").select("id,name,is_active", { count: "exact" })
      .eq("is_active", true).order("name").limit(1000),
    db.from("utility_periods").select("id,period_start,period_end,due_at,status", { count: "exact" })
      .order("period_start", { ascending: false }).limit(1000),
  ]);
  if (stores.error || periods.error) return trace.fail("query_failed", 500, "utility.admin.read_failed", "error");
  if ((stores.count ?? 0) > (stores.data?.length ?? 0)) {
    return trace.fail("store_catalog_too_large", 507, "utility.admin.read_failed", "error");
  }
  if ((periods.count ?? 0) > (periods.data?.length ?? 0)) {
    return trace.fail("period_catalog_too_large", 507, "utility.admin.read_failed", "error");
  }
  return trace.json({ stores: stores.data ?? [], periods: periods.data ?? [], current_period_id: currentPeriodId,
    delivery_enabled: process.env.UTILITY_READINGS_ENABLED === "true"
      && !!process.env.TELEGRAM_UTILITY_CHAT_ID?.trim()
      && !!process.env.TELEGRAM_BOT_TOKEN?.trim() });
}

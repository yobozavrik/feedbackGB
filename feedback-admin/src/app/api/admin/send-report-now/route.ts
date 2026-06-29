import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";
import { buildAndSendDailyReport } from "@/lib/dailyReport";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/send-report-now
 * Admin-only manual trigger for the daily report. Bypasses the
 * REPORT_HOUR_KYIV guard so the operator can verify formatting / wiring
 * without waiting for the scheduled cron at 21:30.
 */
export async function POST(req: Request) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await buildAndSendDailyReport();

  await logAudit("admin.send_report", {
    actorUserId: sess.uid,
    targetType: "telegram_report",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: result.ok
      ? { total: result.total, kyiv_date: result.kyiv_date }
      : { error: result.error, status: result.status },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json(result);
}

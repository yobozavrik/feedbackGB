import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { buildAndSendDailyReport } from "@/lib/dailyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/send-report-now
 * Admin-only manual trigger for the daily report. Bypasses the
 * REPORT_HOUR_KYIV guard so the operator can verify formatting / wiring
 * without waiting for the scheduled cron at 21:30.
 */
export async function POST() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || sess.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await buildAndSendDailyReport();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json(result);
}

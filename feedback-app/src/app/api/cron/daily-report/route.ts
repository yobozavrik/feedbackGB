import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import {
  buildAndSendDailyReport,
  getKyivClock,
  REPORT_HOUR_KYIV,
} from "@/lib/dailyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/daily-report
 * Vercel Cron entrypoint. Sends a Telegram report of every feedback that
 * was created today (Kyiv time) into TELEGRAM_REPORT_CHAT_ID.
 *
 * Scheduled twice (18:30 and 19:30 UTC) so summer (EEST=UTC+3) and
 * winter (EET=UTC+2) both hit Kyiv 21:30. The handler de-dupes by
 * checking that the current Kyiv hour is 21; the off-DST run exits early.
 */
export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Only run when local Kyiv hour is 21 (covers DST without dual triggering).
  const kyivNow = getKyivClock();
  if (kyivNow.hour !== REPORT_HOUR_KYIV) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `kyiv_hour=${kyivNow.hour}, expected=${REPORT_HOUR_KYIV}`,
    });
  }

  const result = await buildAndSendDailyReport();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

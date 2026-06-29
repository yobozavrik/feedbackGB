import { NextResponse } from "next/server";
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
  // Vercel Cron sends Authorization: Bearer ${CRON_SECRET}.
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  if (cronSecret) {
    if (
      !authHeader.startsWith("Bearer ") ||
      authHeader.slice(7) !== cronSecret
    ) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production" && !isVercelCron) {
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 503 },
    );
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

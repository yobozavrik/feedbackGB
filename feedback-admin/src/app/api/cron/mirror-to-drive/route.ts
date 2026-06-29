import { NextResponse } from "next/server";
import { mirrorPendingPhotos } from "@/lib/driveMirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/mirror-to-drive
 *
 * Manual / on-demand trigger to back up pending photos to Google Drive.
 * Auth: same CRON_SECRET shared with /api/cron/daily-report.
 *
 * Note: the daily-report cron also calls mirrorPendingPhotos() right after
 * sending the Telegram report, so under normal operation no separate cron
 * entry is needed. This endpoint exists for ops/debug and for catching up
 * a backlog if the daily run failed.
 */
export async function GET(req: Request) {
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

  const result = await mirrorPendingPhotos();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
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
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const result = await mirrorPendingPhotos();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

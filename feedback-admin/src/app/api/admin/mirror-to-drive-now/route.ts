import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";
import { mirrorPendingPhotos } from "@/lib/driveMirror";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/mirror-to-drive-now
 * Admin-only manual trigger for the Drive backup. Uses the same idempotent
 * mirror routine as the cron — safe to spam.
 */
export async function POST(req: Request) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await mirrorPendingPhotos();

  await logAudit("admin.mirror_to_drive", {
    actorUserId: sess.uid,
    targetType: "drive_backup",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: result.ok
      ? {
          mirrored: result.mirrored,
          failed: result.failed,
          skipped: result.skipped,
        }
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

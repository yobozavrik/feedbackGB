import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { mirrorPendingPhotos } from "@/lib/driveMirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/mirror-to-drive-now
 * Admin-only manual trigger for the Drive backup. Uses the same idempotent
 * mirror routine as the cron — safe to spam.
 */
export async function POST() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || sess.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await mirrorPendingPhotos();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json(result);
}

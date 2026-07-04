import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { markNotificationRead } from "@/lib/notifications";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/<uuid>/read
 * Marks one of the current user's own notifications as read.
 * Idempotent: an already-read notification still returns { ok: true }.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  await markNotificationRead(supabase, sess.uid, params.id);
  return NextResponse.json({ ok: true });
}

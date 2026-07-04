import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { markNotificationRead } from "@/lib/notifications";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/notifications/<uuid>/read
 * Admin-only. Marks one of the current admin's own notifications as read.
 * Idempotent: an already-read notification still returns { ok: true }.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await requireAdminSession();
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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

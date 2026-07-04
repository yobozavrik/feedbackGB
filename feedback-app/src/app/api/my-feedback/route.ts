import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/my-feedback?limit=50
 * Returns the current user's own submitted requests across every category
 * (the "Мої заявки" cabinet), newest first. Never accepts a client-supplied
 * user id — always filters by the session's own uid.
 */
export async function GET(req: Request) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;

  const { data, error } = await supabase
    .from("feedback_feed")
    .select(
      "id, category, category_emoji, category_title, summary, status, assigned_full_name, created_at, resolved_at",
    )
    .eq("user_id", sess.uid)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("my-feedback list error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}

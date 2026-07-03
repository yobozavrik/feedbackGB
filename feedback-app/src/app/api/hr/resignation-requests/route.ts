import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hr/resignation-requests
 * Returns the CURRENT user's own hr_question/resignation requests, most
 * recent first. Deliberately not under /api/feedback — middleware treats
 * every non-POST /api/feedback/* call as admin-only, and this is a seller
 * self-service endpoint.
 */
export async function GET() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ rows: [] });
  }

  const { data, error } = await supabase
    .from("feedback")
    .select("id, created_at, status, fields")
    .eq("user_id", sess.uid)
    .eq("category", "hr_question")
    .eq("fields->>hr_topic", "resignation")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("resignation-requests error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}

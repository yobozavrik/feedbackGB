import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  author: { full_name: string } | { full_name: string }[] | null;
}

/**
 * GET /api/my-feedback/<uuid>
 * Returns the full row + comment thread for one of the caller's own
 * submitted requests. Ownership is required: a request id that exists but
 * belongs to someone else returns 404 (not 403), so the response never
 * confirms whether a given id exists to a non-owner.
 */
export async function GET(
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

  const { data: feedback, error: feedbackError } = await supabase
    .from("feedback_feed")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (feedbackError) {
    console.error("my-feedback detail error", { code: feedbackError.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!feedback || (feedback as { user_id: string | null }).user_id !== sess.uid) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: comments, error: commentsError } = await supabase
    .from("feedback_comments")
    .select("id, body, created_at, author:users(full_name)")
    .eq("feedback_id", params.id)
    .order("created_at", { ascending: true });
  if (commentsError) {
    console.error("my-feedback comments error", { code: commentsError.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const flattenedComments = ((comments ?? []) as CommentRow[]).map((c) => {
    const author = Array.isArray(c.author) ? c.author[0] : c.author;
    return {
      id: c.id,
      body: c.body,
      created_at: c.created_at,
      author_full_name: author?.full_name ?? "Адміністратор",
    };
  });

  return NextResponse.json({ feedback, comments: flattenedComments });
}

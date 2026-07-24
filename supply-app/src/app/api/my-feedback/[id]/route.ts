import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getSupplyApiUser } from "@/lib/currentUser";
import { isUuid } from "@/lib/validation";
import { getConsumablesOrderDetail } from "@/lib/consumablesOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  author: { full_name: string } | { full_name: string }[] | null;
}

/**
 * GET /api/my-feedback/<uuid> — one of the caller's own submitted requests
 * plus the comment thread. Non-owner ids return 404 (not 403), so the
 * response never confirms whether an unknown id exists to a non-owner.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const { data: feedback, error: feedbackError } = await supabase
    .from("feedback_feed")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (feedbackError) {
    console.error("[supply] my-feedback detail", { code: feedbackError.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!feedback || (feedback as { user_id: string | null }).user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: comments, error: commentsError } = await supabase
    .from("feedback_comments")
    .select("id, body, created_at, author:users(full_name)")
    .eq("feedback_id", params.id)
    .order("created_at", { ascending: true });
  if (commentsError) {
    console.error("[supply] my-feedback comments", { code: commentsError.code });
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

  let consumables: Awaited<ReturnType<typeof getConsumablesOrderDetail>> = null;
  if ((feedback as { category?: string }).category === "consumables_request") {
    try {
      consumables = await getConsumablesOrderDetail(params.id);
    } catch (cause) {
      console.error("[supply] consumables detail", cause);
    }
  }

  return NextResponse.json({ feedback, comments: flattenedComments, consumables });
}

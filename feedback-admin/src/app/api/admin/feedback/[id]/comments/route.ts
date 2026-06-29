import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";
import { sendTelegramMessage, escapeHtml } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = params.id;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase
    .from("feedback_comments")
    .select(`
      id,
      feedback_id,
      author_id,
      body,
      created_at,
      author:users(full_name, role)
    `)
    .eq("feedback_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("fetch comments error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Typecast or map to flatten nested author join
  const comments = (data ?? []).map((c: any) => ({
    id: c.id,
    feedback_id: c.feedback_id,
    author_id: c.author_id,
    body: c.body,
    created_at: c.created_at,
    author_name: c.author?.full_name ?? "Анонім",
    author_role: c.author?.role ?? "seller",
  }));

  return NextResponse.json({ comments });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || !isAdminTier(sess.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = params.id;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let body: { body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const commentText = (body.body ?? "").trim();
  if (!commentText) {
    return NextResponse.json({ error: "empty_comment" }, { status: 400 });
  }

  if (commentText.length > 2000) {
    return NextResponse.json({ error: "comment_too_long" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  // Insert the comment
  const { data: newComment, error } = await supabase
    .from("feedback_comments")
    .insert({
      feedback_id: id,
      author_id: sess.uid,
      body: commentText,
    })
    .select()
    .single();

  if (error) {
    console.error("insert comment error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Telegram notifications: if admin comments, send to the seller (tg_user_id from feedback)
  try {
    const { data: fb } = await supabase
      .from("feedback")
      .select("tg_user_id, summary")
      .eq("id", id)
      .maybeSingle();

    if (fb && fb.tg_user_id && process.env.TELEGRAM_BOT_TOKEN) {
      const escapedSummary = escapeHtml(fb.summary || "");
      const escapedComment = escapeHtml(commentText);
      const formattedMsg = `💬 <b>Нове повідомлення від адміністратора:</b>\n\n<i>"${escapedSummary}"</i>\n\n<b>Відповідь:</b>\n${escapedComment}`;
      await sendTelegramMessage(
        process.env.TELEGRAM_BOT_TOKEN,
        String(fb.tg_user_id),
        formattedMsg,
      );
    }
  } catch (err) {
    console.error("comment telegram notify error", err);
    // Non-blocking: don't fail the comment insert if Telegram notification fails
  }

  return NextResponse.json({ ok: true, comment: newComment });
}

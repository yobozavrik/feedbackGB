import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { isAdminTier } from "@/lib/session";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { isUuid } from "@/lib/validation";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "@/lib/feedbackStatus";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  status?: FeedbackStatus;
  assigned_to?: string | null;
  comment?: string | null;
}

/**
 * GET /api/admin/feedback/<uuid>
 * Admin-only. Returns just enough of a single feedback row to enrich a
 * realtime notification (category + summary) — the realtime broadcast
 * itself only carries `{ id, event }` (see 018_feedback_realtime_broadcast.sql),
 * deliberately never the row content, since Realtime broadcast channels are
 * reachable with the public anon key and `feedback` has no RLS policies
 * granting anon/authenticated any access. This endpoint is the
 * authenticated follow-up fetch instead.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await requireAdminSession();
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("feedback_feed")
    .select("id, category, category_emoji, category_title, summary")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("feedback lookup error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ feedback: data });
}

/**
 * PATCH /api/admin/feedback/<uuid>
 *   { status?, assigned_to?, comment? }
 *
 * Admin-only. Updates lifecycle fields on a single feedback row:
 *   * `status` — must be one of new / in_progress / resolved / rejected.
 *     Moving to 'resolved' also stamps resolved_at + resolved_by; moving
 *     away clears them.
 *   * `assigned_to` — null to unassign, or a uuid of an existing admin user.
 *     Validated against the `users` table to prevent dangling FKs from a
 *     malicious payload (DB enforces FK on save anyway, but we want a 400
 *     instead of 500 when the id is bad).
 *   * `comment` — optional free-text note (max 500 chars). Persisted into
 *     the audit_log meta as a separate `admin.feedback.note` row, so the
 *     journal answers "what did the admin write when changing status".
 *
 * The Postgres trigger on `feedback` writes structural diff entries
 * (status_change / assign / update) automatically — we only set
 * app.actor so those rows are stamped with the real admin uid.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await requireAdminSession();
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!FEEDBACK_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "bad_status" }, { status: 400 });
    }
    update.status = body.status;
    if (body.status === "resolved") {
      update.resolved_at = new Date().toISOString();
      update.resolved_by = sess.uid;
    } else {
      // Reverting away from resolved should clear the resolution stamp,
      // otherwise the audit history is misleading.
      update.resolved_at = null;
      update.resolved_by = null;
    }
  }

  if (body.assigned_to !== undefined) {
    if (body.assigned_to !== null && !isUuid(body.assigned_to)) {
      return NextResponse.json({ error: "bad_assignee" }, { status: 400 });
    }
    update.assigned_to = body.assigned_to;
  }

  const comment = (body.comment ?? "").trim();
  if (comment.length > 500) {
    return NextResponse.json({ error: "comment_too_long" }, { status: 400 });
  }

  if (Object.keys(update).length === 0 && comment.length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  // Confirm the row actually exists before writing anything. Postgrest's
  // UPDATE/INSERT are silent no-ops for a well-formed but non-existent id,
  // so without this check we'd return 200 {ok:true} without having changed
  // or logged anything.
  const { data: existing, error: lookupError } = await supabase
    .from("feedback")
    .select("id, status, user_id")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) {
    console.error("feedback lookup error", { code: lookupError.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Validate assignee exists and is an admin (defence-in-depth).
  if (
    body.assigned_to !== undefined &&
    body.assigned_to !== null
  ) {
    const { data: a } = await supabase
      .from("users")
      .select("id, role, is_active")
      .eq("id", body.assigned_to)
      .maybeSingle();
    if (!a || !isAdminTier(a.role as "seller" | "admin" | "super_admin") || !a.is_active) {
      return NextResponse.json({ error: "bad_assignee" }, { status: 400 });
    }
  }

  // Stamp app.actor so the trigger-written audit rows are attributed to us.
  try {
    await supabase.rpc("set_config", {
      setting_name: "app.actor",
      new_value: sess.uid,
      is_local: true,
    });
  } catch {
    // Non-fatal: trigger falls back to 'service_role'.
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase
      .from("feedback")
      .update(update)
      .eq("id", id);
    if (error) {
      console.error("feedback patch error", { code: error.code });
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
  }

  // Notify the seller only on a real new -> in_progress transition, never on
  // a re-save of an already in_progress row. Never blocks the response.
  if (
    body.status === "in_progress" &&
    existing.status === "new" &&
    existing.user_id
  ) {
    await createNotification(supabase, {
      recipientUserId: existing.user_id,
      feedbackId: id,
      type: "feedback.status_in_progress_for_seller",
      title: "Заявку взято в роботу",
      body: "Вашу заявку прийняли та взяли в роботу.",
      payload: { old_status: existing.status, new_status: "in_progress", admin_user_id: sess.uid },
    });
  }

  // Notify the seller when the request is resolved, but only on a real
  // transition into `resolved` — never on a re-save of an already-resolved
  // row. Rejections stay silent for now (out of MVP scope).
  if (
    body.status === "resolved" &&
    existing.status !== "resolved" &&
    existing.user_id
  ) {
    await createNotification(supabase, {
      recipientUserId: existing.user_id,
      feedbackId: id,
      type: "feedback.status_resolved_for_seller",
      title: "Заявку виконано",
      body: "Вашу заявку розглянули та погодили.",
      payload: { old_status: existing.status, new_status: "resolved", admin_user_id: sess.uid },
    });
  }

  if (comment.length > 0) {
    // Write comment to feedback_comments
    await supabase.from("feedback_comments").insert({
      feedback_id: id,
      author_id: sess.uid,
      body: comment,
    });

    await logAudit("admin.feedback.note", {
      actorUserId: sess.uid,
      feedbackId: id,
      targetType: "feedback",
      ip: ipFromRequest(req),
      userAgent: uaFromRequest(req),
      meta: {
        comment,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.assigned_to !== undefined
          ? { assigned_to: body.assigned_to }
          : {}),
      },
    });
  }

  return NextResponse.json({ ok: true });
}

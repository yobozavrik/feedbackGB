import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["new", "in_progress", "resolved", "rejected"] as const;
type Status = (typeof STATUSES)[number];

interface PatchBody {
  status?: Status;
  assigned_to?: string | null;
  comment?: string | null;
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
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || sess.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = params.id;
  if (!UUID_RE.test(id)) {
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
    if (!STATUSES.includes(body.status)) {
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
    if (body.assigned_to !== null && !UUID_RE.test(body.assigned_to)) {
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
    if (!a || a.role !== "admin" || !a.is_active) {
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

  if (comment.length > 0) {
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

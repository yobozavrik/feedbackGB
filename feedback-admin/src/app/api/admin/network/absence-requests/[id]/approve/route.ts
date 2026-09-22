import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { getServerSupabase } from "@/lib/supabase";
import { actionError, boundedText, fail, isIsoDate, isUuid } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return fail("forbidden", 403);
  if (!isUuid(params.id)) return fail("Недійсний id HR-заявки", 400, "invalid_feedback_id");

  let body: { note?: unknown; sick_ends_on?: unknown };
  try { body = await req.json(); } catch { return fail("Неправильний JSON", 400, "invalid_json"); }
  const note = body.note === undefined || body.note === "" ? null : boundedText(body.note);
  if (body.note !== undefined && body.note !== "" && !note) {
    return fail("Примітка має містити від 3 до 500 символів", 400, "invalid_note");
  }
  const sickEndsOn = body.sick_ends_on == null || body.sick_ends_on === "" ? null : body.sick_ends_on;
  if (sickEndsOn !== null && !isIsoDate(sickEndsOn)) {
    return fail("Дата завершення лікарняного має бути у форматі YYYY-MM-DD", 400, "invalid_sick_end_date");
  }

  const supabase = getServerSupabase();
  if (!supabase) return fail("База даних недоступна", 503, "db_unavailable");
  const { data, error } = await supabase.rpc("approve_hr_absence_request", {
    p_feedback_id: params.id, p_actor_user_id: session.uid, p_note: note, p_sick_ends_on: sickEndsOn,
  });
  if (error) return actionError(error.code, error.message);
  const result = Array.isArray(data) ? data[0] : null;
  if (!result || !result.applicant_user_id) return fail("Не вдалося підтвердити HR-заявку", 500, "absence_request_action_error");

  await logAudit("admin.hr_request.approve", {
    actorUserId: session.uid, feedbackId: params.id, targetType: "hr_request",
    ip: ipFromRequest(req), userAgent: uaFromRequest(req),
    meta: { absence_id: result.absence_id ?? null, topic: result.topic },
  });
  await createNotification(supabase, {
    recipientUserId: result.applicant_user_id, feedbackId: params.id,
    type: "feedback.status_resolved_for_seller",
    title: "HR-заявку погоджено", body: "Вашу HR-заявку погоджено.",
    payload: { absence_id: result.absence_id ?? null, topic: result.topic },
  });
  return NextResponse.json({ request: result });
}

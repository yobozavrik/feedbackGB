import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { getServerSupabase } from "@/lib/supabase";
import { actionError, boundedText, fail, isUuid } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return fail("forbidden", 403);
  if (!isUuid(params.id)) return fail("Недійсний id HR-заявки", 400, "invalid_feedback_id");
  let body: { reason?: unknown };
  try { body = await req.json(); } catch { return fail("Неправильний JSON", 400, "invalid_json"); }
  const reason = boundedText(body.reason);
  if (!reason) return fail("Причина відмови має містити від 3 до 500 символів", 400, "invalid_rejection_reason");

  const supabase = getServerSupabase();
  if (!supabase) return fail("База даних недоступна", 503, "db_unavailable");
  const { data, error } = await supabase.rpc("reject_hr_absence_request", {
    p_feedback_id: params.id, p_actor_user_id: session.uid, p_reason: reason,
  });
  if (error) return actionError(error.code, error.message);
  const result = Array.isArray(data) ? data[0] : null;
  if (!result || !result.applicant_user_id) return fail("Не вдалося відхилити HR-заявку", 500, "absence_request_action_error");

  await logAudit("admin.hr_request.reject", {
    actorUserId: session.uid, feedbackId: params.id, targetType: "hr_request",
    ip: ipFromRequest(req), userAgent: uaFromRequest(req), meta: { reason, topic: result.topic },
  });
  await createNotification(supabase, {
    recipientUserId: result.applicant_user_id, feedbackId: params.id,
    type: "feedback.status_rejected_for_seller",
    title: "HR-заявку відхилено", body: "HR-заявку відхилено. Причина є в історії заявки.",
    payload: { topic: result.topic },
  });
  return NextResponse.json({ request: result });
}

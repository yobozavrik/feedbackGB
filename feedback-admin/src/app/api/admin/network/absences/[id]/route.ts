import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(["vacation", "sick_leave", "day_off"]);

function fail(error: string, status: number, code = error) {
  return NextResponse.json({ error, code }, { status });
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length >= 3 && result.length <= 500 ? result : null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function databaseError(code?: string) {
  if (code === "23P01") return fail("У продавця вже є активна відсутність у цьому періоді", 422, "absence_overlap");
  if (code === "42P01" || code === "42703") return fail("Міграція відсутностей ще не застосована", 503, "absence_schema_missing");
  if (code === "23514" || code === "P0001") return fail("Недійсні дані відсутності", 422, "absence_validation");
  return fail("Не вдалося зберегти відсутність", 500, "absence_update_error");
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return fail("forbidden", 403);
  if (!UUID.test(params.id)) return fail("Недійсний id відсутності", 400, "invalid_absence_id");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("Неправильний JSON", 400, "invalid_json"); }
  const version = body.row_version;
  if (!Number.isInteger(version) || typeof version !== "number" || version < 1) {
    return fail("Потрібна актуальна версія відсутності", 400, "missing_row_version");
  }
  const requestedCancelReason = body.action === "cancel" ? text(body.cancel_reason) : null;
  if (body.action === "cancel" && !requestedCancelReason) {
    return fail("Причина скасування має містити від 3 до 500 символів", 400, "invalid_cancel_reason");
  }

  const supabase = getServerSupabase();
  if (!supabase) return fail("База даних недоступна", 503, "db_unavailable");
  const { data: current, error: currentError } = await supabase
    .from("employee_absences")
    .select("id, employee_id, status, row_version, absence_type, starts_on, ends_on, store_id, note")
    .eq("id", params.id)
    .maybeSingle();
  if (currentError) return databaseError(currentError.code);
  if (!current) return fail("Відсутність не знайдено", 404, "absence_not_found");
  if (current.row_version !== version) return fail("Відсутність вже змінив інший адміністратор", 409, "absence_conflict");

  if (body.action === "cancel") {
    if (current.status !== "active") return fail("Скасувати можна лише активну відсутність", 409, "absence_not_active");
    const { data, error } = await supabase
      .from("employee_absences")
      .update({
        status: "cancelled", cancelled_by: session.uid, cancelled_at: new Date().toISOString(),
        cancel_reason: requestedCancelReason, updated_by: session.uid,
      })
      .eq("id", params.id)
      .eq("row_version", version)
      .select("id, row_version, status")
      .maybeSingle();
    if (error) return databaseError(error.code);
    if (!data) return fail("Відсутність вже змінив інший адміністратор", 409, "absence_conflict");
    await logAudit("admin.absence.cancel", {
      actorUserId: session.uid, targetUserId: current.employee_id, targetType: "employee_absence",
      ip: ipFromRequest(req), userAgent: uaFromRequest(req), meta: { absence_id: params.id, cancel_reason: requestedCancelReason },
    });
    return NextResponse.json({ absence: data });
  }

  if (current.status !== "active") return fail("Скасовану відсутність не можна редагувати", 409, "absence_cancelled");
  const starts = body.starts_on === undefined ? current.starts_on : body.starts_on;
  const ends = body.ends_on === undefined ? current.ends_on : body.ends_on;
  const type = body.absence_type === undefined ? current.absence_type : body.absence_type;
  const storeId = body.store_id === undefined ? current.store_id : body.store_id;
  const note = body.note === undefined ? current.note : body.note === "" ? null : text(body.note);
  if (!isIsoDate(starts) || !isIsoDate(ends) || starts > ends
    || !TYPES.has(String(type)) || (storeId != null && (!Number.isInteger(storeId) || Number(storeId) < 1))
    || (body.note !== undefined && body.note !== "" && !note)) {
    return fail("Недійсні дані відсутності", 400, "invalid_absence");
  }
  const { data, error } = await supabase
    .from("employee_absences")
    .update({ starts_on: starts, ends_on: ends, absence_type: type, store_id: storeId, note, updated_by: session.uid })
    .eq("id", params.id)
    .eq("row_version", version)
    .select("id, row_version, status")
    .maybeSingle();
  if (error) return databaseError(error.code);
  if (!data) return fail("Відсутність вже змінив інший адміністратор", 409, "absence_conflict");
  await logAudit("admin.absence.update", {
    actorUserId: session.uid, targetUserId: current.employee_id, targetType: "employee_absence",
    ip: ipFromRequest(req), userAgent: uaFromRequest(req), meta: { absence_id: params.id },
  });
  return NextResponse.json({ absence: data });
}

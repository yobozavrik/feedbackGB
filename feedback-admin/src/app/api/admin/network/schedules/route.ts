import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ShiftStatus = "scheduled" | "cancelled";

interface ScheduleRow {
  shift_id: string;
  period_id: string;
  period_status: "draft" | "published" | "locked" | "archived";
  employee_id: string;
  employee_full_name: string;
  employee_display_label: string | null;
  employee_home_store_id: number | null;
  store_id: number;
  store_name: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  shift_status: ShiftStatus;
  is_replacement: boolean;
  replacement_permission_id: string | null;
  change_reason: string | null;
  row_version: number;
}

function jsonError(error: string, status: number, code?: string) {
  return NextResponse.json({ error, code: code ?? error }, { status });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function parseMonth(value: string | null): string | null {
  return value && ISO_MONTH.test(value) ? value : null;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseBreakMinutes(value: unknown): number | null {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value > 480) return null;
  return value;
}

function parseReason(value: unknown, required: boolean): string | null {
  if (value == null || value === "") return required ? null : null;
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 3 && reason.length <= 500 ? reason : null;
}

function mapDatabaseError(code?: string) {
  if (code === "23P01") return jsonError("Перетин змін одного працівника", 422, "schedule_overlap");
  if (code === "23514" || code === "P0001") return jsonError("Недійсні дані зміни", 422, "schedule_validation");
  if (code === "42P01") return jsonError("Міграція графіків ще не застосована", 503, "schedule_schema_missing");
  return jsonError("Помилка збереження графіка", 500, "schedule_db_error");
}

async function resolveAssignment(
  employeeId: string,
  storeId: number,
) {
  const supabase = getServerSupabase();
  if (!supabase) return { error: jsonError("База даних недоступна", 503, "db_unavailable") } as const;

  const { data: employee, error: employeeError } = await supabase
    .from("users")
    .select("id, role, is_active, store_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (employeeError) return { error: mapDatabaseError(employeeError.code) } as const;
  if (!employee || employee.role !== "seller" || !employee.is_active) {
    return { error: jsonError("Можна призначити лише активного продавця", 422, "employee_not_schedulable") } as const;
  }

  if (employee.store_id === storeId) {
    return { isReplacement: false, replacementPermissionId: null } as const;
  }

  const { data: permission, error: permissionError } = await supabase
    .from("seller_store_permissions")
    .select("id")
    .eq("seller_id", employeeId)
    .eq("store_id", storeId)
    .is("revoked_at", null)
    .maybeSingle();

  if (permissionError) return { error: mapDatabaseError(permissionError.code) } as const;
  if (!permission) {
    return { error: jsonError("Для цього магазину немає дозволу на заміну", 422, "replacement_store_not_allowed") } as const;
  }

  return { isReplacement: true, replacementPermissionId: permission.id as string } as const;
}

/** GET /api/admin/network/schedules?month=YYYY-MM&storeId=&employeeId= */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return jsonError("forbidden", 403);

  const { searchParams } = new URL(req.url);
  const month = parseMonth(searchParams.get("month"));
  if (!month) return jsonError("Потрібен параметр month у форматі YYYY-MM", 400, "invalid_month");

  const storeIdRaw = searchParams.get("storeId");
  const employeeId = searchParams.get("employeeId");
  const storeId = storeIdRaw == null ? null : Number(storeIdRaw);
  if (storeIdRaw != null && (!Number.isInteger(storeId) || storeId! <= 0)) {
    return jsonError("Недійсний storeId", 400, "invalid_store_id");
  }
  if (employeeId != null && !isUuid(employeeId)) {
    return jsonError("Недійсний employeeId", 400, "invalid_employee_id");
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ shifts: [] });

  let query = supabase
    .from("v_store_schedule_calendar")
    .select("shift_id, period_id, period_status, employee_id, employee_full_name, employee_display_label, employee_home_store_id, store_id, store_name, starts_at, ends_at, break_minutes, shift_status, is_replacement, replacement_permission_id, change_reason, row_version")
    .eq("period_start", `${month}-01`)
    .order("store_name", { ascending: true })
    .order("starts_at", { ascending: true });

  if (storeId != null) query = query.eq("store_id", storeId);
  if (employeeId != null) query = query.eq("employee_id", employeeId);

  const { data, error } = await query;
  if (error) return mapDatabaseError(error.code);
  return NextResponse.json({ shifts: (data ?? []) as ScheduleRow[] });
}

/** POST /api/admin/network/schedules */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return jsonError("forbidden", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Неправильний JSON", 400, "invalid_json");
  }

  const periodId = body.period_id;
  const employeeId = body.employee_id;
  const storeId = body.store_id;
  const startsAt = parseTimestamp(body.starts_at);
  const endsAt = parseTimestamp(body.ends_at);
  const breakMinutes = parseBreakMinutes(body.break_minutes ?? 0);

  if (!isUuid(periodId) || !isUuid(employeeId) || !Number.isInteger(storeId) || (storeId as number) <= 0 || !startsAt || !endsAt || breakMinutes == null) {
    return jsonError("Недійсні дані зміни", 400, "invalid_shift_input");
  }
  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    return jsonError("Час завершення має бути пізніше початку", 400, "invalid_shift_interval");
  }

  const supabase = getServerSupabase();
  if (!supabase) return jsonError("База даних недоступна", 503, "db_unavailable");

  const { data: period, error: periodError } = await supabase
    .from("work_schedule_periods")
    .select("id, status")
    .eq("id", periodId)
    .maybeSingle();
  if (periodError) return mapDatabaseError(periodError.code);
  if (!period) return jsonError("Період графіка не знайдено", 404, "schedule_period_not_found");
  if (period.status === "locked" || period.status === "archived") {
    return jsonError("Період графіка закритий", 423, "schedule_period_locked");
  }

  const assignment = await resolveAssignment(employeeId, storeId as number);
  if ("error" in assignment) return assignment.error ?? jsonError("Помилка перевірки заміни", 500, "assignment_validation_failed");

  const { data: shift, error } = await supabase
    .from("store_work_shifts")
    .insert({
      period_id: periodId,
      employee_id: employeeId,
      store_id: storeId,
      starts_at: startsAt,
      ends_at: endsAt,
      break_minutes: breakMinutes,
      status: "scheduled",
      is_replacement: assignment.isReplacement,
      replacement_permission_id: assignment.replacementPermissionId,
      created_by: session.uid,
      updated_by: session.uid,
    })
    .select("id, row_version")
    .single();

  if (error) return mapDatabaseError(error.code);

  await logAudit("admin.schedule.create", {
    actorUserId: session.uid,
    targetType: "store_work_shift",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: { shift_id: shift.id, period_id: periodId, employee_id: employeeId, store_id: storeId, is_replacement: assignment.isReplacement },
  });

  return NextResponse.json({ shift }, { status: 201 });
}

/** PATCH /api/admin/network/schedules?id=<uuid> */
export async function PATCH(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return jsonError("forbidden", 403);

  const shiftId = new URL(req.url).searchParams.get("id");
  if (!isUuid(shiftId)) return jsonError("Недійсний id зміни", 400, "invalid_shift_id");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Неправильний JSON", 400, "invalid_json");
  }

  const expectedVersion = body.row_version;
  if (!Number.isInteger(expectedVersion) || typeof expectedVersion !== "number" || expectedVersion < 1) {
    return jsonError("Потрібна актуальна версія зміни", 400, "missing_row_version");
  }

  const supabase = getServerSupabase();
  if (!supabase) return jsonError("База даних недоступна", 503, "db_unavailable");

  const { data: current, error: currentError } = await supabase
    .from("store_work_shifts")
    .select("id, period_id, employee_id, store_id, starts_at, ends_at, break_minutes, status, is_replacement, replacement_permission_id, row_version")
    .eq("id", shiftId)
    .maybeSingle();
  if (currentError) return mapDatabaseError(currentError.code);
  if (!current) return jsonError("Зміну не знайдено", 404, "shift_not_found");
  if (current.row_version !== expectedVersion) {
    return jsonError("Зміну вже змінив інший адміністратор", 409, "schedule_conflict");
  }
  if (current.status === "cancelled") {
    return jsonError("Скасовану зміну не можна редагувати", 409, "shift_cancelled");
  }

  const { data: period, error: periodError } = await supabase
    .from("work_schedule_periods")
    .select("id, status")
    .eq("id", current.period_id)
    .maybeSingle();
  if (periodError) return mapDatabaseError(periodError.code);
  if (!period) return jsonError("Період графіка не знайдено", 404, "schedule_period_not_found");
  if (period.status === "locked" || period.status === "archived") {
    return jsonError("Період графіка закритий", 423, "schedule_period_locked");
  }

  const nextEmployeeId = body.employee_id === undefined ? current.employee_id : body.employee_id;
  const nextStoreId = body.store_id === undefined ? current.store_id : body.store_id;
  const nextStartsAt = body.starts_at === undefined ? current.starts_at : parseTimestamp(body.starts_at);
  const nextEndsAt = body.ends_at === undefined ? current.ends_at : parseTimestamp(body.ends_at);
  const nextBreakMinutes = body.break_minutes === undefined ? current.break_minutes : parseBreakMinutes(body.break_minutes);
  const requestedStatus = body.status === undefined ? "scheduled" : body.status;

  if (!isUuid(nextEmployeeId) || !Number.isInteger(nextStoreId) || typeof nextStoreId !== "number" || nextStoreId <= 0 || !nextStartsAt || !nextEndsAt || nextBreakMinutes == null) {
    return jsonError("Недійсні дані зміни", 400, "invalid_shift_input");
  }
  if (new Date(nextStartsAt).getTime() >= new Date(nextEndsAt).getTime()) {
    return jsonError("Час завершення має бути пізніше початку", 400, "invalid_shift_interval");
  }
  if (requestedStatus !== "scheduled" && requestedStatus !== "cancelled") {
    return jsonError("Недійсний статус зміни", 400, "invalid_shift_status");
  }

  const changed = nextEmployeeId !== current.employee_id
    || nextStoreId !== current.store_id
    || nextStartsAt !== current.starts_at
    || nextEndsAt !== current.ends_at
    || nextBreakMinutes !== current.break_minutes
    || requestedStatus !== current.status;
  if (!changed) return jsonError("Немає змін для збереження", 400, "no_shift_changes");

  const cancellation = requestedStatus === "cancelled";
  const reasonRequired = cancellation || period.status === "published";
  const reason = parseReason(body.change_reason, reasonRequired);
  if (reasonRequired && !reason) {
    return jsonError("Для цієї зміни потрібна причина", 400, "change_reason_required");
  }
  if (body.change_reason !== undefined && !reason) {
    return jsonError("Причина має містити від 3 до 500 символів", 400, "invalid_change_reason");
  }

  const assignmentChanged = nextEmployeeId !== current.employee_id || nextStoreId !== current.store_id;
  const assignment = assignmentChanged && !cancellation
    ? await resolveAssignment(nextEmployeeId, nextStoreId)
    : { isReplacement: current.is_replacement, replacementPermissionId: current.replacement_permission_id };
  if ("error" in assignment) return assignment.error ?? jsonError("Помилка перевірки заміни", 500, "assignment_validation_failed");

  const update: Record<string, unknown> = {
    employee_id: nextEmployeeId,
    store_id: nextStoreId,
    starts_at: nextStartsAt,
    ends_at: nextEndsAt,
    break_minutes: nextBreakMinutes,
    status: requestedStatus,
    is_replacement: assignment.isReplacement,
    replacement_permission_id: assignment.replacementPermissionId,
    change_reason: reason,
    updated_by: session.uid,
  };
  if (cancellation) {
    update.cancelled_at = new Date().toISOString();
    update.cancelled_by = session.uid;
  }

  const { data: shift, error } = await supabase
    .from("store_work_shifts")
    .update(update)
    .eq("id", shiftId)
    .eq("row_version", expectedVersion)
    .select("id, row_version, status")
    .maybeSingle();
  if (error) return mapDatabaseError(error.code);
  if (!shift) return jsonError("Зміну вже змінив інший адміністратор", 409, "schedule_conflict");

  await logAudit(cancellation ? "admin.schedule.cancel" : "admin.schedule.update", {
    actorUserId: session.uid,
    targetType: "store_work_shift",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: { shift_id: shiftId, period_id: current.period_id, employee_id: nextEmployeeId, store_id: nextStoreId, row_version: shift.row_version },
  });

  return NextResponse.json({ shift });
}

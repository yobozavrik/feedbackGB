import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function monthBounds(month: string) {
  const match = ISO_MONTH.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
  return { first, last };
}

function errorResponse(error: string, status: number, code = error) {
  return NextResponse.json({ error, code }, { status });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function lockReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 3 && reason.length <= 500 ? reason : null;
}

/** GET /api/admin/network/schedule-periods?month=YYYY-MM */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return errorResponse("forbidden", 403);

  const month = new URL(req.url).searchParams.get("month");
  const bounds = month ? monthBounds(month) : null;
  if (!bounds) return errorResponse("Потрібен month у форматі YYYY-MM", 400, "invalid_month");

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ period: null });
  const { data, error } = await supabase
    .from("work_schedule_periods")
    .select("id, period_start, period_end, status, timezone, row_version, published_at, locked_at")
    .eq("scope", "store")
    .eq("period_start", bounds.first)
    .maybeSingle();

  if (error?.code === "42P01") return errorResponse("Міграція графіків ще не застосована", 503, "schedule_schema_missing");
  if (error) return errorResponse("Не вдалося завантажити період графіка", 500, "schedule_db_error");
  return NextResponse.json({ period: data ?? null });
}

/** POST /api/admin/network/schedule-periods */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return errorResponse("forbidden", 403);

  let body: { month?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Неправильний JSON", 400, "invalid_json");
  }

  const bounds = typeof body.month === "string" ? monthBounds(body.month) : null;
  if (!bounds) return errorResponse("Потрібен month у форматі YYYY-MM", 400, "invalid_month");

  const supabase = getServerSupabase();
  if (!supabase) return errorResponse("База даних недоступна", 503, "db_unavailable");
  const { data: period, error } = await supabase
    .from("work_schedule_periods")
    .insert({
      scope: "store",
      period_start: bounds.first,
      period_end: bounds.last,
      timezone: "Europe/Kyiv",
      status: "draft",
      created_by: session.uid,
      updated_by: session.uid,
    })
    .select("id, period_start, period_end, status, timezone, row_version")
    .single();

  if (error?.code === "23505") return errorResponse("Графік на цей місяць уже існує", 409, "schedule_period_exists");
  if (error?.code === "42P01") return errorResponse("Міграція графіків ще не застосована", 503, "schedule_schema_missing");
  if (error) return errorResponse("Не вдалося створити період графіка", 500, "schedule_db_error");

  await logAudit("admin.schedule.period_create", {
    actorUserId: session.uid,
    targetType: "work_schedule_period",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: { period_id: period.id, period_start: period.period_start, period_end: period.period_end },
  });
  return NextResponse.json({ period }, { status: 201 });
}

/** PATCH /api/admin/network/schedule-periods?id=<uuid>, super admin only. */
export async function PATCH(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession("super_admin");
  if (!session) return errorResponse("forbidden", 403);

  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return errorResponse("Недійсний id періоду", 400, "invalid_period_id");

  let body: { action?: unknown; row_version?: unknown; lock_reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Неправильний JSON", 400, "invalid_json");
  }
  if (body.action !== "publish" && body.action !== "lock") {
    return errorResponse("Недійсна дія з періодом", 400, "invalid_period_action");
  }
  if (!Number.isInteger(body.row_version) || typeof body.row_version !== "number" || body.row_version < 1) {
    return errorResponse("Потрібна актуальна версія періоду", 400, "missing_row_version");
  }
  const reason = body.action === "lock" ? lockReason(body.lock_reason) : null;
  if (body.action === "lock" && !reason) {
    return errorResponse("Для закриття потрібна причина від 3 до 500 символів", 400, "lock_reason_required");
  }

  const supabase = getServerSupabase();
  if (!supabase) return errorResponse("База даних недоступна", 503, "db_unavailable");

  const { data: current, error: currentError } = await supabase
    .from("work_schedule_periods")
    .select("id, status, row_version, period_start, period_end")
    .eq("id", id)
    .maybeSingle();
  if (currentError) return errorResponse("Не вдалося завантажити період графіка", 500, "schedule_db_error");
  if (!current) return errorResponse("Період графіка не знайдено", 404, "schedule_period_not_found");
  if (current.row_version !== body.row_version) {
    return errorResponse("Період уже змінив інший адміністратор", 409, "schedule_period_conflict");
  }

  if (body.action === "publish") {
    if (current.status !== "draft") return errorResponse("Опублікувати можна лише чернетку", 409, "period_not_draft");
    const { data: issues, error: issuesError } = await supabase
      .from("v_store_schedule_issues")
      .select("shift_id")
      .eq("period_id", id)
      .limit(1);
    if (issuesError) return errorResponse("Не вдалося перевірити графік перед публікацією", 500, "schedule_issue_check_failed");
    if (issues?.length) return errorResponse("У графіку є непридатні призначення", 422, "schedule_has_issues");
  } else if (current.status !== "published") {
    return errorResponse("Закрити можна лише опублікований графік", 409, "period_not_published");
  }

  const now = new Date().toISOString();
  const update = body.action === "publish"
    ? { status: "published", published_at: now, published_by: session.uid, updated_by: session.uid }
    : { status: "locked", locked_at: now, locked_by: session.uid, lock_reason: reason, updated_by: session.uid };
  const { data: period, error } = await supabase
    .from("work_schedule_periods")
    .update(update)
    .eq("id", id)
    .eq("row_version", body.row_version)
    .select("id, period_start, period_end, status, timezone, row_version, published_at, locked_at")
    .maybeSingle();
  if (error) return errorResponse("Не вдалося оновити період графіка", 500, "schedule_db_error");
  if (!period) return errorResponse("Період уже змінив інший адміністратор", 409, "schedule_period_conflict");

  await logAudit(body.action === "publish" ? "admin.schedule.period_publish" : "admin.schedule.period_lock", {
    actorUserId: session.uid,
    targetType: "work_schedule_period",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
    meta: { period_id: id, period_start: current.period_start, action: body.action, lock_reason: reason },
  });
  return NextResponse.json({ period });
}

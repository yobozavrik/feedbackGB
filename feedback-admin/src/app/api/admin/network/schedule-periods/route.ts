import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

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

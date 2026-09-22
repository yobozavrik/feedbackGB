import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function bounds(month: string) {
  const match = ISO_MONTH.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  return { first: `${month}-01`, last: new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10) };
}

/** GET /api/admin/network/schedule-photo-control?month=YYYY-MM */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month");
  const period = month ? bounds(month) : null;
  if (!period) return NextResponse.json({ error: "Потрібен month у форматі YYYY-MM", code: "invalid_month" }, { status: 400 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ shifts: [], unmatched_reports: [] });
  const [shiftsResult, unmatchedResult] = await Promise.all([
    supabase.from("v_store_schedule_shift_photo_report_control")
      .select("period_id, period_start, period_end, period_status, shift_id, employee_id, employee_full_name, store_id, store_name, starts_at, ends_at, is_replacement, matched_photo_report_count, first_matched_photo_report_at, last_matched_photo_report_at, has_matched_photo_report")
      .eq("period_start", period.first)
      .order("starts_at", { ascending: true }),
    supabase.from("v_store_schedule_unmatched_photo_reports")
      .select("feedback_id, seller_id, seller_full_name, report_store_id, store_name, submitted_at, local_date")
      .gte("local_date", period.first)
      .lte("local_date", period.last)
      .order("submitted_at", { ascending: false }),
  ]);

  const schemaMissing = shiftsResult.error?.code === "42P01" || unmatchedResult.error?.code === "42P01";
  if (schemaMissing) return NextResponse.json({ error: "Міграція контролю фотозвітів ще не застосована", code: "schedule_photo_control_schema_missing" }, { status: 503 });
  if (shiftsResult.error || unmatchedResult.error) return NextResponse.json({ error: "Не вдалося завантажити контроль фотозвітів", code: "schedule_photo_control_error" }, { status: 500 });
  return NextResponse.json({ shifts: shiftsResult.data ?? [], unmatched_reports: unmatchedResult.data ?? [] });
}

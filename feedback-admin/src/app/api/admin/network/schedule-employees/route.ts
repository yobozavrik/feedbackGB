import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** GET /api/admin/network/schedule-employees?month=YYYY-MM */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 });
  const month = new URL(req.url).searchParams.get("month");
  if (!month || !ISO_MONTH.test(month)) return NextResponse.json({ error: "Потрібен month у форматі YYYY-MM", code: "invalid_month" }, { status: 400 });
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ employees: [] });
  const { data, error } = await supabase
    .from("v_store_schedule_employee_month")
    .select("period_id, employee_id, employee_full_name, employee_display_label, employee_home_store_id, scheduled_shift_count, cancelled_shift_count, replacement_shift_count, planned_minutes")
    .eq("period_start", `${month}-01`)
    .order("employee_full_name", { ascending: true });
  if (error?.code === "42P01") return NextResponse.json({ error: "Міграція графіків ще не застосована", code: "schedule_schema_missing" }, { status: 503 });
  if (error) return NextResponse.json({ error: "Не вдалося завантажити підсумок працівників", code: "schedule_employees_error" }, { status: 500 });
  return NextResponse.json({ employees: data ?? [] });
}

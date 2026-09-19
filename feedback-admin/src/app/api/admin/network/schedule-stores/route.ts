import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** GET /api/admin/network/schedule-stores?month=YYYY-MM */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month");
  if (!month || !ISO_MONTH.test(month)) {
    return NextResponse.json({ error: "Потрібен month у форматі YYYY-MM", code: "invalid_month" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ stores: [] });

  const { data, error } = await supabase
    .from("v_store_schedule_store_month")
    .select("period_id, period_start, period_end, period_status, store_id, store_name, scheduled_shift_count, cancelled_shift_count, replacement_shift_count, scheduled_employee_count, planned_minutes")
    .eq("period_start", `${month}-01`)
    .order("store_name", { ascending: true });

  if (error?.code === "42P01") {
    return NextResponse.json({ error: "Міграція сітки графіків ще не застосована", code: "schedule_grid_schema_missing" }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: "Не вдалося завантажити статистику магазинів", code: "schedule_stores_error" }, { status: 500 });
  return NextResponse.json({ stores: data ?? [] });
}

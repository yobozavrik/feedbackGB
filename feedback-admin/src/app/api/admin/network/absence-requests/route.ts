import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPICS = new Set(["vacation", "sick-leave", "day-off", "transfer"]);

function fail(error: string, status: number, code = error) {
  return NextResponse.json({ error, code }, { status });
}

function monthBounds(month: string) {
  const match = MONTH.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const first = month + "-01";
  const last = new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
  const nextStart = new Date(Date.UTC(year, monthIndex, 1)).toISOString();
  return { first, last, nextStart };
}

function isSchemaMissing(code?: string) {
  return code === "42P01" || code === "42703" || code === "42883";
}

/** GET /api/admin/network/absence-requests?month=YYYY-MM&topic=&storeId=&sellerId= */
export async function GET(req: Request): Promise<NextResponse> {
  if (!await requireAdminSession()) return fail("forbidden", 403);

  const params = new URL(req.url).searchParams;
  const bounds = monthBounds(params.get("month") ?? "");
  if (!bounds) return fail("Потрібен month у форматі YYYY-MM", 400, "invalid_month");

  const topic = params.get("topic");
  const storeIdRaw = params.get("storeId");
  const sellerId = params.get("sellerId");
  const storeId = storeIdRaw == null || storeIdRaw === "" ? null : Number(storeIdRaw);
  if (topic && !TOPICS.has(topic)) return fail("Недійсний тип HR-заявки", 400, "invalid_topic");
  if (storeIdRaw != null && storeIdRaw !== "" && (!Number.isInteger(storeId) || storeId! < 1)) {
    return fail("Недійсний storeId", 400, "invalid_store_id");
  }
  if (sellerId && !UUID.test(sellerId)) return fail("Недійсний sellerId", 400, "invalid_seller_id");

  const supabase = getServerSupabase();
  if (!supabase) return fail("База даних недоступна", 503, "db_unavailable");

  // Dated requests are selected by local-date intersection. An open sick leave
  // remains visible while actionable; after approval its linked absence supplies
  // the end date in the view. Transfers and terminal open requests stay only in
  // their submission month.
  let query = supabase
    .from("v_hr_absence_requests")
    .select("*")
    .or(
      "and(requested_date_from.lte." + bounds.last + ",requested_date_to.gte." + bounds.first + ")," +
      "and(requested_date_from.not.is.null,requested_date_to.is.null,requested_date_from.lte." + bounds.last + ",feedback_status.in.(new,in_progress))," +
      "and(requested_date_from.is.null,requested_at.gte." + bounds.first + "T00:00:00.000Z,requested_at.lt." + bounds.nextStart + ")," +
      "and(requested_date_from.not.is.null,requested_date_to.is.null,feedback_status.in.(resolved,rejected),requested_at.gte." + bounds.first + "T00:00:00.000Z,requested_at.lt." + bounds.nextStart + ")",
    )
    .order("requested_at", { ascending: true });

  if (topic) query = query.eq("hr_topic", topic);
  if (storeId != null) query = query.eq("requested_store_id", storeId);
  if (sellerId) query = query.eq("employee_id", sellerId);

  const { data, error } = await query;
  if (isSchemaMissing(error?.code)) {
    return fail("Міграція HR-заявок ще не застосована", 503, "absence_request_schema_missing");
  }
  if (error) return fail("Не вдалося завантажити HR-заявки", 500, "absence_request_load_error");
  return NextResponse.json({ requests: data ?? [] });
}

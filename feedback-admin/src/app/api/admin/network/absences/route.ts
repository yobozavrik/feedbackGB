import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { getServerSupabase } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(["vacation", "sick_leave", "day_off"]);
const fail = (error: string, status: number, code = error) => NextResponse.json({ error, code }, { status });

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(req: Request) {
  if (!await requireAdminSession()) return fail("forbidden", 403);
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("Потрібен month у форматі YYYY-MM", 400, "invalid_month");
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const supabase = getServerSupabase(); if (!supabase) return NextResponse.json({ absences: [] });
  const { data, error } = await supabase.from("v_employee_absences").select("*").lte("starts_on", end).gte("ends_on", `${month}-01`).order("starts_on", { ascending: true });
  if (error?.code === "42P01") return fail("Міграція відсутностей ще не застосована", 503, "absence_schema_missing");
  if (error) return fail("Не вдалося завантажити відсутності", 500, "absence_load_error");
  return NextResponse.json({ absences: data ?? [] });
}

export async function POST(req: Request) {
  const session = await requireAdminSession(); if (!session) return fail("forbidden", 403);
  let body: Record<string, unknown>; try { body = await req.json(); } catch { return fail("Неправильний JSON", 400, "invalid_json"); }
  const employeeId = body.employee_id; const storeId = body.store_id; const type = body.absence_type; const starts = body.starts_on; const ends = body.ends_on;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  if (!UUID.test(String(employeeId)) || !TYPES.has(String(type)) || !isIsoDate(starts) || !isIsoDate(ends) || starts > ends || (storeId != null && (!Number.isInteger(storeId) || Number(storeId) < 1)) || (note && (note.length < 3 || note.length > 500))) return fail("Недійсні дані відсутності", 400, "invalid_absence");
  const supabase = getServerSupabase(); if (!supabase) return fail("База даних недоступна", 503, "db_unavailable");
  const { data, error } = await supabase.from("employee_absences").insert({ employee_id: employeeId, store_id: storeId ?? null, absence_type: type, starts_on: starts, ends_on: ends, note, created_by: session.uid, updated_by: session.uid }).select("id, row_version").single();
  if (error?.code === "23P01") return fail("У продавця вже є активна відсутність у цьому періоді", 422, "absence_overlap");
  if (error?.code === "42P01") return fail("Міграція відсутностей ще не застосована", 503, "absence_schema_missing");
  if (error?.code === "23514" || error?.code === "P0001") return fail("Недійсні дані відсутності", 422, "absence_validation");
  if (error) return fail("Не вдалося зберегти відсутність", 500, "absence_create_error");
  await logAudit("admin.absence.create", { actorUserId: session.uid, targetUserId: String(employeeId), targetType: "employee_absence", ip: ipFromRequest(req), userAgent: uaFromRequest(req), meta: { absence_id: data.id, absence_type: type, starts_on: starts, ends_on: ends } });
  return NextResponse.json({ absence: data }, { status: 201 });
}

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";
import { CALENDAR_COLUMNS, UUID_PATTERN, calendarInput, calendarRange } from "@/lib/admin/calendar";

export const dynamic = "force-dynamic";
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const ok = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function dbError(error: { code?: string }) {
  if (["42P01", "42703"].includes(error.code ?? "")) return fail("Застосуйте міграцію 039 особистого календаря", 503);
  if (["23514", "P0001"].includes(error.code ?? "")) return fail("Недійсні дані календаря", 422);
  return fail("Не вдалося виконати операцію календаря", 500);
}
async function context() {
  const session = await requireAdminSession();
  if (!session) return { response: fail("forbidden", 403) };
  const db = getServerSupabase();
  if (!db) return { response: fail("База даних недоступна", 503) };
  // Cookie is identity, current DB state is permission. Deactivated admins cannot use old cookies.
  const { data, error } = await db.from("users").select("id").eq("id", session.uid).eq("is_active", true).in("role", ["admin", "super_admin"]).maybeSingle();
  if (error) return { response: fail("Не вдалося перевірити доступ", 503) };
  if (!data) return { response: fail("forbidden", 403) };
  return { db, uid: session.uid };
}
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return req.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin === new URL(req.url).origin);
}
export async function GET(req: Request) {
  const ctx = await context(); if (ctx.response) return ctx.response;
  const params = new URL(req.url).searchParams;
  let query = ctx.db.from("admin_calendar_tasks").select(CALENDAR_COLUMNS).eq("owner_id", ctx.uid);
  if (params.get("mode") === "reminders") {
    query = query.eq("status", "planned").is("reminder_seen_at", null).lte("remind_at", new Date().toISOString()).order("remind_at").limit(100);
  } else {
    const range = calendarRange(params.get("from"), params.get("to"));
    if (!range) return fail("Недійсний період (максимум 62 дні)", 400);
    query = query.gte("due_at", range.start).lt("due_at", range.end).order("due_at").limit(1001);
  }
  const { data, error } = await query;
  if (error) return dbError(error);
  if ((data?.length ?? 0) > 1000) return fail("Забагато задач за період. Оберіть коротший період", 422);
  return ok({ tasks: data ?? [] });
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("forbidden_origin", 403);
  const ctx = await context(); if (ctx.response) return ctx.response;
  const body = await req.json().catch(() => null);
  const input = calendarInput(body);
  if (!input || body.id != null || body.row_version != null) return fail("Недійсна задача", 400);
  const { data, error } = await ctx.db.from("admin_calendar_tasks").insert({ ...input, owner_id: ctx.uid }).select(CALENDAR_COLUMNS).single();
  return error ? dbError(error) : ok({ task: data }, 201);
}
export async function PATCH(req: Request) {
  if (!sameOrigin(req)) return fail("forbidden_origin", 403);
  const ctx = await context(); if (ctx.response) return ctx.response;
  const body = await req.json().catch(() => null);
  if (!body || !UUID_PATTERN.test(body.id ?? "") || !Number.isInteger(body.row_version) || body.row_version < 1) return fail("Недійсний ID або версія", 400);
  const acknowledge = body.acknowledge === true && Object.keys(body).every(key => ["id", "row_version", "acknowledge"].includes(key));
  const input = acknowledge ? { reminder_seen_at: new Date().toISOString() } : calendarInput(body);
  if (!input) return fail("Недійсна задача", 400);
  const { data, error } = await ctx.db.from("admin_calendar_tasks").update(input).eq("id", body.id).eq("owner_id", ctx.uid).eq("row_version", body.row_version).select(CALENDAR_COLUMNS).maybeSingle();
  if (error) return dbError(error);
  if (!data) return fail("Задача недоступна або вже змінена. Оновіть календар", 409);
  return ok({ task: data });
}

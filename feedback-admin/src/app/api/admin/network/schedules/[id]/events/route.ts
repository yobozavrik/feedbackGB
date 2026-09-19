import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/admin/network/schedules/:id/events */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Недійсний id зміни", code: "invalid_shift_id" }, { status: 400 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ events: [] });
  const { data: events, error } = await supabase
    .from("store_work_shift_events")
    .select("id, event_type, actor_user_id, occurred_at, reason, before_state, after_state")
    .eq("shift_id", params.id)
    .order("occurred_at", { ascending: false });
  if (error?.code === "42P01") return NextResponse.json({ error: "Міграція графіків ще не застосована", code: "schedule_schema_missing" }, { status: 503 });
  if (error) return NextResponse.json({ error: "Не вдалося завантажити історію зміни", code: "schedule_events_error" }, { status: 500 });

  const actorIds = [...new Set((events ?? []).map((event) => event.actor_user_id).filter((id): id is string => typeof id === "string"))];
  const { data: users, error: usersError } = actorIds.length
    ? await supabase.from("users").select("id, full_name, display_label").in("id", actorIds)
    : { data: [], error: null };
  if (usersError) return NextResponse.json({ error: "Не вдалося завантажити авторів змін", code: "schedule_event_actors_error" }, { status: 500 });
  const actorById = new Map((users ?? []).map((user) => [user.id as string, (user.display_label ?? user.full_name) as string]));
  return NextResponse.json({ events: (events ?? []).map((event) => ({ ...event, actor_name: event.actor_user_id ? actorById.get(event.actor_user_id) ?? "Видалений користувач" : "Система" })) });
}

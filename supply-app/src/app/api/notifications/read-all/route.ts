import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getSupplyApiUser } from "@/lib/currentUser";
import { markAllNotificationsRead } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  await markAllNotificationsRead(supabase, user.id);
  return NextResponse.json({ ok: true });
}

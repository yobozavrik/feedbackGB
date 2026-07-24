import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getSupplyApiUser } from "@/lib/currentUser";
import { isUuid } from "@/lib/validation";
import { markNotificationRead } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  await markNotificationRead(supabase, user.id, params.id);
  return NextResponse.json({ ok: true });
}

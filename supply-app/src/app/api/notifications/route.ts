import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getSupplyApiUser } from "@/lib/currentUser";
import { listNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  const { notifications, unreadCount } = await listNotifications(supabase, {
    recipientUserId: user.id,
    unreadOnly,
    limit,
  });
  return NextResponse.json({ notifications, unread_count: unreadCount });
}

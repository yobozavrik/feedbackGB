import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getConsumablesStatuses } from "@/lib/consumablesOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/my-feedback?limit=50
 * Returns the current user's own submitted requests across every category
 * (the "Мої заявки" cabinet), newest first. Never accepts a client-supplied
 * user id — always filters by the session's own uid.
 */
export async function GET(req: Request) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;

  const { data, error } = await supabase
    .from("feedback_feed")
    .select(
      "id, category, category_emoji, category_title, summary, status, assigned_full_name, created_at, resolved_at, cart_items",
    )
    .eq("user_id", sess.uid)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("my-feedback list error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Enrich consumables rows: item count (from the stored cart) + the live
  // seller-facing status derived from the warehouse CRM order/transfer state.
  const rows = (data ?? []) as Array<{ id: string; category: string; cart_items?: unknown }>;
  const consumablesIds = rows.filter((r) => r.category === "consumables_request").map((r) => r.id);
  const statuses = consumablesIds.length > 0 ? await getConsumablesStatuses(consumablesIds) : null;

  const enriched = rows.map((r) => {
    if (r.category !== "consumables_request") return r;
    const itemCount = Array.isArray(r.cart_items) ? r.cart_items.length : 0;
    return { ...r, item_count: itemCount, consumables_status: statuses?.get(r.id) ?? null };
  });

  return NextResponse.json({ rows: enriched });
}

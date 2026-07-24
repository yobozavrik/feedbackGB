import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getConsumablesSummaries } from "@/lib/consumablesOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/my-feedback?limit=50
 * The caller's own submitted requests across every category (the "Мої
 * заявки" cabinet), newest first. Never accepts a client-supplied user id.
 */
export async function GET(req: Request) {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;

  const { data, error } = await supabase
    .from("feedback_feed")
    .select(
      "id, category, category_emoji, category_title, summary, status, assigned_full_name, created_at, resolved_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[supply] my-feedback", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Consumables enrichment: real cart size + warehouse-derived status. The
  // FeedbackGB journal is the durable source for cart size; CRM enrichment
  // adds live status but a CRM hiccup must never turn a real cart into "0".
  const rows = (data ?? []) as Array<{ id: string; category: string }>;
  const consumablesIds = rows.filter((r) => r.category === "consumables_request").map((r) => r.id);
  const journalItemCounts = new Map<string, number>();
  if (consumablesIds.length > 0) {
    const { data: carts, error: cartsError } = await supabase
      .from("feedback")
      .select("id, cart_items")
      .in("id", consumablesIds);
    if (cartsError) {
      console.error("[supply] my-feedback cart read", { code: cartsError.code });
    } else {
      for (const c of (carts ?? []) as Array<{ id: string; cart_items: unknown }>) {
        journalItemCounts.set(c.id, Array.isArray(c.cart_items) ? c.cart_items.length : 0);
      }
    }
  }
  let summaries: Awaited<ReturnType<typeof getConsumablesSummaries>> | null = null;
  if (consumablesIds.length > 0) {
    try {
      summaries = await getConsumablesSummaries(consumablesIds);
    } catch (cause) {
      console.error("[supply] consumables enrich", cause);
    }
  }

  const enriched = rows.map((r) => {
    if (r.category !== "consumables_request") return r;
    const s = summaries?.get(r.id);
    return {
      ...r,
      item_count: s?.itemCount ?? journalItemCounts.get(r.id) ?? 0,
      consumables_status: s?.status ?? null,
    };
  });

  return NextResponse.json({ rows: enriched });
}

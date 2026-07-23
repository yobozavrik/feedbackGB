import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getConsumablesSummaries } from "@/lib/consumablesOrder";

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
      "id, category, category_emoji, category_title, summary, status, assigned_full_name, created_at, resolved_at",
    )
    .eq("user_id", sess.uid)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("my-feedback list error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Enrich consumables rows with the live seller-facing status + item count,
  // both derived from the warehouse CRM (feedback_feed has no cart column).
  const rows = (data ?? []) as Array<{ id: string; category: string }>;
  const consumablesIds = rows.filter((r) => r.category === "consumables_request").map((r) => r.id);
  // The FeedbackGB journal is the durable source for the user's own cart.
  // CRM enrichment is useful for the current warehouse status, but a read
  // permission/configuration issue there must never turn a real cart into
  // "0 positions" in the seller UI.
  const journalItemCounts = new Map<string, number>();
  if (consumablesIds.length > 0) {
    const { data: carts, error: cartsError } = await supabase
      .from("feedback")
      .select("id, cart_items")
      .in("id", consumablesIds);
    if (cartsError) {
      console.error("my-feedback consumables cart read failed", { code: cartsError.code });
    } else {
      for (const cart of (carts ?? []) as Array<{ id: string; cart_items: unknown }>) {
        journalItemCounts.set(cart.id, Array.isArray(cart.cart_items) ? cart.cart_items.length : 0);
      }
    }
  }
  let summaries: Awaited<ReturnType<typeof getConsumablesSummaries>> | null = null;
  if (consumablesIds.length > 0) {
    try {
      summaries = await getConsumablesSummaries(consumablesIds);
    } catch (cause) {
      // A warehouse-CRM hiccup must not break the whole cabinet — fall back to
      // rows without consumables enrichment.
      console.error("my-feedback consumables enrich failed", cause);
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

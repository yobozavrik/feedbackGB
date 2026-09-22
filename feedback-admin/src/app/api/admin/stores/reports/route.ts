import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getServerSupabase } from "@/lib/supabase";
import type { StoreFeedRow, StoreSeller } from "@/app/(admin)/admin/stores/page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGES = 10;
const MAX_PAGE_SIZE = 1000;
const ALLOWED_PERIODS = new Set([60, 90, 180]);

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const limit = Number(url.searchParams.get("limit") ?? "1000");
  const period = Number(url.searchParams.get("period") ?? "90");
  const asOf = url.searchParams.get("as_of") ?? new Date().toISOString();
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGES ||
      !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE ||
      !ALLOWED_PERIODS.has(period) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) ||
      !Number.isFinite(Date.parse(asOf))) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const since = new Date(Date.parse(asOf) - period * 24 * 60 * 60 * 1000).toISOString();
  const from = (page - 1) * limit;
  const feedQuery = supabase
    .from("feedback_feed")
    .select("id,created_at,store_id,store_name,category,category_emoji,category_title,status,product_id,product_name,summary,user_full_name,user_role")
    .gte("created_at", since)
    .lt("created_at", asOf)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + limit - 1);
  const sellersQuery = page === 1
    ? supabase.from("users").select("id, full_name, store_id, is_active, pin_hash, last_login").order("full_name", { ascending: true })
    : null;

  const [feedRes, sellersRes] = await Promise.all([feedQuery, sellersQuery]);
  if (feedRes.error || sellersRes?.error) {
    console.error("store reports read failed", {
      feedCode: feedRes.error?.code,
      sellersCode: sellersRes?.error?.code,
    });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const sellers: StoreSeller[] = ((sellersRes?.data ?? []) as Array<{
    id: string;
    full_name: string;
    store_id: number | null;
    is_active: boolean;
    pin_hash: string | null;
    last_login: string | null;
  }>).map((user) => ({
    id: user.id,
    full_name: user.full_name,
    store_id: user.store_id,
    is_active: user.is_active,
    has_pin: user.pin_hash != null,
    last_login: user.last_login,
  }));

  const feed = (feedRes.data ?? []) as StoreFeedRow[];
  return NextResponse.json(
    { feed, sellers, hasMore: feed.length === limit, page, windowDays: period, asOf, limit },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

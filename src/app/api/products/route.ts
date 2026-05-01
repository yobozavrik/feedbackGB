import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flat product row consumed by the product picker UI.
 * `photo` is the raw path from the POS CDN — the client prefixes it with
 * NEXT_PUBLIC_POSTER_CDN_BASE_URL (or falls back to an emoji).
 */
export interface ProductRow {
  id: number;
  name: string;
  category_id: string | null;
  category_name: string | null;
  category_sort: number | null;
  unit: string | null;
  barcode: string | null;
  photo: string | null;
  cost: number | null;
  /** 0 unless popular_for_store=<id> matched a 7-day popularity row. */
  uses_7d: number;
  /** ISO timestamp of the last usage in this store (null if never). */
  last_used_at: string | null;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;
const MAX_Q_LEN = 80;

/**
 * GET /api/products
 *
 * Query params:
 *   q                  — substring match on name (case-insensitive), max 80 chars.
 *   category_id        — filter by POS category_id (text).
 *   popular_for_store  — spot_id. When set, popular items for that store are
 *                        sorted first; all other products still returned.
 *   limit              — page size (<=200, default 60).
 *
 * Returns: { products: ProductRow[] }
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const qRaw = url.searchParams.get("q") ?? "";
  const q = qRaw.trim().slice(0, MAX_Q_LEN);

  const categoryId = (url.searchParams.get("category_id") ?? "").trim().slice(0, 32);

  const popularStoreRaw = url.searchParams.get("popular_for_store");
  const popularForStore =
    popularStoreRaw && /^\d+$/.test(popularStoreRaw)
      ? Number(popularStoreRaw)
      : null;

  const limitRaw = url.searchParams.get("limit");
  const limit =
    limitRaw && /^\d+$/.test(limitRaw)
      ? Math.min(Math.max(Number(limitRaw), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  }

  // Main product list (from feedbackgb.v_products).
  let query = supabase
    .from("v_products")
    .select("id, name, category_id, category_name, category_sort, unit, barcode, photo, cost")
    .order("name", { ascending: true })
    .limit(limit);
  if (q) {
    // Safe — PostgREST escapes `%` + `_` inside the quoted pattern string.
    query = query.ilike("name", `%${q}%`);
  }
  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("products query error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  let rows = (data ?? []) as Omit<ProductRow, "uses_7d" | "last_used_at">[];

  // If no popularity context, return as-is with zeroed popularity.
  if (popularForStore === null) {
    return NextResponse.json({
      products: rows.map((r) => ({ ...r, uses_7d: 0, last_used_at: null })),
    });
  }

  // Fetch popularity for this store and merge.
  const { data: popRows, error: popErr } = await supabase
    .from("v_popular_products")
    .select("product_id, uses_7d, last_used_at")
    .eq("store_id", popularForStore);
  if (popErr) {
    console.error("popularity query error", { code: popErr.code });
  }
  const popMap = new Map<number, { uses_7d: number; last_used_at: string | null }>();
  for (const r of (popRows ?? []) as Array<{
    product_id: number;
    uses_7d: number;
    last_used_at: string | null;
  }>) {
    popMap.set(r.product_id, {
      uses_7d: r.uses_7d,
      last_used_at: r.last_used_at,
    });
  }

  const merged: ProductRow[] = rows.map((r) => {
    const pop = popMap.get(r.id);
    return {
      ...r,
      uses_7d: pop?.uses_7d ?? 0,
      last_used_at: pop?.last_used_at ?? null,
    };
  });

  // Popular items first (descending), then unused ones by name.
  merged.sort((a, b) => {
    if (a.uses_7d !== b.uses_7d) return b.uses_7d - a.uses_7d;
    return a.name.localeCompare(b.name, "uk");
  });

  return NextResponse.json({ products: merged });
}

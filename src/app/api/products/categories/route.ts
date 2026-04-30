import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 60;

/**
 * A single POS product group (not our feedback categories).
 * `id` is the stable text slug used in categories.products.category_id.
 */
export interface ProductCategoryRow {
  id: string;
  name: string;
  sort_order: number;
  product_count: number;
}

/**
 * GET /api/products/categories
 *
 * Returns the non-hidden POS product groups (e.g. Пельмені, Вареники, …)
 * with a count of products in each, derived from feedbackgb.v_products.
 * The picker UI uses this to render the category accordion above the list.
 */
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  }

  // v_products already filters out hidden categories — aggregate from it so
  // hidden groups don't show up in the picker.
  const { data, error } = await supabase
    .from("v_products")
    .select("category_id, category_name, category_sort")
    .limit(5000);
  if (error) {
    console.error("product categories query error", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const groups = new Map<string, ProductCategoryRow>();
  for (const row of (data ?? []) as Array<{
    category_id: string | null;
    category_name: string | null;
    category_sort: number | null;
  }>) {
    const id = row.category_id ?? "__unknown";
    const existing = groups.get(id);
    if (existing) {
      existing.product_count += 1;
      continue;
    }
    groups.set(id, {
      id,
      name: row.category_name ?? "Без категорії",
      sort_order: row.category_sort ?? 9999,
      product_count: 1,
    });
  }

  const categories = Array.from(groups.values()).sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name, "uk");
  });

  return NextResponse.json({ categories });
}

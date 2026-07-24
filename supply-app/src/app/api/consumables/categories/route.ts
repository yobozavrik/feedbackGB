import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getWarehouseCrmSupabase } from "@/lib/warehouseCrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/consumables/categories — flat list of top-level product categories
 * for the category chips above the search input. Proxies household_chemicals.
 * rpc_categories_tree() and flattens (parent+children) into one alphabetised
 * list; the mobile UI doesn't render the hierarchy.
 */
export async function GET() {
  if (!(await getSupplyApiUser())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const db = getWarehouseCrmSupabase();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data, error } = await db.rpc("rpc_categories_tree");
  if (error) {
    console.error("[supply consumables/categories]", { code: error.code });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  // rpc_categories_tree returns a nested structure; supply-app only needs a
  // flat unique list. Accept both { categories: [...] } and a bare array.
  const flat: Array<{ id: number; name: string }> = [];
  const seen = new Set<number>();
  const raw = Array.isArray(data) ? data : ((data as { categories?: unknown[] })?.categories ?? []);
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { id?: unknown; name?: unknown; children?: unknown[] };
    if (typeof n.id === "number" && typeof n.name === "string" && !seen.has(n.id)) {
      seen.add(n.id);
      flat.push({ id: n.id, name: n.name });
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  (raw as unknown[]).forEach(walk);
  flat.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  return NextResponse.json({ categories: flat });
}

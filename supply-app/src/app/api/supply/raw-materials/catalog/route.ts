import { NextResponse } from "next/server";
import { getSupplyApiUser } from "@/lib/currentUser";
import { getWorkshopIdForFacility } from "@/lib/zakupkiWorkshop";
import { getZakupkiSupabase } from "@/lib/zakupkiDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CatalogRow {
  ingredient_id: string;
  ingredients: { name_uk: string; unit: string } | null;
}

/**
 * GET /api/supply/raw-materials/catalog — the caller's full workshop
 * ingredient list (flat, no category filter), used by the "Брак сировини"
 * item picker. Small dataset per workshop (~100 rows) — no server search,
 * client filters in-memory like the seller app's free-text fallback does.
 */
export async function GET() {
  const user = await getSupplyApiUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const workshopId = await getWorkshopIdForFacility(user.facilityId);
  if (!workshopId) return NextResponse.json({ items: [] });

  const db = getZakupkiSupabase();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data } = await db
    .from("workshop_ingredient_catalog")
    .select("ingredient_id, ingredients(name_uk, unit)")
    .eq("workshop_id", workshopId)
    .eq("is_active", true);

  const items = ((data ?? []) as unknown as CatalogRow[])
    .filter((row) => row.ingredients)
    .map((row) => ({
      id: row.ingredient_id,
      name: row.ingredients!.name_uk,
      unit: row.ingredients!.unit,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));

  return NextResponse.json({ items });
}

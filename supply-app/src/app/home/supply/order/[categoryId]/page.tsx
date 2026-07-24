import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSupplyUser } from "@/lib/currentUser";
import { getWorkshopIdForFacility } from "@/lib/zakupkiWorkshop";
import { getZakupkiSupabase } from "@/lib/zakupkiDb";
import { PackageIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const UNIT_LABEL: Record<string, string> = {
  kg: "кг",
  liter: "л",
  piece: "шт",
};

interface CatalogRow {
  ingredient_id: string;
  ingredients: {
    name_uk: string;
    unit: string;
    ingredient_images: { storage_path: string; is_primary: boolean; status: string }[] | null;
  } | null;
}

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  photoPath: string | null;
}

// Signed once per page render for every item at once (single Storage API
// call) instead of one <img> per redirect-through-our-API-route round trip —
// the old per-ingredient /api/.../photo/[id] route cost 2 backend hops
// (DB lookup + sign) plus a 302 *per photo*, serialized behind the browser's
// per-host connection limit. Batch-signing here means the HTML already
// carries direct, ready-to-fetch Storage URLs, so every photo starts
// downloading in parallel as soon as the page arrives.
const SIGNED_URL_TTL_SEC = 60 * 60;

export default async function RawMaterialsCategoryPage({
  params,
}: {
  params: { categoryId: string };
}) {
  const user = await requireSupplyUser();
  const workshopId = await getWorkshopIdForFacility(user.facilityId);
  if (!workshopId) notFound();

  const db = getZakupkiSupabase();
  if (!db) notFound();

  const { data: category } = await db
    .from("workshop_categories")
    .select("id, name")
    .eq("id", params.categoryId)
    .eq("workshop_id", workshopId)
    .eq("is_active", true)
    .maybeSingle();
  if (!category) notFound();

  const { data: rows } = await db
    .from("workshop_ingredient_catalog")
    .select("ingredient_id, ingredients(name_uk, unit, ingredient_images(storage_path, is_primary, status))")
    .eq("workshop_id", workshopId)
    .eq("category_id", params.categoryId)
    .eq("is_active", true);

  const ingredients: Ingredient[] = ((rows ?? []) as unknown as CatalogRow[])
    .filter((row) => row.ingredients)
    .map((row) => ({
      id: row.ingredient_id,
      name: row.ingredients!.name_uk,
      unit: row.ingredients!.unit,
      photoPath:
        (row.ingredients!.ingredient_images ?? []).find((img) => img.is_primary && img.status === "approved")
          ?.storage_path ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));

  const photoPaths = ingredients.map((i) => i.photoPath).filter((p): p is string => p !== null);
  const signedUrlByPath = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signed } = await db.storage
      .from("zakupki-ingredient-images")
      .createSignedUrls(photoPaths, SIGNED_URL_TTL_SEC);
    for (const entry of signed ?? []) {
      if (entry.signedUrl && !entry.error) signedUrlByPath.set(entry.path ?? "", entry.signedUrl);
    }
  }

  return (
    <main>
      <Link
        href="/home/supply/order"
        className="mb-5 inline-flex h-9 items-center rounded-full px-2 text-[12px] font-semibold text-brand-500 hover:bg-elev2"
      >
        ← Назад
      </Link>
      <h1 className="mb-4 font-display text-[22px] font-bold text-ink-900">{(category as { name: string }).name}</h1>

      {ingredients.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-ink-300/20 bg-elev shadow-soft">
          {ingredients.map((item) => {
            const photoUrl = item.photoPath ? signedUrlByPath.get(item.photoPath) : undefined;
            return (
              <div
                key={item.id}
                className="flex h-14 items-center gap-3 border-b border-ink-300/20 px-4 last:border-b-0"
              >
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-signed Storage URL, batch-generated server-side (see SIGNED_URL_TTL_SEC above)
                  <img src={photoUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="h-9 w-9 flex-shrink-0 rounded-md bg-elev2" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink-900">{item.name}</span>
                <span className="whitespace-nowrap text-[13px] text-ink-500">{UNIT_LABEL[item.unit] ?? item.unit}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-ink-300/40 bg-elev px-6 py-12 text-center shadow-soft">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-elev2">
            <PackageIcon size={32} className="text-ink-500" />
          </div>
          <p className="max-w-[280px] text-[15px] text-ink-700">
            Тут поки порожньо — товари з&apos;являться, щойно їх додадуть у базу
          </p>
        </div>
      )}
    </main>
  );
}

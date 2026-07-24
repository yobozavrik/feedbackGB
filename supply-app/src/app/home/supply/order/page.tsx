import Link from "next/link";
import { requireSupplyUser } from "@/lib/currentUser";
import { getWorkshopIdForFacility } from "@/lib/zakupkiWorkshop";
import { getZakupkiSupabase } from "@/lib/zakupkiDb";
import { RawMaterialsCategoryGrid, type WorkshopCategory } from "@/components/RawMaterialsCategoryGrid";
import { SearchIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function RawMaterialsOrderPage() {
  const user = await requireSupplyUser();
  const workshopId = await getWorkshopIdForFacility(user.facilityId);

  let categories: WorkshopCategory[] = [];
  if (workshopId) {
    const db = getZakupkiSupabase();
    if (db) {
      const { data } = await db
        .from("workshop_categories")
        .select("id, name")
        .eq("workshop_id", workshopId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      categories = (data ?? []) as WorkshopCategory[];
    }
  }

  return (
    <main>
      <Link
        href="/home/supply"
        className="mb-5 inline-flex h-9 items-center rounded-full px-2 text-[12px] font-semibold text-brand-500 hover:bg-elev2"
      >
        ← Назад
      </Link>
      <h1 className="mb-1 font-display text-[22px] font-bold text-ink-900">Замовлення сировини</h1>
      <p className="mb-4 text-[13px] text-ink-500">Знайдіть продукт або оберіть категорію</p>

      <div className="relative mb-5">
        <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          disabled
          placeholder="Пошук за назвою (скоро)"
          className="h-12 w-full rounded-xl border border-ink-300/20 bg-elev pl-10 pr-3 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-[#FFA854] focus:outline-none focus:ring-4 focus:ring-[#FFA854]/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {workshopId && categories.length > 0 ? (
        <RawMaterialsCategoryGrid categories={categories} />
      ) : (
        <p className="py-8 text-center text-[13px] text-ink-500">
          Для твого цеху ще не налаштовано каталог сировини. Звернись до супер-адміністратора.
        </p>
      )}
    </main>
  );
}

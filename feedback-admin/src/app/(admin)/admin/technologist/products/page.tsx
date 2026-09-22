import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";
import { ProductCategoryCards, type ProductCategory } from "./products-client";

export const dynamic = "force-dynamic";

async function fetchCategories(): Promise<{ categories: ProductCategory[]; error: string | null }> {
  const supabase = getServerSupabase();
  if (!supabase) return { categories: [], error: "Supabase ще не налаштовано" };
  const { data, error } = await supabase.from("v_products").select("category_id, category_name, category_sort").limit(5000);
  if (error) return { categories: [], error: error.message };
  const grouped = new Map<string, ProductCategory>();
  for (const row of (data ?? []) as Array<{ category_id: string | null; category_name: string | null; category_sort: number | null }>) {
    const id = row.category_id ?? "__unknown";
    const category = grouped.get(id);
    if (category) { category.productCount += 1; continue; }
    grouped.set(id, { id, name: row.category_name ?? "Без категорії", sortOrder: row.category_sort ?? 9999, productCount: 1 });
  }
  return { categories: [...grouped.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "uk")), error: null };
}

export default async function TechnologistProductsPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  const { categories, error } = await fetchCategories();
  return (
    <AdminPageContainer title="Продукти" subTitle="Категорії активного товарного каталогу POS">
      <ProductCategoryCards categories={categories} error={error} />
    </AdminPageContainer>
  );
}

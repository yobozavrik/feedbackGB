import { AppstoreOutlined } from "@ant-design/icons";
import { Alert, Card, Empty, Tag, Typography } from "antd";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface ProductCategory { id: string; name: string; sortOrder: number; productCount: number; }

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
      {error ? <Alert type="error" showIcon message="Не вдалося завантажити категорії" description={error} /> : null}
      {!error && !categories.length ? <Empty className="py-12" description="Категорій у каталозі немає" /> : null}
      {!error && categories.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => <Card key={category.id} className="h-full" size="small">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Typography.Text strong className="block truncate text-base">{category.name}</Typography.Text>
              <Typography.Text type="secondary" className="mt-1 block text-xs">{category.id === "__unknown" ? "Категорію не вказано" : `ID: ${category.id}`}</Typography.Text>
            </div>
            <AppstoreOutlined className="text-lg text-brand-600" />
          </div>
          <div className="mt-4"><Tag color="blue">{category.productCount} {category.productCount === 1 ? "продукт" : "продуктів"}</Tag></div>
        </Card>)}
      </div> : null}
    </AdminPageContainer>
  );
}

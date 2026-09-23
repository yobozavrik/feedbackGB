import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert, Button } from "antd";
import Link from "next/link";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";
import { PRODUCT_PAGE_SIZE, UNCATEGORIZED_ID, normalizeProductSearch, parseProductPage, productSearchPattern, type CatalogProduct } from "@/lib/admin/productCatalog";
import { getPosterCatalogPhotos } from "@/lib/admin/posterProductPhotos";
import { CategoryProducts } from "./category-products-client";

export const dynamic = "force-dynamic";

export default async function ProductCategoryPage({ params, searchParams }: { params: { categoryId: string }; searchParams: { q?: string | string[]; page?: string | string[] } }) {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  const categoryId = params.categoryId;
  const search = normalizeProductSearch(searchParams.q);
  const page = parseProductPage(searchParams.page);
  const supabase = getServerSupabase();
  let products: CatalogProduct[] = [];
  let total = 0;
  let categoryName = categoryId === UNCATEGORIZED_ID ? "Без категорії" : `Категорія ${categoryId}`;
  let error: string | null = null;
  let photoError = false;
  let posterMissingIds: number[] = [];
  if (!supabase) error = "Supabase ще не налаштовано";
  else {
    const categoryMetaQuery = supabase.from("v_products").select("category_name").limit(1);
    const categoryMeta = await (categoryId === UNCATEGORIZED_ID
      ? categoryMetaQuery.is("category_id", null)
      : categoryMetaQuery.eq("category_id", categoryId));
    if (categoryMeta.data?.[0]?.category_name) categoryName = categoryMeta.data[0].category_name;
    let query = supabase.from("v_products")
      .select("id,name,category_id,category_name,unit,barcode,photo,cost", { count: "exact" })
      .order("name", { ascending: true }).order("id", { ascending: true })
      .range((page - 1) * PRODUCT_PAGE_SIZE, page * PRODUCT_PAGE_SIZE - 1);
    query = categoryId === UNCATEGORIZED_ID ? query.is("category_id", null) : query.eq("category_id", categoryId);
    if (search) query = query.ilike("name", productSearchPattern(search));
    const result = await query;
    if (result.error) error = "Не вдалося завантажити продукти каталогу";
    else {
      products = (result.data ?? []) as CatalogProduct[];
      total = result.count ?? 0;
      if (products.length) {
        const token = process.env.POSTER_TOKEN;
        if (!token) photoError = true;
        else {
          try {
            const posterPhotos = await getPosterCatalogPhotos(token);
            products = products.map((product) => ({ ...product, photo: posterPhotos.get(product.id) ?? null }));
            posterMissingIds = products.filter((product) => !posterPhotos.has(product.id)).map((product) => product.id);
          } catch { photoError = true; }
        }
        if (photoError) products = products.map((product) => ({ ...product, photo: null }));
      }
    }
  }
  return <AdminPageContainer title={categoryName} subTitle="Продукти категорії товарного каталогу POS" extra={<Link href="/admin/technologist/products"><Button>Усі категорії</Button></Link>}>
    {error ? <Alert type="error" showIcon message={error} /> : <>
      {photoError && <Alert type="warning" showIcon className="mb-4" message="Фото з Poster тимчасово недоступні" />}
      <CategoryProducts categoryId={categoryId} products={products} total={total} page={page} search={search} posterMissingIds={posterMissingIds} />
    </>}
  </AdminPageContainer>;
}

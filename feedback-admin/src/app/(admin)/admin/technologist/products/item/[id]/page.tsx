import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Alert, Button } from "antd";
import Link from "next/link";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";
import { UNCATEGORIZED_ID, productCategoryHref, type CatalogProduct } from "@/lib/admin/productCatalog";
import { getPosterProductPhoto } from "@/lib/admin/posterProductPhotos";
import { ProductDetail } from "./product-detail-client";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { tab?: string | string[] } }) {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  if (!/^\d+$/.test(params.id) || !Number.isSafeInteger(Number(params.id))) notFound();
  const supabase = getServerSupabase();
  if (!supabase) return <AdminPageContainer title="Картка продукту"><Alert type="error" showIcon message="Supabase ще не налаштовано" /></AdminPageContainer>;
  const { data, error } = await supabase.from("v_products")
    .select("id,name,category_id,category_name,unit,barcode,photo,cost")
    .eq("id", Number(params.id)).maybeSingle();
  if (error) return <AdminPageContainer title="Картка продукту"><Alert type="error" showIcon message="Не вдалося завантажити продукт каталогу" /></AdminPageContainer>;
  if (!data) notFound();
  const product = data as CatalogProduct;
  let posterPhoto: string | null = null;
  let photoError = false;
  const token = process.env.POSTER_TOKEN;
  if (!token) photoError = true;
  else {
    try { posterPhoto = await getPosterProductPhoto(product.id, token); }
    catch { photoError = true; }
  }
  const categoryHref = productCategoryHref(product.category_id ?? UNCATEGORIZED_ID);
  const tab = Array.isArray(searchParams?.tab) ? searchParams.tab[0] : searchParams?.tab;
  const initialTab = ["stock", "characteristics", "tech", "foodcost", "stages"].includes(tab ?? "") ? tab : "stock";
  return <AdminPageContainer title={product.name} subTitle="Картка продукту з товарного каталогу POS" extra={<Link href={categoryHref}><Button>До категорії</Button></Link>}>
    <ProductDetail product={product} posterPhoto={posterPhoto} photoError={photoError} initialTab={initialTab} />
  </AdminPageContainer>;
}

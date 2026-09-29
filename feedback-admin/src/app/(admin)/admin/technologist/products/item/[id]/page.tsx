import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Alert, Button, Space } from "antd";
import Link from "next/link";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase";
import { UNCATEGORIZED_ID, productCategoryHref, type CatalogProduct } from "@/lib/admin/productCatalog";
import { getPosterProductPhoto } from "@/lib/admin/posterProductPhotos";
import { parseFoodcostSpotId } from "@/lib/admin/foodcostScope";
import { parseFoodcostPeriodDays } from "@/lib/admin/foodcostPeriod";
import { foodcostMatrixReturnHref, parseFoodcostMatrixCategoryKey, parseFoodcostMatrixMethod } from "@/lib/admin/foodcostMatrixUrl";
import { ProductDetail } from "./product-detail-client";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params, searchParams }: {
  params: { id: string }; searchParams?: { tab?: string | string[]; spot_id?: string | string[];
    days?: string | string[]; method?: string | string[]; category_id?: string | string[]; return_to?: string | string[] };
}) {
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
  const rawSpotId = Array.isArray(searchParams?.spot_id) ? searchParams.spot_id[0] : searchParams?.spot_id;
  let spotId: number | undefined;
  try { spotId = parseFoodcostSpotId(rawSpotId ?? null); }
  catch { return <AdminPageContainer title="Картка продукту"><Alert type="warning" showIcon message="Некоректний магазин" /></AdminPageContainer>; }
  const rawDays = Array.isArray(searchParams?.days) ? searchParams.days[0] : searchParams?.days;
  let days;
  try { days = parseFoodcostPeriodDays(rawDays); }
  catch { return <AdminPageContainer title="Картка продукту"><Alert type="warning" showIcon message="Некоректний період" /></AdminPageContainer>; }
  const rawMethod = Array.isArray(searchParams?.method) ? searchParams.method[0] : searchParams?.method;
  const rawCategory = Array.isArray(searchParams?.category_id) ? searchParams.category_id[0] : searchParams?.category_id;
  const returnTo = Array.isArray(searchParams?.return_to) ? searchParams.return_to[0] : searchParams?.return_to;
  const returnHref = returnTo === "matrix" ? foodcostMatrixReturnHref({ days, spotId,
    method: parseFoodcostMatrixMethod(rawMethod), categoryKey: parseFoodcostMatrixCategoryKey(rawCategory) }) : null;
  const initialTab = ["stock", "characteristics", "tech", "foodcost", "stages"].includes(tab ?? "") ? tab : "stock";
  return <AdminPageContainer title={product.name} subTitle="Картка продукту з товарного каталогу POS" extra={<Space>
    {returnHref && <Link href={returnHref}><Button>До матриці</Button></Link>}
    <Link href={categoryHref}><Button>До категорії</Button></Link>
  </Space>}>
    <ProductDetail product={product} posterPhoto={posterPhoto} photoError={photoError} initialTab={initialTab} spotId={spotId} initialDays={days} />
  </AdminPageContainer>;
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert } from "antd";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { loadFoodcostCommandCenter } from "@/lib/admin/foodcostCommandCenter";
import { parseFoodcostPeriodDays } from "@/lib/admin/foodcostPeriod";
import { parseFoodcostMatrixCategoryKey } from "@/lib/admin/foodcostMatrixUrl";
import { loadFoodcostSupplyPrices } from "@/lib/admin/foodcostSupplyPrices";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { FoodCostCommandCenter } from "./food-cost-command-center";
import { FoodCostWorkspace } from "./food-cost-workspace";
import { FoodCostMatrix } from "./food-cost-matrix";

export const dynamic = "force-dynamic";

export default async function TechnologistFoodCostPage({ searchParams }: {
  searchParams?: { tab?: string | string[]; spot_id?: string | string[];
    category_id?: string | string[]; days?: string | string[] };
}) {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");

  const rawSpotId = Array.isArray(searchParams?.spot_id) ? searchParams.spot_id[0] : searchParams?.spot_id;
  if (rawSpotId && rawSpotId !== "all" && (!/^\d+$/.test(rawSpotId) ||
    !Number.isSafeInteger(Number(rawSpotId)) || Number(rawSpotId) <= 0)) {
    return <AdminPageContainer title="Фудкост">
      <Alert type="warning" showIcon message="Некоректний магазин" description="Оберіть магазин зі списку." />
    </AdminPageContainer>;
  }
  const spotId = rawSpotId && rawSpotId !== "all" ? Number(rawSpotId) : undefined;
  const rawCategoryId = Array.isArray(searchParams?.category_id)
    ? searchParams.category_id[0] : searchParams?.category_id;
  const parsedCategoryId = parseFoodcostMatrixCategoryKey(rawCategoryId);
  const categoryId = parsedCategoryId === "all" ? undefined : parsedCategoryId;
  const tab = Array.isArray(searchParams?.tab) ? searchParams.tab[0] : searchParams?.tab;
  const initialTab = tab === "categories" || tab === "products" || tab === "supply-prices" || tab === "matrix" ? tab : "overview";
  const rawDays = Array.isArray(searchParams?.days) ? searchParams.days[0] : searchParams?.days;
  let days;
  try { days = parseFoodcostPeriodDays(rawDays); }
  catch { return <AdminPageContainer title="Фудкост"><Alert type="warning" showIcon
    message="Некоректний період" description="Оберіть 7, 14, 30 або 60 завершених днів." /></AdminPageContainer>; }
  const data = initialTab === "overview" || initialTab === "matrix" ? await loadFoodcostCommandCenter(spotId, days, new Date(),
    { includeMatrix: initialTab === "matrix" }).catch((error: unknown) => {
      const raw = error instanceof Error ? error.message : "unknown_error";
      const code = ["schema_missing", "service_role_missing", "poster_token_missing",
        "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
        "poster_unavailable", "poster_invalid_response", "foodcost_catalog_unavailable",
        "invalid_foodcost_spot"].includes(raw) ? raw : "unexpected_error";
      console.error(JSON.stringify({ event: "foodcost_command_center_page", code }));
      return null;
    }) : null;
  const supplyPrices = initialTab === "supply-prices" ? await loadFoodcostSupplyPrices(days).catch((error: unknown) => {
    const raw = error instanceof Error ? error.message : "unknown_error";
    const code = ["schema_missing", "supabase_unavailable", "poster_unavailable", "poster_invalid_response"].includes(raw) ? raw : "unexpected_error";
    console.error(JSON.stringify({ event: "foodcost_supply_prices_page", code }));
    return null;
  }) : null;
  return <AdminPageContainer title="Фудкост" subTitle="Огляд мережі та продуктів">
    <FoodCostWorkspace initialTab={initialTab} spotId={spotId} categoryId={categoryId} days={days} supplyPrices={supplyPrices}
      overview={initialTab !== "overview" ? null : data ? <FoodCostCommandCenter data={data} />
        : <Alert type="error" showIcon message="Огляд фудкосту зараз недоступний"
          description="Дані Poster або знімок продажів недоступні. Неперевірені підсумки не показуємо." />}
      matrixContent={initialTab !== "matrix" ? null : data ? <FoodCostMatrix data={data} days={days} />
        : <Alert type="error" showIcon message="Матриця фудкосту зараз недоступна"
          description="Поточний повний знімок або каталог продуктів не пройшов перевірку. Часткові точки не показуємо." />} />
  </AdminPageContainer>;
}

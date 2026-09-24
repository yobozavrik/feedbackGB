import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert } from "antd";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { getLiveFoodCostSample } from "@/lib/admin/posterFoodCost";
import { loadFoodcostRecentNetwork } from "@/lib/admin/foodcostRecentNetwork";
import { loadSupplyComparison, unavailableSupplyComparison } from "@/lib/admin/posterSupplyComparison";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { FoodCostSampleView } from "./food-cost-sample-view";
import { FoodCostRecentSummary } from "./food-cost-recent-summary";

export const dynamic = "force-dynamic";

export default async function TechnologistFoodCostPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");

  const token = process.env.POSTER_TOKEN;
  if (!token) {
    return <AdminPageContainer title="Фудкост" subTitle="Пілот: Пельмені зі свинини">
      <Alert type="error" showIcon message="Poster не налаштовано" description="Неможливо отримати поточні дані продукту." />
    </AdminPageContainer>;
  }

  const [recent, sample] = await Promise.all([
    loadFoodcostRecentNetwork().catch((error: unknown) => {
      const raw = error instanceof Error ? error.message : "unknown_error";
      const code = ["schema_missing", "service_role_missing", "poster_token_missing",
        "supabase_missing", "foodcost_roster_unavailable", "foodcost_roster_mismatch",
        "poster_unavailable", "poster_invalid_response"].includes(raw) ? raw : "unexpected_error";
      console.error(JSON.stringify({ event: "foodcost_recent_network_page", code }));
      return null;
    }),
    getLiveFoodCostSample(121, token).then(async (data) => ({
      data, supply: await loadSupplyComparison(data).catch(() => unavailableSupplyComparison(data)),
    })).catch(() => null),
  ]);
  return <AdminPageContainer title="Фудкост" subTitle="Огляд мережі та пілот одного продукту">
    <FoodCostRecentSummary data={recent} />
    {sample ? <FoodCostSampleView data={sample.data} supply={sample.supply} />
      : <Alert type="error" showIcon message="Не вдалося отримати дані продукту з Poster"
        description="Пілот продукту не підмінюється кешем або припущеннями. Оновіть сторінку пізніше." />}
  </AdminPageContainer>;
}

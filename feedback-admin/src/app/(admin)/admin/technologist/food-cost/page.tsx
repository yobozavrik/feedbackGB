import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert } from "antd";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { getLiveFoodCostSample } from "@/lib/admin/posterFoodCost";
import { loadSupplyComparison, unavailableSupplyComparison } from "@/lib/admin/posterSupplyComparison";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";
import { FoodCostSampleView } from "./food-cost-sample-view";

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

  try {
    const data = await getLiveFoodCostSample(121, token);
    const supply = await loadSupplyComparison(data).catch(() => unavailableSupplyComparison(data));
    return <AdminPageContainer title="Фудкост" subTitle="Пілот: один продукт · поточні дані Poster">
      <FoodCostSampleView data={data} supply={supply} />
    </AdminPageContainer>;
  } catch {
    return <AdminPageContainer title="Фудкост" subTitle="Пілот: Пельмені зі свинини">
      <Alert type="error" showIcon message="Не вдалося отримати дані з Poster" description="Дані не підмінюються кешем або припущеннями. Оновіть сторінку пізніше." />
    </AdminPageContainer>;
  }
}

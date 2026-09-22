import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TechnologistFoodCostPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  return <AdminPageContainer title="Фудкост" subTitle="Собівартість, ціни закупівлі та контроль змін"><PlannedDataPlaceholder title="Фудкост" description="Джерело закупівельних цін, техкарти та формула собівартості ще не погоджені." scope="production" /></AdminPageContainer>;
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProductionPlanningPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  return <AdminPageContainer title="Планування виробництва" subTitle="Плани, потужності та виконання виробництва"><PlannedDataPlaceholder title="Планування виробництва" description="Планові обсяги, потужності цехів, календар і правила розрахунку ще не підключені." scope="production" /></AdminPageContainer>;
}

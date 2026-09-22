import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProductionEquipmentPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  return <AdminPageContainer title="Обладнання" subTitle="Реєстр, стан і обслуговування обладнання цехів"><PlannedDataPlaceholder title="Обладнання" description="Джерело даних, паспортні дані, відповідальні та правила технічного обслуговування ще не погоджені." scope="production" /></AdminPageContainer>;
}

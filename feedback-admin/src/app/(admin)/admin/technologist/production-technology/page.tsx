import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TechnologistProductionTechnologyPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  return <AdminPageContainer title="Технологія виробництва" subTitle="Техкарти, етапи та нормативи виробництва"><PlannedDataPlaceholder title="Технологія виробництва" description="Техкарти, версії технологій, норми та зв'язок з плануванням ще не підключені." scope="production" /></AdminPageContainer>;
}

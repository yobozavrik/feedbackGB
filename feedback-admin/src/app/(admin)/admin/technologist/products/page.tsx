import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TechnologistProductsPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");
  return <AdminPageContainer title="Продукти" subTitle="Склад продуктів, категорії та технологічні параметри"><PlannedDataPlaceholder title="Продукти" description="Довідник продуктів і правила синхронізації з обліковою системою ще не підключені." scope="production" /></AdminPageContainer>;
}

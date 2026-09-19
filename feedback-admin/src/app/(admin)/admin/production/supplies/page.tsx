import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProductionSuppliesPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");

  return (
    <AdminPageContainer
      title="Постачання"
      subTitle="Заявки та поставки для цехів"
    >
      <PlannedDataPlaceholder
        title="Постачання виробництва"
        description="Сторінка доступна лише супер-адміну. Заявки, позиції та статуси поставок будуть додані після погодження workflow та джерела даних."
        scope="production"
      />
    </AdminPageContainer>
  );
}

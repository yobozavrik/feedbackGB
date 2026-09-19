import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProductionSchedulesPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");

  return (
    <AdminPageContainer
      title="Графіки роботи"
      subTitle="Планування змін працівників виробництва"
    >
      <PlannedDataPlaceholder
        title="Графіки роботи виробництва"
        description="Сторінка доступна лише супер-адміну. Дані змін з’являться після затвердження цехів, працівників, правил конфліктів та джерела графіків."
        scope="production"
      />
    </AdminPageContainer>
  );
}

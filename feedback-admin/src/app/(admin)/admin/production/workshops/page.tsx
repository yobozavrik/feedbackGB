import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { SESSION_COOKIE, isSuperAdmin, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WorkshopsPage() {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session || !isSuperAdmin(session.role)) redirect("/admin");

  return (
    <AdminPageContainer
      title="Цехи"
      subTitle="Довідник і робочий стан цехів"
    >
      <PlannedDataPlaceholder
        title="Цехи"
        description="Сторінка доступна лише супер-адміну. Справочник цехів, відповідальні та фактичні статуси з’являться після погодження їхнього джерела."
        scope="production"
      />
    </AdminPageContainer>
  );
}

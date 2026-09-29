import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/adminAuth";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { CalendarClient } from "./calendar-client";

export const dynamic = "force-dynamic";
export default async function CalendarPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login?next=/admin/calendar");
  return <AdminPageContainer title="Календар" subTitle={`Особисті задачі та нагадування · ${session.full_name}`}>
    <CalendarClient />
  </AdminPageContainer>;
}

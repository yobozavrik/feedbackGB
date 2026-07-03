import { Header } from "@/components/Header";
import { SickLeaveRequestForm } from "@/components/SickLeaveRequestForm";
import { HrDateRangeRequests } from "@/components/HrDateRangeRequests";

export const dynamic = "force-dynamic";

export default function SickLeaveRequestPage() {
  return (
    <main className="relative">
      <Header subtitle="Треба лікарняний" back={{ href: "/hr-menu", label: "Назад" }} />

      <SickLeaveRequestForm />
      <HrDateRangeRequests endpoint="sick-leave-requests" title="Мої заявки на лікарняний" />
    </main>
  );
}

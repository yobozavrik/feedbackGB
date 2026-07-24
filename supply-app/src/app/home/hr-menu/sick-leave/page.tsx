import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { SickLeaveForm } from "@/components/hr/SickLeaveForm";
import { MyHrList } from "@/components/hr/MyHrList";

export const dynamic = "force-dynamic";

export default async function SickLeavePage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Треба лікарняний" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <SickLeaveForm />
      <MyHrList endpoint="sick-leave-requests" title="Мої лікарняні" />
    </main>
  );
}

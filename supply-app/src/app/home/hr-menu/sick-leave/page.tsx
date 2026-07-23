import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { SickLeaveForm } from "@/components/hr/SickLeaveForm";

export const dynamic = "force-dynamic";

export default async function SickLeavePage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Треба лікарняний" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <SickLeaveForm />
    </main>
  );
}

import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { RepairForm } from "@/components/repair/RepairForm";

export const dynamic = "force-dynamic";

export default async function TechIssuePage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Заявка на ремонт" back={{ href: "/home", label: "Назад" }} />
      <RepairForm />
    </main>
  );
}

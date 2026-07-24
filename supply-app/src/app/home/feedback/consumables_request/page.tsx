import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { ConsumablesCart } from "@/components/ConsumablesCart";

export const dynamic = "force-dynamic";

export default async function ConsumablesRequestPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Заявка на розхідні матеріали" back={{ href: "/home", label: "Назад" }} />
      <ConsumablesCart />
    </main>
  );
}

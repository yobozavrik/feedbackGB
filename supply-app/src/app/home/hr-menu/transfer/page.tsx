import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { TransferForm } from "@/components/hr/TransferForm";

export const dynamic = "force-dynamic";

export default async function TransferPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Хочу перевестися в інший цех/склад/магазин" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <TransferForm />
    </main>
  );
}

import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { TransferForm } from "@/components/hr/TransferForm";
import { MyHrList } from "@/components/hr/MyHrList";

export const dynamic = "force-dynamic";

export default async function TransferPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Хочу перевестися в інший цех/склад/магазин" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <TransferForm />
      <MyHrList endpoint="transfer-requests" title="Мої заявки на переведення" />
    </main>
  );
}

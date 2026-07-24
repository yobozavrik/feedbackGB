import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { RawMaterialDefectForm } from "@/components/raw-materials/RawMaterialDefectForm";

export const dynamic = "force-dynamic";

export default async function RawMaterialDefectPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Брак сировини" back={{ href: "/home/supply", label: "Назад" }} />
      <RawMaterialDefectForm />
    </main>
  );
}

import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { ResignationForm } from "@/components/hr/ResignationForm";

export const dynamic = "force-dynamic";

export default async function ResignationPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Хочу звільнитися" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <ResignationForm />
    </main>
  );
}

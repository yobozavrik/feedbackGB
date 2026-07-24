import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { MyRequestDetail } from "@/components/MyRequestDetail";

export const dynamic = "force-dynamic";

export default async function MyRequestDetailPage({ params }: { params: { id: string } }) {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Деталі заявки" back={{ href: "/home/my-requests", label: "Назад" }} />
      <MyRequestDetail id={params.id} />
    </main>
  );
}

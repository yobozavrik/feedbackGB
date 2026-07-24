import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { MyRequestsList } from "@/components/MyRequestsList";
import { DraftBanner } from "@/components/DraftBanner";

export const dynamic = "force-dynamic";

export default async function MyRequestsPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Мої заявки" back={{ href: "/home", label: "Назад" }} />
      <DraftBanner />
      <MyRequestsList />
    </main>
  );
}

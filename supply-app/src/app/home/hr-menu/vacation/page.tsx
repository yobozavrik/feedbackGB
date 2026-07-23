import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { DateRangeForm } from "@/components/hr/DateRangeForm";

export const dynamic = "force-dynamic";

export default async function VacationPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Хочу у відпустку" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <DateRangeForm topicId="vacation" requestNoun="відпустку" minNoticeDays={7} />
    </main>
  );
}

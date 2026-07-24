import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { DateRangeForm } from "@/components/hr/DateRangeForm";
import { MyHrList } from "@/components/hr/MyHrList";

export const dynamic = "force-dynamic";

export default async function VacationPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Хочу у відпустку" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <DateRangeForm topicId="vacation" requestNoun="відпустку" minNoticeDays={7} />
      <MyHrList endpoint="vacation-requests" title="Мої заявки на відпустку" />
    </main>
  );
}

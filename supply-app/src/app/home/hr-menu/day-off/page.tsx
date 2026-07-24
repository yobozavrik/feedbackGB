import { requireSupplyUser } from "@/lib/currentUser";
import { SupplyHeader } from "@/components/SupplyHeader";
import { DateRangeForm } from "@/components/hr/DateRangeForm";
import { MyHrList } from "@/components/hr/MyHrList";

export const dynamic = "force-dynamic";

export default async function DayOffPage() {
  await requireSupplyUser();
  return (
    <main className="relative">
      <SupplyHeader subtitle="Хочу пару вихідних" back={{ href: "/home/hr-menu", label: "Назад" }} />
      <DateRangeForm topicId="day-off" requestNoun="вихідні" minNoticeDays={7} />
      <MyHrList endpoint="day-off-requests" title="Мої заявки на вихідні" />
    </main>
  );
}

import { Header } from "@/components/Header";
import { HrDateRangeRequestForm } from "@/components/HrDateRangeRequestForm";
import { HrDateRangeRequests } from "@/components/HrDateRangeRequests";

export const dynamic = "force-dynamic";

export default function DayOffRequestPage() {
  return (
    <main className="relative">
      <Header subtitle="Хочу пару вихідних" back={{ href: "/hr-menu", label: "Назад" }} />

      <HrDateRangeRequestForm
        topicId="day-off"
        requestNoun="вихідні"
        noticeAnchor="дати вихідного"
        minNoticeDays={7}
      />
      <HrDateRangeRequests endpoint="day-off-requests" title="Мої заявки на вихідні" />
    </main>
  );
}

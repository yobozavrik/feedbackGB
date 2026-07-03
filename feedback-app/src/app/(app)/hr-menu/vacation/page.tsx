import { Header } from "@/components/Header";
import { HrDateRangeRequestForm } from "@/components/HrDateRangeRequestForm";
import { HrDateRangeRequests } from "@/components/HrDateRangeRequests";

export const dynamic = "force-dynamic";

export default function VacationRequestPage() {
  return (
    <main className="relative">
      <Header subtitle="Хочу у відпустку" back={{ href: "/hr-menu", label: "Назад" }} />

      <HrDateRangeRequestForm
        topicId="vacation"
        requestNoun="відпустку"
        noticeAnchor="першого дня відпустки"
        minNoticeDays={7}
      />
      <HrDateRangeRequests endpoint="vacation-requests" title="Мої заявки на відпустку" />
    </main>
  );
}

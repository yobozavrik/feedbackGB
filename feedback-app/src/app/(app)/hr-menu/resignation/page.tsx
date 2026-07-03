import { Header } from "@/components/Header";
import { ResignationRequestForm } from "@/components/ResignationRequestForm";
import { HrDateRangeRequests } from "@/components/HrDateRangeRequests";

export const dynamic = "force-dynamic";

export default function ResignationRequestPage() {
  return (
    <main className="relative">
      <Header subtitle="Хочу звільнитися" back={{ href: "/hr-menu", label: "Назад" }} />

      <ResignationRequestForm />
      <HrDateRangeRequests endpoint="resignation-requests" title="Мої заявки на звільнення" />
    </main>
  );
}

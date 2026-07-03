import { Header } from "@/components/Header";
import { VacationRequestForm } from "@/components/VacationRequestForm";
import { MyVacationRequests } from "@/components/MyVacationRequests";

export const dynamic = "force-dynamic";

export default function VacationRequestPage() {
  return (
    <main className="relative">
      <Header subtitle="Хочу у відпустку" back={{ href: "/hr-menu", label: "Назад" }} />

      <VacationRequestForm />
      <MyVacationRequests />
    </main>
  );
}

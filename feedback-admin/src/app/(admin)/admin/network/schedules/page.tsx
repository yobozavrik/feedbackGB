import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";

export const dynamic = "force-dynamic";

export default function NetworkSchedulesPage() {
  return (
    <AdminPageContainer
      title="Графіки роботи"
      subTitle="Планування змін працівників магазинів"
    >
      <PlannedDataPlaceholder
        title="Графіки роботи магазинів"
        description="Сторінка та навігація готові. Підключення змін, працівників, фільтрів і редактора буде виконано після затвердження джерела даних та правил графіків."
        scope="network"
      />
    </AdminPageContainer>
  );
}

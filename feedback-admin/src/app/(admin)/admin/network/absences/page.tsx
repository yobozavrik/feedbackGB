import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";

export default function NetworkAbsencesPage() {
  return (
    <AdminPageContainer
      title="Графік відсутностей"
      subTitle="Відпустки, лікарняні та відгули продавчинь магазинів"
    >
      <PlannedDataPlaceholder
        title="Графік відсутностей"
        description="Після погодження моделі даних тут з’явиться реєстр і календар затверджених відпусток, лікарняних та відгулів з прив’язкою до продавчині й магазину."
        scope="network"
      />
    </AdminPageContainer>
  );
}

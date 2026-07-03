import { Header } from "@/components/Header";
import { TransferRequestForm } from "@/components/TransferRequestForm";
import { TransferRequests } from "@/components/TransferRequests";

export const dynamic = "force-dynamic";

export default function TransferRequestPage() {
  return (
    <main className="relative">
      <Header
        subtitle="Хочу перевестися в інший магазин/цех"
        back={{ href: "/hr-menu", label: "Назад" }}
      />

      <TransferRequestForm />
      <TransferRequests />
    </main>
  );
}

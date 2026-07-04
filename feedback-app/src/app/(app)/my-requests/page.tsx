import { Header } from "@/components/Header";
import { MyRequestsList } from "@/components/MyRequestsList";

export const dynamic = "force-dynamic";

export default function MyRequestsPage() {
  return (
    <main className="relative">
      <Header subtitle="Мої заявки" back={{ href: "/", label: "На головну" }} />
      <MyRequestsList />
    </main>
  );
}

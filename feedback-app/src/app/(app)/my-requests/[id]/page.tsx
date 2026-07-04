import { Header } from "@/components/Header";
import { RequestDetail } from "@/components/RequestDetail";

export const dynamic = "force-dynamic";

export default function MyRequestDetailPage({ params }: { params: { id: string } }) {
  return (
    <main className="relative">
      <Header subtitle="Заявка" back={{ href: "/my-requests", label: "Мої заявки" }} />
      <RequestDetail id={params.id} />
    </main>
  );
}

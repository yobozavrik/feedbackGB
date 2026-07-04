import { Header } from "@/components/Header";
import { NotificationsList } from "@/components/NotificationsList";

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return (
    <main className="relative">
      <Header subtitle="Сповіщення" back={{ href: "/", label: "На головну" }} />
      <NotificationsList />
    </main>
  );
}

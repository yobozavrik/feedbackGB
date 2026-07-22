import { MyRequestsList } from "@/components/MyRequestsList";
import { ConsumablesTabBar } from "@/components/ConsumablesTabBar";
import { ArrowLeftIcon, PlusCircleIcon } from "@/components/icons";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function MyRequestsPage() {
  return (
    <main className="relative -mx-4 sm:-mx-6">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#c1c6d7] bg-white px-4 py-3">
        <Link href="/" className="flex h-10 w-10 items-center justify-center text-[#0058bc]" aria-label="На головну"><ArrowLeftIcon size={24} /></Link>
        <h1 className="text-xl font-bold text-[#0058bc]">Мої заявки</h1>
        <Link href="/feedback/consumables_request" className="flex h-10 w-10 items-center justify-center text-[#0058bc]" aria-label="Нове замовлення"><PlusCircleIcon size={24} /></Link>
      </header>
      <MyRequestsList />
      <ConsumablesTabBar />
    </main>
  );
}

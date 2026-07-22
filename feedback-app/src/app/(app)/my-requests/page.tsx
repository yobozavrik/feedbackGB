import { MyRequestsList } from "@/components/MyRequestsList";

export const dynamic = "force-dynamic";

export default function MyRequestsPage() {
  return (
    <main className="relative -mx-4 sm:-mx-6">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#c1c6d7] bg-white px-4 py-3">
        <a href="/" className="flex h-10 w-10 items-center justify-center text-2xl text-[#0058bc]" aria-label="На головну">←</a>
        <h1 className="text-xl font-bold text-[#0058bc]">Мої заявки</h1>
        <a href="/feedback/consumables_request" className="flex h-10 w-10 items-center justify-center text-xl text-[#0058bc]" aria-label="Нове замовлення">⌑</a>
      </header>
      <MyRequestsList />
    </main>
  );
}
